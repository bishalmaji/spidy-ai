/**
 * Pulls a first name out of a spoken answer to "what's your name?".
 * Handles the common English / Hindi / Hinglish phrasings without
 * trying to be a full NLP pipeline.
 */

const STOPWORDS = new Set([
  'my', 'name', 'is', 'i', 'am', "i'm", 'im', 'call', 'me', 'people',
  'mera', 'naam', 'name', 'hai', 'hain', 'mai', 'main', 'mujhe', 'mujhey',
  'bolte', 'bolते', 'hei', 'ha', 'the', 'a', 'an', 'well', 'so', 'uh', 'um',
]);

const NAME_PATTERNS: RegExp[] = [
  /my name(?:'s| is)\s+([a-zA-Z][a-zA-Z .'-]{0,30})/i,
  /i\s*am\s+([a-zA-Z][a-zA-Z .'-]{0,30})/i,
  /i'?m\s+([a-zA-Z][a-zA-Z .'-]{0,30})/i,
  /call me\s+([a-zA-Z][a-zA-Z .'-]{0,30})/i,
  /people call me\s+([a-zA-Z][a-zA-Z .'-]{0,30})/i,
  /mera naam\s+([a-zA-Z\u0900-\u097F .'-]{1,30}?)\s*(?:hai|hain)?$/i,
  /mai\s*n?\s+([a-zA-Z\u0900-\u097F .'-]{1,30}?)\s*(?:hoon|hun|hu)/i,
  /naam\s+([a-zA-Z\u0900-\u097F .'-]{1,30}?)\s*(?:hai|hain)?$/i,
];

function cleanCandidate(raw: string): string {
  let name = raw.trim();
  // Strip trailing filler like "hai", "hoon", punctuation.
  name = name.replace(/\b(hai|hain|hoon|hun|hu)\b\.?$/i, '').trim();
  name = name.replace(/[.,!?"']+$/g, '').trim();
  // Keep only the first 1-2 words — first names, not whole sentences.
  const words = name.split(/\s+/).filter(Boolean);
  const kept = words.slice(0, 2).filter((w) => !STOPWORDS.has(w.toLowerCase()));
  const finalWords = kept.length > 0 ? kept.slice(0, 1) : words.slice(0, 1);
  const result = finalWords.join(' ').trim();
  if (!result) return '';
  return result.charAt(0).toUpperCase() + result.slice(1);
}

export function extractName(spokenText: string): string | null {
  const text = spokenText.trim();
  if (!text) return null;

  for (const pattern of NAME_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const cleaned = cleanCandidate(match[1]);
      if (cleaned && cleaned.length <= 24) return cleaned;
    }
  }

  // No pattern matched — if the whole answer is short (1-3 words),
  // assume they just said their name directly ("Rahul.").
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 3) {
    const cleaned = cleanCandidate(text);
    if (cleaned) return cleaned;
  }

  return null;
}
