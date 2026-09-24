import crypto from 'crypto';
import path from 'path';
import dotenv from 'dotenv';
import WebSocket from 'ws';
import { SynthesizedAudio, SpidyVoice } from '../types';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const EDGE_TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
// Two voice identities, each covering both scripts we expect to see:
// Devanagari (Hindi) text uses the hi-IN neural voice; Latin-script text
// (English or Hinglish typed phonetically) uses the en-IN neural voice so
// English words aren't mispronounced. Same character either way — only
// the underlying audio voice differs, per the male/female setting.
const EDGE_VOICES: Record<SpidyVoice, { devanagari: string; latin: string }> = {
  female: { devanagari: 'hi-IN-SwaraNeural', latin: 'en-IN-NeerjaNeural' },
  male: { devanagari: 'hi-IN-MadhurNeural', latin: 'en-IN-PrabhatNeural' },
};

function hasDevanagari(text: string): boolean {
  return /[\u0900-\u097F]/.test(text);
}
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0';

function generateSecMsGec(): string {
  const unix = Date.now() / 1000;
  let ticks = unix + 11644473600;
  ticks -= ticks % 300;
  ticks *= 10_000_000;
  const payload = `${Math.trunc(ticks)}${EDGE_TRUSTED_TOKEN}`;
  return crypto.createHash('sha256').update(payload, 'ascii').digest('hex').toUpperCase();
}

function connectId(): string {
  return crypto.randomUUID().replace(/-/g, '').toUpperCase();
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');
}

function jsDateString(): string {
  return new Date().toUTCString().replace('GMT', 'GMT+0000 (Coordinated Universal Time)');
}

function parseBinaryAudioFrame(data: Buffer): Buffer | null {
  if (data.length < 2) {
    return null;
  }
  const headerLength = data.readUInt16BE(0);
  const headerEnd = 2 + headerLength;
  if (headerEnd > data.length) {
    return null;
  }
  const header = data.subarray(2, headerEnd).toString('utf8');
  if (!header.includes('Path:audio')) {
    return null;
  }
  const body = data.subarray(headerEnd);
  return body.length > 0 ? body : null;
}

async function synthesizeWithEdge(text: string, voice: SpidyVoice): Promise<SynthesizedAudio> {
  const voiceName = hasDevanagari(text) ? EDGE_VOICES[voice].devanagari : EDGE_VOICES[voice].latin;
  const lang = hasDevanagari(text) ? 'hi-IN' : 'en-IN';
  const connectionId = connectId();
  const requestId = connectId();
  const gec = generateSecMsGec();
  const url =
    `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1` +
    `?TrustedClientToken=${EDGE_TRUSTED_TOKEN}` +
    `&ConnectionId=${connectionId}` +
    `&Sec-MS-GEC=${gec}` +
    `&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}`;

  const ssml =
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>` +
    `<voice name='${voiceName}'>` +
    `<prosody rate='+4%' pitch='${voice === 'female' ? '+6Hz' : '-2Hz'}'>${escapeXml(text)}</prosody>` +
    `</voice></speak>`;

  const chunks: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url, {
      headers: {
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    let settled = false;
    const timeout = setTimeout(() => {
      ws.terminate();
      finish(new Error('Edge TTS timed out.'));
    }, 20_000);

    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    ws.on('open', () => {
      const config =
        `X-Timestamp:${jsDateString()}\r\n` +
        `Content-Type:application/json; charset=utf-8\r\n` +
        `Path:speech.config\r\n\r\n` +
        `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`;
      ws.send(config);

      const ssmlMessage =
        `X-RequestId:${requestId}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${jsDateString()}Z\r\n` +
        `Path:ssml\r\n\r\n` +
        ssml;
      ws.send(ssmlMessage);
    });

    ws.on('message', (raw: WebSocket.RawData, isBinary: boolean) => {
      const buffer = Buffer.isBuffer(raw)
        ? raw
        : Array.isArray(raw)
          ? Buffer.concat(raw)
          : Buffer.from(raw as ArrayBuffer);

      if (!isBinary) {
        if (buffer.toString('utf8').includes('Path:turn.end')) {
          finish();
        }
        return;
      }

      const audio = parseBinaryAudioFrame(buffer);
      if (audio) {
        chunks.push(audio);
      }
    });

    ws.on('error', (error: Error) => {
      finish(new Error(`Edge TTS websocket error: ${error.message}`));
    });

    ws.on('close', () => {
      if (chunks.length > 0) {
        finish();
        return;
      }
      finish(new Error('Edge TTS closed without audio.'));
    });
  });

  if (chunks.length === 0) {
    throw new Error('Edge TTS returned no audio.');
  }

  return {
    buffer: Buffer.concat(chunks),
    mimeType: 'audio/mpeg',
  };
}

function splitForGoogleTts(text: string): string[] {
  const maxLen = 180;
  if (text.length <= maxLen) {
    return [text];
  }
  const parts: string[] = [];
  let remaining = text.trim();
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf(' ', maxLen);
    if (cut < 40) {
      cut = maxLen;
    }
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) {
    parts.push(remaining);
  }
  return parts;
}

async function synthesizeWithGoogle(text: string): Promise<SynthesizedAudio> {
  const parts = splitForGoogleTts(text);
  const buffers: Buffer[] = [];
  const targetLang = hasDevanagari(text) ? 'hi' : 'en';

  for (const part of parts) {
    const url =
      `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${targetLang}&q=` +
      encodeURIComponent(part);
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'audio/mpeg,*/*',
        Referer: 'https://translate.google.com/',
      },
    });
    if (!response.ok) {
      throw new Error(`Google TTS failed (${response.status}).`);
    }
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength < 200) {
      throw new Error('Google TTS returned empty audio.');
    }
    buffers.push(Buffer.from(arrayBuffer));
  }

  return {
    buffer: Buffer.concat(buffers),
    mimeType: 'audio/mpeg',
  };
}

function stripSpokenNoise(text: string): string {
  return text
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function synthesizeSpeech(
  text: string,
  voice: SpidyVoice = 'female'
): Promise<SynthesizedAudio> {
  const cleaned = stripSpokenNoise(text);
  if (!cleaned) {
    throw new Error('Cannot synthesize empty text.');
  }

  try {
    return await synthesizeWithEdge(cleaned, voice);
  } catch (edgeError) {
    console.error('[tts] Edge neural voice failed, trying Google TTS fallback:', edgeError);
    return synthesizeWithGoogle(cleaned);
  }
}


