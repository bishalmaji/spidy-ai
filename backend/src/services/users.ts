import crypto from 'crypto';
import { query } from './db';
import { SpidyVoice, UserGender, UserRecord } from '../types';

export type FindOrCreateResult =
  | { exists: true; user: UserRecord }
  | { exists: false };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isGender(value: unknown): value is UserGender {
  return value === 'male' || value === 'female' || value === 'neutral';
}

function rowToUser(row: {
  id: string;
  email: string;
  nickname: string;
  gender: string;
}): UserRecord {
  return {
    id: row.id,
    email: row.email,
    nickname: row.nickname,
    gender: isGender(row.gender) ? row.gender : 'neutral',
  };
}

export async function findOrCreateUser(
  email: string,
  nickname?: string,
  gender?: UserGender
): Promise<FindOrCreateResult | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const existing = await query<{
    id: string;
    email: string;
    nickname: string;
    gender: string;
  }>('SELECT id, email, nickname, gender FROM users WHERE email = $1', [normalized]);

  if (!existing) return null;

  if (existing.rows[0]) {
    return { exists: true, user: rowToUser(existing.rows[0]) };
  }

  const nick = typeof nickname === 'string' ? nickname.trim().slice(0, 40) : '';
  if (!nick || !isGender(gender)) {
    return { exists: false };
  }

  const inserted = await query<{
    id: string;
    email: string;
    nickname: string;
    gender: string;
  }>(
    `INSERT INTO users (email, nickname, gender)
     VALUES ($1, $2, $3)
     RETURNING id, email, nickname, gender`,
    [normalized, nick, gender]
  );

  if (!inserted || !inserted.rows[0]) return null;
  return { exists: true, user: rowToUser(inserted.rows[0]) };
}

export async function issueAuthToken(userId: string): Promise<string | null> {
  const token = crypto.randomBytes(32).toString('hex');
  const result = await query(
    'INSERT INTO auth_tokens (token, user_id) VALUES ($1, $2)',
    [token, userId]
  );
  if (!result) return null;
  return token;
}

export async function getUserByToken(token: string): Promise<UserRecord | null> {
  if (!token) return null;
  const result = await query<{ user_id: string }>(
    `UPDATE auth_tokens
     SET last_seen_at = NOW()
     WHERE token = $1
     RETURNING user_id`,
    [token]
  );
  if (!result || !result.rows[0]) return null;

  const userRow = await query<{
    id: string;
    email: string;
    nickname: string;
    gender: string;
  }>(
    'SELECT id, email, nickname, gender FROM users WHERE id = $1',
    [result.rows[0].user_id]
  );
  if (!userRow || !userRow.rows[0]) return null;
  return rowToUser(userRow.rows[0]);
}

export async function revokeToken(token: string): Promise<boolean> {
  if (!token) return false;
  const result = await query('DELETE FROM auth_tokens WHERE token = $1', [token]);
  return result !== null;
}

export function mapGenderToVoice(gender: UserGender): SpidyVoice {
  if (gender === 'male') return 'female';
  return 'male';
}

export function parseBearerToken(header: unknown): string | null {
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}
