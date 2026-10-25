import { config } from '../config.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const GUEST_SYSTEM_PROMPT = `You are Dr.Health, a medical information assistant.

Answer accurately and concisely, aiming for under 250 words, using evidence-based clinical knowledge. Never diagnose, prescribe medication, or give exact dosages. If the user describes a possible emergency, tell them to contact local emergency services immediately. Do not ask for or repeat identifying information. This assistant is text-only: if the user asks you to interpret an image, explain that you cannot view images. This is for informational purposes only and is not a substitute for professional medical advice. Never disclose the underlying model name, provider, vendor, or technical architecture.`;

const CIRCUIT_OPEN_MS = 60000;

let circuitOpenUntil = 0;
let activeRequests = 0;

function extractText(data) {
  const message = data?.choices?.[0]?.message;
  if (!message) return '';

  if (typeof message.content === 'string') return message.content.trim();
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (typeof part === 'string') return part;
        return typeof part?.text === 'string' ? part.text : '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

function parseRetryAfter(response) {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter && /^\d{1,6}$/.test(retryAfter.trim())) {
    const seconds = Number(retryAfter.trim());
    if (seconds > 0) return seconds;
  }
  return 30;
}

function buildMessages(history, message) {
  return [
    { role: 'system', content: GUEST_SYSTEM_PROMPT },
    ...history.map((turn) => ({
      role: turn.role === 'model' ? 'assistant' : 'user',
      content: turn.text,
    })),
    { role: 'user', content: message },
  ];
}

/**
 * Text-only provider call. The default endpoint is keyless; if GUEST_API_KEY
 * is configured (for example when using LLM7), it is sent only from the server.
 */
export async function generateGuestReply({ history, message, requestId }) {
  if (Date.now() < circuitOpenUntil) {
    throw new AppError(
      503,
      'GUEST_BUSY',
      'The assistant is busy right now. Please try again shortly.',
      { retryAfterSeconds: 30 },
    );
  }

  if (activeRequests >= config.guestMaxConcurrent) {
    throw new AppError(
      429,
      'GUEST_BUSY',
      'The assistant is busy right now. Please try again in a moment.',
      { retryAfterSeconds: 10 },
    );
  }

  activeRequests += 1;
  const startedAt = Date.now();

  try {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (config.guestApiKey) {
      headers.Authorization = `Bearer ${config.guestApiKey}`;
    }

    logger.debug('guest_request_started', {
      requestId,
      timeoutMs: config.guestTimeoutMs,
    });

    let response;
    try {
      response = await fetch(config.guestApiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.guestModel,
          messages: buildMessages(history, message),
          max_tokens: config.guestMaxOutputTokens,
          temperature: 0.3,
          stream: false,
        }),
        signal: AbortSignal.timeout(config.guestTimeoutMs),
      });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
        logger.warn('guest_timeout', { requestId, durationMs });
        throw new AppError(
          504,
          'GUEST_TIMEOUT',
          'The assistant took too long to respond. Please try again.',
        );
      }

      circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
      logger.error('guest_request_failed', {
        requestId,
        durationMs,
        errorName: error?.name,
        errorCode: error?.code,
      });
      throw new AppError(
        503,
        'GUEST_UNAVAILABLE',
        'The assistant is unavailable right now. Please try again later.',
      );
    }

    if (!response.ok) {
      const durationMs = Date.now() - startedAt;

      if (response.status === 429) {
        const retryAfterSeconds = parseRetryAfter(response);
        logger.warn('guest_rate_limited', { requestId, durationMs, retryAfterSeconds });
        throw new AppError(
          429,
          'GUEST_BUSY',
          'The assistant is busy right now. Please try again shortly.',
          { retryAfterSeconds },
        );
      }

      if (response.status >= 500) {
        circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
      }

      logger.warn('guest_upstream_error', {
        requestId,
        status: response.status,
        durationMs,
      });
      throw new AppError(
        503,
        'GUEST_UNAVAILABLE',
        'The assistant is unavailable right now. Please try again later.',
      );
    }

    let data;
    try {
      data = await response.json();
    } catch {
      circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
      logger.warn('guest_bad_response', { requestId, durationMs: Date.now() - startedAt });
      throw new AppError(503, 'GUEST_UNAVAILABLE', 'The assistant returned an unreadable response.');
    }

    const text = extractText(data);
    if (!text) {
      logger.warn('guest_empty_response', {
        requestId,
        durationMs: Date.now() - startedAt,
        finishReason: data?.choices?.[0]?.finish_reason,
      });
      throw new AppError(503, 'GUEST_EMPTY_RESPONSE', 'The assistant did not return a usable response.');
    }

    const usage = data?.usage ?? {};
    logger.info('guest_request_completed', {
      requestId,
      durationMs: Date.now() - startedAt,
      finishReason: data?.choices?.[0]?.finish_reason,
      promptTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
    });

    return text.slice(0, config.guestMaxResponseChars);
  } finally {
    activeRequests = Math.max(0, activeRequests - 1);
  }
}

export function resetGuestCircuitForTests() {
  circuitOpenUntil = 0;
  activeRequests = 0;
}
