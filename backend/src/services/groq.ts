import path from 'path';
import dotenv from 'dotenv';
import {
  ConversationMessage,
  GroqChatCompletionResponse,
  GroqTranscriptionResponse,
  UserGender,
} from '../types';
import { buildSystemPrompt, NAME_ASK_PROMPT_HINT } from './personality';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const GROQ_API_KEY: string | undefined = process.env.GROQ_API_KEY;
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const WHISPER_MODEL = 'whisper-large-v3';
const CHAT_MODEL = process.env.GROQ_CHAT_MODEL || 'openai/gpt-oss-20b';

// Keep context bounded. Comedy gets worse when old conversation overwhelms the current setup.
const MAX_HISTORY_TURNS = 12;

function requireGroqKey(): string {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY environment variable is not set. Add it to backend/.env');
  }
  return GROQ_API_KEY;
}

export async function transcribeAudio(
  audioBuffer: Buffer,
  originalFileName: string,
  mimeType: string
): Promise<string> {
  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error('Audio buffer is empty. Record a longer clip and try again.');
  }

  const form = new FormData();
  const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType || 'audio/webm' });
  form.append('file', audioBlob, originalFileName || 'audio.webm');
  form.append('model', WHISPER_MODEL);
  form.append('response_format', 'json');

  const response = await fetch(`${GROQ_BASE_URL}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireGroqKey()}`,
    },
    body: form,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Groq transcription failed (${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as GroqTranscriptionResponse;

  if (!data.text || data.text.trim().length === 0) {
    throw new Error('Groq transcription returned empty text.');
  }

  return data.text.trim();
}

function extractReplyText(data: GroqChatCompletionResponse): string {
  const raw = data.choices?.[0]?.message?.content;
  if (typeof raw !== 'string') {
    return '';
  }

  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*(?:Joke|Roast|Reply|Shayari|Answer|Response)\s*:\s*/i, '')
    .trim();
}

/**
 * English is an explicit opt-in only.
 * Normal English questions such as "why is the sky blue?" do NOT count.
 * Hindi/Hinglish commands asking for English do count.
 */
function hasExplicitEnglishCommand(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[“”"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const patterns = [
    /\b(?:speak|talk|reply|respond|answer|chat|continue|communicate)\s+(?:to me\s+)?(?:only\s+)?in\s+english\b/,
    /\b(?:speak|talk|reply|respond|answer|chat|continue)\s+(?:in\s+)?english\b/,
    /\b(?:please|pls)?\s*(?:talk|speak|reply|respond|answer)\s+english\b/,
    /\b(?:only|just)\s+english\b/,
    /\benglish\s+(?:mein|me)\s+(?:baat|bolo|bol|baat karo|reply|answer|respond)\b/,
    /\b(?:mujhse|mujh se|mere se)\s+english\s+(?:mein|me)\s+(?:baat|baat karo|bolo|bol)\b/,
    /\b(?:ab|abse|ab se)\s+(?:english|angrezi)\s+(?:mein|me)\s+(?:baat|bolo|bol|reply|answer)\b/,
    /\b(?:english|angrezi)\s+mein\s+baat\s+karo\b/,
  ];

  return patterns.some((pattern) => pattern.test(normalized));
}

export function getResponseLanguage(userText: string): 'hindi' | 'english' {
  return hasExplicitEnglishCommand(userText) ? 'english' : 'hindi';
}

export async function getSpidyReply(
  userText: string,
  userName: string | null,
  history: ConversationMessage[],
  isNameCaptureTurn: boolean,
  gender: UserGender | null = null,
  facts: string[] = []
): Promise<string> {
  const trimmed = userText.trim();
  if (!trimmed) {
    throw new Error('User text is empty; cannot generate a reply.');
  }

  const responseLanguage = getResponseLanguage(trimmed);
  let systemPrompt = buildSystemPrompt(userName, gender, facts, responseLanguage);

  if (isNameCaptureTurn) {
    systemPrompt += ` ${NAME_ASK_PROMPT_HINT}`;
  }

  const recentHistory = history.slice(-MAX_HISTORY_TURNS).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const isReasoningModel = CHAT_MODEL.includes('gpt-oss') || CHAT_MODEL.includes('qwen');

  const body: Record<string, unknown> = {
    model: CHAT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      ...recentHistory,
      { role: 'user', content: trimmed },
    ],

    temperature: 1.15,
    max_completion_tokens: isReasoningModel ? 280 : 180,
  };

  if (isReasoningModel) {
    body.reasoning_effort = 'low';
    body.include_reasoning = false;
  }

  const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireGroqKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Groq chat completion failed (${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as GroqChatCompletionResponse;
  const content = extractReplyText(data);

  if (!content) {
    const finishReason = data.choices?.[0]?.finish_reason ?? 'unknown';
    throw new Error(
      `Groq chat completion returned empty content (model=${CHAT_MODEL}, finish_reason=${finishReason}).`
    );
  }

  return content;
}