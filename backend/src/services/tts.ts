import crypto from 'crypto';
import dotenv from 'dotenv';
import WebSocket from 'ws';
import { SpidyVoice, SynthesizedAudio } from '../types';

dotenv.config();

const EDGE_TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
// Real Hindi neural voices (not English-India accented ones).
const EDGE_VOICES: Record<SpidyVoice, string> = {
  female: 'hi-IN-SwaraNeural',
  male: 'hi-IN-MadhurNeural',
};
const SARVAM_SPEAKERS: Record<SpidyVoice, string> = {
  female: 'meera',
  male: 'shubh',
};
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0';

/**
 * Strips everything that a TTS engine mispronounces or reads aloud literally:
 * emojis, markdown emphasis/formatting characters, and quotation marks.
 * Always run text through this before sending it to any voice provider.
 */
export function sanitizeForSpeech(text: string): string {
  return text
    // Fenced/inline code — drop fences, keep inline code content.
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    // Markdown emphasis — keep the wrapped text, drop the markers.
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    // Markdown structure markers at line start.
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    // Markdown links — keep the label, drop the URL.
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Any leftover/unbalanced formatting or bullet characters.
    .replace(/[*_~`#•‣◦▪▫●○]/g, '')
    // Quotation marks of every flavor (straight + curly + guillemets).
    .replace(/["“”„‟❝❞«»‹›'‘’‛]/g, '')
    // Emoji: pictographs, emoji-presentation symbols, variation selector,
    // zero-width joiner, and the combining "enclosing keycap" mark.
    .replace(/\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u200D\uFE0F\u20E3]/gu, '')
    // Tidy up whitespace left behind by the removals above.
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

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
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='hi-IN'>` +
    `<voice name='${EDGE_VOICES[voice]}'>` +
    `<prosody rate='+4%'>${escapeXml(text)}</prosody>` +
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
  return { buffer: Buffer.concat(chunks), mimeType: 'audio/mpeg' };
}

function splitText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) {
    return [text];
  }
  const parts: string[] = [];
  let remaining = text.trim();
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf(' ', maxLen);
    if (cut < maxLen * 0.2) {
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
  const parts = splitText(text, 180);
  const buffers: Buffer[] = [];
  for (const part of parts) {
    const url =
      'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=hi&q=' +
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
  return { buffer: Buffer.concat(buffers), mimeType: 'audio/mpeg' };
}

/**
 * Sarvam AI — an official, India-focused TTS API with real Hindi voices
 * (not just Indian-accented English) and a genuine free tier (no card
 * required to start: https://dashboard.sarvam.ai). Unlike the Edge/Google
 * tricks above, this is a real API called with a key, so it isn't subject
 * to the browser-impersonation blocks that cloud/datacenter IPs commonly
 * hit — which is almost certainly why voice "works on local but not on
 * the deployed server" today. Set SARVAM_API_KEY to use it.
 */
async function synthesizeWithSarvam(text: string, voice: SpidyVoice): Promise<SynthesizedAudio> {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    throw new Error('SARVAM_API_KEY is not set.');
  }
  const parts = splitText(text, 2000); // bulbul:v3 hard limit is 2500 chars/request
  const buffers: Buffer[] = [];
  for (const part of parts) {
    const response = await fetch('https://api.sarvam.ai/text-to-speech/stream', {
      method: 'POST',
      headers: {
        'api-subscription-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: part,
        target_language_code: 'hi-IN',
        speaker: SARVAM_SPEAKERS[voice],
        model: 'bulbul:v3',
        output_audio_codec: 'mp3',
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Sarvam TTS failed (${response.status}): ${detail.slice(0, 200)}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength < 100) {
      throw new Error('Sarvam TTS returned empty audio.');
    }
    buffers.push(Buffer.from(arrayBuffer));
  }
  return { buffer: Buffer.concat(buffers), mimeType: 'audio/mpeg' };
}

export async function synthesizeSpeech(text: string, voice: SpidyVoice = 'female'): Promise<SynthesizedAudio> {
  const cleaned = sanitizeForSpeech(text.trim());
  if (!cleaned) {
    throw new Error('Cannot synthesize empty text.');
  }

  if (process.env.SARVAM_API_KEY) {
    try {
      return await synthesizeWithSarvam(cleaned, voice);
    } catch (sarvamError) {
      console.warn('[tts] Sarvam TTS failed, falling back to Edge/Google:', sarvamError);
    }
  }

  try {
    return await synthesizeWithEdge(cleaned, voice);
  } catch (edgeError) {
    console.warn('[tts] Edge voice failed, using Google TTS:', edgeError);
    return synthesizeWithGoogle(cleaned);
  }
}
