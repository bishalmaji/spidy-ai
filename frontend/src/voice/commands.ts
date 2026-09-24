/**
 * These are checked against the transcript of a completed tap-to-talk turn
 * (this build has no mid-utterance realtime detection — see README).
 */
const NEW_SESSION_PHRASES = [
  'new session',
  'new chat',
  'start fresh',
  'forget this conversation',
  'forget our conversation',
  'naya session',
  'nayi baat',
  'sab bhool jao',
  'bhool ja',
];

export function isNewSessionCommand(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return NEW_SESSION_PHRASES.some((phrase) => normalized.includes(phrase));
}
