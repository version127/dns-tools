type RateLimitEntry = {
  requests: number;
  units: number;
  resetAt: number;
};

type RateLimitOptions = {
  now?: number;
  windowMs?: number;
  maxRequests?: number;
  maxUnits?: number;
};

const entries = new Map<string, RateLimitEntry>();

export function rateLimitCost(selection: string) {
  return selection === "all" ? 11 : 1;
}

export function consumeDnsLookupLimit(
  key: string,
  cost: number,
  options: RateLimitOptions = {},
) {
  const now = options.now ?? Date.now();
  const windowMs = options.windowMs ?? 5 * 60 * 1000;
  const maxRequests = options.maxRequests ?? 100;
  const maxUnits = options.maxUnits ?? 220;
  let entry = entries.get(key);

  if (!entry || entry.resetAt <= now) {
    entry = { requests: 0, units: 0, resetAt: now + windowMs };
  }

  const allowed = entry.requests + 1 <= maxRequests && entry.units + cost <= maxUnits;
  if (allowed) {
    entry.requests += 1;
    entry.units += cost;
    entries.set(key, entry);
  }

  if (entries.size > 5000) {
    for (const [entryKey, value] of entries) {
      if (value.resetAt <= now) entries.delete(entryKey);
    }
  }

  return {
    allowed,
    remainingRequests: Math.max(0, maxRequests - entry.requests),
    remainingUnits: Math.max(0, maxUnits - entry.units),
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
  };
}

export function clearDnsLookupLimitsForTests() {
  entries.clear();
}
