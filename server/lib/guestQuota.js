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

function remainingFor(guestId, ip) {
  return Math.max(
    0,
    Math.min(
      config.guestDailyLimit - countFor(guestCounts, guestId),
      config.guestIpDailyLimit - countFor(ipCounts, ip),
      config.guestGlobalDailyLimit - globalCount,
    ),
  );
}

export function getGuestQuota(guestId, ip) {
  resetIfNeeded();
  return {
    remaining: remainingFor(guestId, ip),
    limit: config.guestDailyLimit,
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

  if (
    globalCount >= config.guestGlobalDailyLimit ||
    countFor(guestCounts, guestId) >= config.guestDailyLimit ||
    countFor(ipCounts, ip) >= config.guestIpDailyLimit
  ) {
    return { allowed: false, retryAfterSeconds: retryAfterSeconds() };
  }

  guestCounts.set(guestId, countFor(guestCounts, guestId) + 1);
  ipCounts.set(ip, countFor(ipCounts, ip) + 1);
  globalCount += 1;

  return {
    allowed: true,
    remaining: remainingFor(guestId, ip),
    limit: config.guestDailyLimit,
  };
}

export function resetGuestQuotaForTests() {
  guestCounts.clear();
  ipCounts.clear();
  globalCount = 0;
  resetAt = nextUtcMidnight();
}
