import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from 'node:crypto';
import { config } from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_SALT = 'drhealth-openrouter-key-v1';

let cachedKey;

function getEncryptionKey() {
  if (cachedKey) return cachedKey;
  if (!config.keyEncryptionSecret) {
    throw new Error('KEY_ENCRYPTION_SECRET or SESSION_SECRET must be configured');
  }
  // Derive a fixed-length AES key from the deployment secret. The salt is
  // public; the secret supplies the entropy.
  cachedKey = scryptSync(config.keyEncryptionSecret, KEY_SALT, 32);
  return cachedKey;
}

export function encryptSecret(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('Cannot encrypt an empty secret');
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function decryptSecret({ ciphertext, iv, tag }) {
  if (
    typeof ciphertext !== 'string' ||
    typeof iv !== 'string' ||
    typeof tag !== 'string' ||
    ciphertext.length === 0
  ) {
    throw new Error('Encrypted secret is malformed');
  }

  let ivBuffer;
  let tagBuffer;
  let ciphertextBuffer;
  try {
    ivBuffer = Buffer.from(iv, 'base64');
    tagBuffer = Buffer.from(tag, 'base64');
    ciphertextBuffer = Buffer.from(ciphertext, 'base64');
  } catch {
    throw new Error('Encrypted secret is malformed');
  }

  if (ivBuffer.length !== IV_BYTES || tagBuffer.length !== 16 || ciphertextBuffer.length === 0) {
    throw new Error('Encrypted secret is malformed');
  }

  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), ivBuffer);
  decipher.setAuthTag(tagBuffer);
  const plaintext = Buffer.concat([decipher.update(ciphertextBuffer), decipher.final()]);
  return plaintext.toString('utf8');
}

export function hashSecret(plaintext) {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}
