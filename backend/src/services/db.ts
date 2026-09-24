import path from 'path';
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function connectionString(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    url.searchParams.delete('channel_binding');
    return url.toString();
  } catch {
    return raw;
  }
}

const databaseUrl = connectionString();

export const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl ? { rejectUnauthorized: false } : undefined,
  max: 5,
  connectionTimeoutMillis: 8000,
  idleTimeoutMillis: 30_000,
});

let dbReady = false;

export function isDatabaseReady(): boolean {
  return dbReady;
}

export async function testDatabaseConnection(): Promise<boolean> {
  if (!databaseUrl) {
    console.warn('[db] DATABASE_URL is not set — auth/personalization will degrade to guest-like behavior. Chat still works.');
    dbReady = false;
    return false;
  }
  try {
    await pool.query('SELECT 1');
    dbReady = true;
    console.log('[db] Connected to Postgres.');
    return true;
  } catch (error) {
    dbReady = false;
    console.warn(
      '[db] Database unreachable — auth/personalization will degrade to guest-like behavior. Chat still works.',
      error
    );
    return false;
  }
}

export async function query<T extends import('pg').QueryResultRow = import('pg').QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<import('pg').QueryResult<T> | null> {
  try {
    const result = await pool.query<T>(text, params);
    dbReady = true;
    return result;
  } catch (error) {
    dbReady = false;
    console.warn('[db] Query failed:', error);
    return null;
  }
}
