import { ConversationMessage, SpidySession, SpidyVoice, VoicePreference } from '../types';

const SESSION_KEY = 'spidy-session-v1';
const VOICE_KEY = 'spidy-voice-v1';
const MAX_TURNS = 16;

function newSessionId(): string {
  if ('randomUUID' in crypto) return crypto.randomUUID();
  return `sess-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function freshSession(userName: string | null = null, needsName = true): SpidySession {
  const now = Date.now();
  return {
    sessionId: newSessionId(),
    userName,
    needsName,
    conversation: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function loadGuestSession(): SpidySession {
  const session = freshSession(null, true);
  saveSession(session);
  return session;
}

export function loadRegisteredSession(nickname: string): SpidySession {
  return freshSession(nickname, false);
}

export function saveSession(session: SpidySession): void {
  session.updatedAt = Date.now();
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (error) {
    console.error('[session] Failed to persist session:', error);
  }
}

export function appendTurn(
  session: SpidySession,
  userText: string,
  aiText: string,
  persist: boolean
): SpidySession {
  const turns: ConversationMessage[] = [
    ...session.conversation,
    { role: 'user', content: userText },
    { role: 'assistant', content: aiText },
  ];
  session.conversation = turns.slice(-MAX_TURNS);
  if (persist) saveSession(session);
  return session;
}

export function setName(session: SpidySession, name: string): SpidySession {
  session.userName = name;
  session.needsName = false;
  saveSession(session);
  return session;
}

export function startNewSession(userName: string | null = null, needsName = true): SpidySession {
  const session = freshSession(userName, needsName);
  if (needsName) saveSession(session);
  return session;
}

export function loadVoicePreference(): SpidyVoice {
  try {
    const raw = localStorage.getItem(VOICE_KEY);
    if (!raw) return 'female';
    const parsed = JSON.parse(raw) as VoicePreference;
    return parsed.voice === 'male' ? 'male' : 'female';
  } catch {
    return 'female';
  }
}

export function saveVoicePreference(voice: SpidyVoice): void {
  try {
    localStorage.setItem(VOICE_KEY, JSON.stringify({ voice } satisfies VoicePreference));
  } catch (error) {
    console.error('[session] Failed to persist voice preference:', error);
  }
}
