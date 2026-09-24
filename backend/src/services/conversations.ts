import { query } from './db';
import { ConversationMessage } from '../types';

export async function getOrCreateActiveConversation(userId: string): Promise<string | null> {
  const existing = await query<{ id: string }>(
    'SELECT id FROM conversations WHERE user_id = $1 AND is_active = TRUE LIMIT 1',
    [userId]
  );
  if (!existing) return null;
  if (existing.rows[0]) return existing.rows[0].id;

  const inserted = await query<{ id: string }>(
    `INSERT INTO conversations (user_id, guest_device_id, is_active)
     VALUES ($1, NULL, TRUE)
     RETURNING id`,
    [userId]
  );
  if (!inserted || !inserted.rows[0]) return null;
  return inserted.rows[0].id;
}

export async function endActiveConversation(userId: string): Promise<boolean> {
  const result = await query(
    `UPDATE conversations
     SET is_active = FALSE, ended_at = NOW()
     WHERE user_id = $1 AND is_active = TRUE`,
    [userId]
  );
  return result !== null;
}

export async function appendMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<void> {
  await query(
    'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)',
    [conversationId, role, content]
  );
}

export async function loadRecentMessages(
  conversationId: string,
  limit = 16
): Promise<ConversationMessage[]> {
  const result = await query<{ role: 'user' | 'assistant'; content: string }>(
    `SELECT role, content FROM (
       SELECT role, content, created_at
       FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       LIMIT $2
     ) recent
     ORDER BY created_at ASC`,
    [conversationId, limit]
  );
  if (!result) return [];
  return result.rows.map((row) => ({ role: row.role, content: row.content }));
}

export async function createGuestConversation(guestDeviceId: string): Promise<string | null> {
  const result = await query<{ id: string }>(
    `INSERT INTO conversations (user_id, guest_device_id, is_active)
     VALUES (NULL, $1, TRUE)
     RETURNING id`,
    [guestDeviceId]
  );
  if (!result || !result.rows[0]) return null;
  return result.rows[0].id;
}
