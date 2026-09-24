export type SpidyVoice = 'female' | 'male';

export type UserGender = 'male' | 'female' | 'neutral';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface UserRecord {
  id: string;
  email: string;
  nickname: string;
  gender: UserGender;
}

export interface ChatRequestContext {
  /** Whether Spidy still needs to learn the user's name in this session. */
  needsName: boolean;
  /** Known name, if any (used once needsName is false). */
  userName: string | null;
  /** Prior turns, most-recent-last. Frontend caps this before sending. */
  history: ConversationMessage[];
  voice: SpidyVoice;
}

export interface ChatResponsePayload {
  userText: string;
  aiText: string;
  audioBase64: string;
  audioMimeType: string;
  /** Name extracted from this turn, if this turn was a name-capture turn. */
  extractedName: string | null;
}

export interface GroqTranscriptionResponse {
  text: string;
}

export interface GroqChatCompletionChoice {
  finish_reason?: string;
  message: {
    role: string;
    content?: string | null;
    reasoning?: string | null;
  };
}

export interface GroqChatCompletionResponse {
  choices: GroqChatCompletionChoice[];
}

export interface SynthesizedAudio {
  buffer: Buffer;
  mimeType: string;
}
