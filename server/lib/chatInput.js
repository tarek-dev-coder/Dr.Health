import { z } from 'zod';
import { config } from '../config.js';
import { badRequest } from './errors.js';
import { sanitizeText } from './text.js';

const MAX_RAW_HISTORY_CHARS = 250000;

export function parseMessage(rawMessage, maxChars = config.chatMaxMessageChars) {
  if (rawMessage === undefined) return '';

  if (typeof rawMessage !== 'string') {
    throw badRequest('The message must be text.', 'INVALID_MESSAGE');
  }

  const message = sanitizeText(rawMessage);
  if (message.length > maxChars) {
    throw badRequest(`The message must be ${maxChars} characters or fewer.`, 'MESSAGE_TOO_LONG');
  }
  return message;
}

export function parseHistory(
  rawHistory,
  {
    maxTurns = config.chatMaxHistoryTurns,
    maxChars = config.chatMaxHistoryChars,
    maxTurnChars = config.chatMaxMessageChars,
  } = {},
) {
  if (rawHistory === undefined || rawHistory === null || rawHistory === '') return [];

  let value = rawHistory;
  if (typeof rawHistory === 'string') {
    if (rawHistory.length > MAX_RAW_HISTORY_CHARS) {
      throw badRequest('Conversation history is too large. Start a new chat.', 'HISTORY_TOO_LARGE');
    }
    try {
      value = JSON.parse(rawHistory);
    } catch {
      throw badRequest('Conversation history must be valid JSON.', 'INVALID_HISTORY');
    }
  } else if (typeof rawHistory !== 'object') {
    throw badRequest('Conversation history is invalid.', 'INVALID_HISTORY');
  }

  const turnSchema = z
    .object({
      role: z.enum(['user', 'model']),
      text: z.string().min(1).max(maxTurnChars),
    })
    .strict();
  const parsed = z.array(turnSchema).max(maxTurns).safeParse(value);
  if (!parsed.success) {
    throw badRequest('Conversation history is invalid.', 'INVALID_HISTORY');
  }

  const turns = parsed.data
    .map((turn) => ({ role: turn.role, text: sanitizeText(turn.text) }))
    .filter((turn) => turn.text.length > 0);

  const totalChars = turns.reduce((total, turn) => total + turn.text.length, 0);
  if (totalChars > maxChars) {
    throw badRequest('Conversation history is too large. Start a new chat.', 'HISTORY_TOO_LARGE');
  }

  return turns;
}
