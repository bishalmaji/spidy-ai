import {
  AuthContinueResponse,
  ChatApiResponse,
  ConversationMessage,
  GreetApiResponse,
  SpidyUser,
  SpidyVoice,
  UserGender,
} from '../types';
import { loadAuthToken } from '../session/authStore';

const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra || {}) };
  const token = loadAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function parseOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export async function sendVoiceTurn(params: {
  audioBlob: Blob;
  userName: string | null;
  needsName: boolean;
  history: ConversationMessage[];
  voice: SpidyVoice;
  guestDeviceId: string;
  guestVisitId: string;
  registered: boolean;
}): Promise<ChatApiResponse> {
  const form = new FormData();
  form.append('audio', params.audioBlob, 'turn.webm');
  form.append('guestDeviceId', params.guestDeviceId);
  form.append('guestVisitId', params.guestVisitId);
  if (!params.registered) {
    form.append('userName', params.userName ?? '');
    form.append('needsName', String(params.needsName));
    form.append('history', JSON.stringify(params.history));
    form.append('voice', params.voice);
  }

  const response = await fetch(`${API_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  return parseOrThrow<ChatApiResponse>(response);
}

export async function fetchGreeting(voice: SpidyVoice): Promise<GreetApiResponse> {
  const response = await fetch(`${API_BASE_URL}/api/greet`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ voice }),
  });
  return parseOrThrow<GreetApiResponse>(response);
}

export async function continueAuth(body: {
  email: string;
  nickname?: string;
  gender?: UserGender;
}): Promise<AuthContinueResponse> {
  const response = await fetch(`${API_BASE_URL}/api/auth/continue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseOrThrow<AuthContinueResponse>(response);
}

export async function fetchMe(): Promise<SpidyUser | null> {
  const token = loadAuthToken();
  if (!token) return null;
  const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
    method: 'GET',
    headers: authHeaders(),
  });
  if (response.status === 401) return null;
  const data = await parseOrThrow<{ user: SpidyUser }>(response);
  return data.user;
}

export async function logoutAuth(token: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  await parseOrThrow<{ status: string }>(response);
}

export async function startNewServerSession(): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/session/new`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({}),
  });
  await parseOrThrow<{ status: string }>(response);
}
