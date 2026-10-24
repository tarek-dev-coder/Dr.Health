import { promisify } from 'node:util';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const scryptAsync = promisify(scrypt);

const PARAMS = Object.freeze({ N: 32768, r: 8, p: 1, keylen: 64 });
const MAX_MEM = 256 * 1024 * 1024;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 1024;

/**
 * Hash a password with scrypt using a random 16-byte salt.
 * Format: scrypt$N$r$p$saltBase64$hashBase64
 */
export async function hashPassword(password) {
  if (typeof password !== 'string') {
    throw new TypeError('Password must be a string');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Password must be at most ${MAX_PASSWORD_LENGTH} characters`);
  }

  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, PARAMS.keylen, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    maxmem: MAX_MEM,
  });
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    Buffer.from(derived).toString('base64'),
  ].join('$');
}

/**
 * Verify a password against a stored scrypt hash in constant time.
 * Returns false for malformed hashes instead of throwing.
 */
export async function verifyPassword(password, storedHash) {
  try {
    if (typeof password !== 'string' || typeof storedHash !== 'string') return false;
    if (password.length > MAX_PASSWORD_LENGTH) return false;

    const parts = storedHash.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const isPowerOfTwo = (value) => Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;

    // Bounds prevent a maliciously crafted hash from exhausting server memory.
    if (!isPowerOfTwo(N) || N < 16384 || N > 131072) return false;
    if (!Number.isInteger(r) || r < 8 || r > 32) return false;
    if (!Number.isInteger(p) || p < 1 || p > 4) return false;

    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    if (salt.length < 16 || expected.length < 32) return false;

    const derived = await scryptAsync(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: Math.max(MAX_MEM, 256 * N * r),
    });
    const actual = Buffer.from(derived);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
