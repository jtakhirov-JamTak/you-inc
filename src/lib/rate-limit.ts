// Rate limiter with Upstash Redis backend and in-memory fallback.
//
// When UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set, uses
// Upstash Ratelimit (works across serverless instances, survives restarts).
// When not set (local dev), falls back to a simple in-memory sliding window.

import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import * as Sentry from "@sentry/nextjs";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

// ---------------------------------------------------------------------------
// Upstash backend (production)
// ---------------------------------------------------------------------------

const USE_UPSTASH =
  !!process.env.UPSTASH_REDIS_REST_URL &&
  !!process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = USE_UPSTASH
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  : null;

// Cache Ratelimit instances by limit:windowMs combo (only ~5 unique combos).
const upstashLimiters = new Map<string, Ratelimit>();

// If Upstash credentials rotate in prod, every request fires a capture —
// thousands per minute, blows Sentry quota and hides the real signal.
// Latch: capture at most once per 5 min across the whole instance.
const UPSTASH_CAPTURE_COOLDOWN_MS = 5 * 60 * 1000;
let lastUpstashCaptureAt = 0;

function getUpstashLimiter(limit: number, windowMs: number): Ratelimit {
  const key = `${limit}:${windowMs}`;
  let limiter = upstashLimiters.get(key);
  if (!limiter) {
    // Convert ms to seconds for Upstash window specification.
    const windowSec = Math.max(1, Math.round(windowMs / 1000));
    const windowStr = `${windowSec} s` as `${number} s`;
    limiter = new Ratelimit({
      redis: redis!,
      limiter: Ratelimit.slidingWindow(limit, windowStr),
      prefix: "rl",
    });
    upstashLimiters.set(key, limiter);
  }
  return limiter;
}

async function rateLimitUpstash(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  try {
    const limiter = getUpstashLimiter(limit, windowMs);
    const result = await limiter.limit(key);
    return {
      allowed: result.success,
      remaining: result.remaining,
      resetAt: result.reset,
    };
  } catch {
    // Upstash unreachable or credentials invalid — fall back to in-memory
    // so the route still works instead of 500-ing every request.
    // Capture at most once per cooldown window. Wrap in a synthetic Error
    // so we never ship Upstash's own error.message (which can embed the
    // REST URL token hint).
    const now = Date.now();
    if (now - lastUpstashCaptureAt > UPSTASH_CAPTURE_COOLDOWN_MS) {
      lastUpstashCaptureAt = now;
      Sentry.captureException(new Error("upstash_unavailable"), {
        tags: { area: "rate-limit", kind: "upstash-fallback" },
      });
    }
    console.error("rate-limit: Upstash failed, falling back to in-memory");
    return rateLimitInMemory(key, limit, windowMs);
  }
}

// ---------------------------------------------------------------------------
// In-memory fallback (local dev)
// ---------------------------------------------------------------------------

type Bucket = { count: number; windowStart: number };
const buckets = new Map<string, Bucket>();

function rateLimitInMemory(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || now - existing.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.windowStart + windowMs,
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: limit - existing.count,
    resetAt: existing.windowStart + windowMs,
  };
}

// ---------------------------------------------------------------------------
// Public API (unchanged signature, now async)
// ---------------------------------------------------------------------------

export async function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): Promise<RateLimitResult> {
  if (USE_UPSTASH) {
    return rateLimitUpstash(key, limit, windowMs);
  }
  return rateLimitInMemory(key, limit, windowMs);
}
