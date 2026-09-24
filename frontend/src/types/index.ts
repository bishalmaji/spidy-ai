export type SpidyVoice = 'female' | 'male';

export type UserGender = 'male' | 'female' | 'neutral';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SpidyUser {
  id: string;
  email: string;
  nickname: string;
  gender: UserGender;
}

export interface SpidySession {
  sessionId: string;
  userName: string | null;
  needsName: boolean;
  conversation: ConversationMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface VoicePreference {
  voice: SpidyVoice;
}

export type AppVoiceState =
  | 'initializing'
  | 'permission_required'
  | 'connecting'
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error';

export interface ChatApiResponse {
  userText: string;
  aiText: string;
  audioBase64: string;
  audioMimeType: string;
  extractedName: string | null;
}

export interface GreetApiResponse {
  aiText: string;
  audioBase64: string;
  audioMimeType: string;
}

export type AuthContinueResponse =
  | { status: 'new'; email: string }
  | { status: 'ok'; token: string; user: SpidyUser };
