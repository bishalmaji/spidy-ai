import { query } from './db';
import { GroqChatCompletionResponse } from '../types';

const EXPLICIT_FACT_PATTERNS: RegExp[] = [
  /remember that\s+(.+)/i,
  /remember i\s+(.+)/i,
  /yaad rakhna\s+(.+)/i,
  /yaad rakho\s+(.+)/i,
  /mujhe yaad rakhna\s+(.+)/i,
];

export function extractExplicitFact(transcript: string): string | null {
  const text = transcript.trim();
  if (!text) return null;
  for (const pattern of EXPLICIT_FACT_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const fact = match[1].trim().replace(/[.,!?"']+$/g, '').trim().slice(0, 200);
      if (fact.length >= 2) return fact;
    }
  }
  return null;
}

export async function saveExplicitFact(userId: string, factText: string): Promise<void> {
  const trimmed = factText.trim().slice(0, 200);
  if (!trimmed) return;
  await query(
    `INSERT INTO user_facts (user_id, fact_text, source)
     VALUES ($1, $2, 'explicit')`,
    [userId, trimmed]
  );
}

export async function registerFactCandidate(
  userId: string,
  normalizedText: string,
  rawText: string
): Promise<void> {
  const normalized = normalizedText.trim().toLowerCase().slice(0, 200);
  const raw = rawText.trim().slice(0, 200);
  if (!normalized) return;

  const upserted = await query<{ occurrence_count: number }>(
    `INSERT INTO fact_candidates (user_id, normalized_text, raw_text, occurrence_count, last_seen_at)
     VALUES ($1, $2, $3, 1, NOW())
     ON CONFLICT (user_id, normalized_text)
     DO UPDATE SET
       occurrence_count = fact_candidates.occurrence_count + 1,
       last_seen_at = NOW(),
       raw_text = EXCLUDED.raw_text
     RETURNING occurrence_count`,
    [userId, normalized, raw]
  );

  if (!upserted || !upserted.rows[0]) return;
  if (upserted.rows[0].occurrence_count < 3) return;

  const existing = await query<{ id: string }>(
    `SELECT id FROM user_facts
     WHERE user_id = $1 AND fact_text ILIKE $2
     LIMIT 1`,
    [userId, `%${normalized}%`]
  );
  if (!existing) return;
  if (existing.rows[0]) {
    await query(
      `UPDATE user_facts SET last_reinforced_at = NOW() WHERE id = $1`,
      [existing.rows[0].id]
    );
    return;
  }

  await query(
    `INSERT INTO user_facts (user_id, fact_text, source)
     VALUES ($1, $2, 'repeated')`,
    [userId, raw || normalized]
  );
}

export async function loadUserFacts(userId: string, limit = 12): Promise<string[]> {
  const result = await query<{ fact_text: string }>(
    `SELECT fact_text
     FROM user_facts
     WHERE user_id = $1
     ORDER BY last_reinforced_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  if (!result) return [];
  return result.rows.map((row) => row.fact_text);
}

function requireGroqKey(): string {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY environment variable is not set.');
  return key;
}

export async function extractFactCandidatesFromMessage(userText: string): Promise<string[]> {
  const trimmed = userText.trim();
  if (!trimmed) return [];

  const model = process.env.GROQ_CHAT_MODEL || 'openai/gpt-oss-20b';
  const isReasoningModel = model.includes('gpt-oss') || model.includes('qwen');
  const body: Record<string, unknown> = {
    model,
    messages: [
      {
        role: 'system',
        content:
          'From this single user message, extract 0-2 short factual statements about the user worth remembering long-term (interests, routines, preferences, people/things they mention often). Reply with a JSON array of short strings, or `[]` if none. No other text.',
      },
      { role: 'user', content: trimmed },
    ],
    temperature: 0.2,
    max_completion_tokens: isReasoningModel ? 256 : 120,
  };
  if (isReasoningModel) {
    body.reasoning_effort = 'low';
    body.include_reasoning = false;
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireGroqKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Fact extraction Groq call failed (${response.status}).`);
  }
  const data = (await response.json()) as GroqChatCompletionResponse;
  const raw = data.choices?.[0]?.message?.content;
  if (typeof raw !== 'string') return [];
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  const parsed: unknown = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(0, 2);
}

export function detectRepeatedFactsInBackground(userId: string, userText: string): void {
  void (async () => {
    try {
      const candidates = await extractFactCandidatesFromMessage(userText);
      for (const raw of candidates) {
        await registerFactCandidate(userId, raw.toLowerCase().trim(), raw);
      }
    } catch (error) {
      console.error('[facts] Repeated-topic detection failed:', error);
    }
  })();
}
