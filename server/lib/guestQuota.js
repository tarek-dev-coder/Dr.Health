import { config } from '../config.js';

const guestCounts = new Map();
const ipCounts = new Map();
let globalCount = 0;
let resetAt = nextUtcMidnight();

function nextUtcMidnight() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}

function resetIfNeeded() {
  if (Date.now() < resetAt) return;
  guestCounts.clear();
  ipCounts.clear();
  globalCount = 0;
  resetAt = nextUtcMidnight();
}

function retryAfterSeconds() {
  return Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
}

function countFor(map, key) {
  return map.get(key) || 0;
}

export function getGuestQuota(guestId, ip) {
  resetIfNeeded();
  const guestUsed = countFor(guestCounts, guestId);
  const ipUsed = countFor(ipCounts, ip);
  const remaining = Math.max(
    0,
    Math.min(
      config.guestDailyLimit - guestUsed,
      config.guestIpDailyLimit - ipUsed,
      config.guestGlobalDailyLimit - globalCount,
    ),
  );

  return {
    remaining,
    limit: config.guestDailyLimit,
    retryAfterSeconds: retryAfterSeconds(),
  };
}

/**
 * Reserve one guest request before calling the provider. This is deliberately
 * in-memory and per-process; a restart resets the daily counters. The signed
 * guest cookie prevents casual limit resets, and the IP/global limits still
 * bound abuse when cookies are cleared.
 */
export function consumeGuestQuota(guestId, ip) {
  resetIfNeeded();

  if (globalCount >= config.guestGlobalDailyLimit) {
    return { allowed: false, reason: 'global', retryAfterSeconds: retryAfterSeconds() };
  }
  if (countFor(guestCounts, guestId) >= config.guestDailyLimit) {
    return { allowed: false, reason: 'guest', retryAfterSeconds: retryAfterSeconds() };
  }
  if (countFor(ipCounts, ip) >= config.guestIpDailyLimit) {
    return { allowed: false, reason: 'ip', retryAfterSeconds: retryAfterSeconds() };
  }

  const nextGuestCount = countFor(guestCounts, guestId) + 1;
  const nextIpCount = countFor(ipCounts, ip) + 1;
  guestCounts.set(guestId, nextGuestCount);
  ipCounts.set(ip, nextIpCount);
  globalCount += 1;

  return {
    allowed: true,
    remaining: Math.max(
      0,
      Math.min(
        config.guestDailyLimit - nextGuestCount,
        config.guestIpDailyLimit - nextIpCount,
        config.guestGlobalDailyLimit - globalCount,
      ),
    ),
    limit: config.guestDailyLimit,
    retryAfterSeconds: retryAfterSeconds(),
  };
}

export function resetGuestQuotaForTests() {
  guestCounts.clear();
  ipCounts.clear();
  globalCount = 0;
  resetAt = nextUtcMidnight();
}
