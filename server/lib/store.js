import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { config } from '../config.js';
import { logger } from './logger.js';

const { Pool } = pg;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// A single-process fallback for local development and tests. Production
// requires Postgres so encrypted keys survive restarts and deploys.
const memoryUsers = new Map();
let pool;
let schemaReady;

function isMemoryStore() {
  return !config.databaseUrl;
}

export function storeMode() {
  return isMemoryStore() ? 'memory' : 'postgres';
}

function getPool() {
  if (isMemoryStore()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    });
    pool.on('error', (error) => {
      // The pool emits connection errors asynchronously. Do not crash the
      // process; the next query will retry and the route will return 503.
      logger.error('db_pool_error', {
        code: error?.code,
        name: error?.name,
      });
    });
  }
  return pool;
}

async function ensureSchema() {
  if (isMemoryStore()) return;
  if (!schemaReady) {
    schemaReady = (async () => {
      const client = getPool();
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id uuid PRIMARY KEY,
          key_ciphertext text NOT NULL,
          key_iv text NOT NULL,
          key_tag text NOT NULL,
          key_hash text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          last_seen_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS users_created_at_idx ON users (created_at)
      `);
    })().catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }
  await schemaReady;
}

function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    keyCiphertext: row.key_ciphertext,
    keyIv: row.key_iv,
    keyTag: row.key_tag,
    keyHash: row.key_hash,
    createdAt: row.created_at,
  };
}

/**
 * Persist an encrypted per-user OpenRouter key. The plaintext key is never
 * accepted by this module.
 */
export async function createUser({ ciphertext, iv, tag, keyHash }) {
  const id = randomUUID();

  if (isMemoryStore()) {
    memoryUsers.set(id, {
      id,
      keyCiphertext: ciphertext,
      keyIv: iv,
      keyTag: tag,
      keyHash,
      createdAt: new Date(),
    });
    return { id };
  }

  await ensureSchema();
  await getPool().query(
    `INSERT INTO users (id, key_ciphertext, key_iv, key_tag, key_hash)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, ciphertext, iv, tag, keyHash],
  );
  return { id };
}

export async function getUser(userId) {
  if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) return null;

  if (isMemoryStore()) {
    return memoryUsers.get(userId) || null;
  }

  await ensureSchema();
  const result = await getPool().query(
    `SELECT id, key_ciphertext, key_iv, key_tag, key_hash, created_at
     FROM users WHERE id = $1`,
    [userId],
  );
  return toUser(result.rows[0]);
}

export async function deleteUser(userId) {
  if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) return;

  if (isMemoryStore()) {
    memoryUsers.delete(userId);
    return;
  }

  await ensureSchema();
  await getPool().query('DELETE FROM users WHERE id = $1', [userId]);
}

export async function touchUser(userId) {
  if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) return;

  if (isMemoryStore()) return;

  await ensureSchema();
  await getPool().query('UPDATE users SET last_seen_at = now() WHERE id = $1', [userId]);
}

export async function initStore() {
  await ensureSchema();
}

export async function closeStore() {
  if (pool) {
    await pool.end();
    pool = undefined;
    schemaReady = undefined;
  }
  memoryUsers.clear();
}
