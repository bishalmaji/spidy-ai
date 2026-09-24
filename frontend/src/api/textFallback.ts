import { ChatApiResponse, ConversationMessage, SpidyVoice } from '../types';
import { loadAuthToken } from '../session/authStore';

const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export async function sendTextTurn(params: {
  text: string;
  userName: string | null;
  needsName: boolean;
  history: ConversationMessage[];
  voice: SpidyVoice;
  guestDeviceId: string;
  guestVisitId: string;
  registered: boolean;
}): Promise<ChatApiResponse> {
  const token = loadAuthToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const body: Record<string, unknown> = {
    text: params.text,
    guestDeviceId: params.guestDeviceId,
    guestVisitId: params.guestVisitId,
  };
  if (!params.registered) {
    body.userName = params.userName;
    body.needsName = params.needsName;
    body.history = params.history;
    body.voice = params.voice;
  }

  const response = await fetch(`${API_BASE_URL}/api/chat-text`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const json = await response.json();
      if (json?.error) message = json.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return response.json() as Promise<ChatApiResponse>;
}
