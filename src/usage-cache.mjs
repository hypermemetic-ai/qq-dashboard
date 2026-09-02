import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { normalizeUsage } from "./snapshot.mjs";

export const USAGE_CACHE_SCHEMA = "qq.dashboard-usage/v1";
export const MAX_USAGE_CACHE_BYTES = 131_072;
export const PROVIDER_STALE_MAX_MS = 6 * 60 * 60 * 1000;
export const PROVIDER_STALE_MAX_MS_BY_ID = Object.freeze({
  codex: PROVIDER_STALE_MAX_MS,
  grok: PROVIDER_STALE_MAX_MS,
});
const STATES = new Set(["ready", "estimated", "stale", "unavailable"]);
const PROVIDERS = new Set(["codex", "grok", "qwen"]);
const PROVIDER_LABELS = new Map([["codex", "Codex"], ["grok", "Grok"], ["qwen", "Qwen"]]);
const PROVIDER_ISSUES = new Set([
  null, "login-required", "configuration", "provider-error", "response-error", "temporary",
]);

function providerIssue(provider) {
  return provider.issue === undefined ? null : provider.issue;
}

function providerStaleMaxMs(id) {
  return PROVIDER_STALE_MAX_MS_BY_ID[id] ?? 0;
}

function providerDetail(provider) {
  if (provider.state !== "stale") return "";
  switch (providerIssue(provider)) {
    case "login-required": return `run qq-models-login ${provider.id}`;
    case "configuration": return "check qq-models auth configuration";
    case "provider-error": return "provider rejected usage request";
    case "response-error": return "provider response unsupported";
    case "temporary": return "temporary provider failure";
    default: return "";
  }
}

function epoch(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function nonempty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validEnvelope(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)
    || candidate.schema !== USAGE_CACHE_SCHEMA || !epoch(candidate.generatedAt)
    || !Array.isArray(candidate.providers) || candidate.providers.length !== PROVIDERS.size) return false;
  const providers = new Set();
  for (const provider of candidate.providers) {
    if (!provider || typeof provider !== "object" || Array.isArray(provider)
      || !PROVIDERS.has(provider.id) || providers.has(provider.id)
      || provider.label !== PROVIDER_LABELS.get(provider.id) || !STATES.has(provider.state)
      || (provider.id !== "qwen" && provider.state !== "ready"
        && provider.state !== "stale" && provider.state !== "unavailable")
      || !PROVIDER_ISSUES.has(providerIssue(provider))
      || (provider.id === "qwen" && providerIssue(provider) !== null)
      || ((provider.state === "ready" || provider.state === "estimated")
        && providerIssue(provider) !== null)
      || !(provider.observedAt === null || epoch(provider.observedAt))
      || (provider.observedAt !== null && provider.observedAt > candidate.generatedAt)
      || !Array.isArray(provider.meters)) return false;
    providers.add(provider.id);
    if (provider.state === "unavailable") {
      if (provider.observedAt !== null || provider.meters.length !== 0) return false;
    } else if (provider.observedAt === null || provider.meters.length === 0) {
      return false;
    }
    const meters = new Set();
    for (const meter of provider.meters) {
      if (!meter || typeof meter !== "object" || Array.isArray(meter)
        || !nonempty(meter.id) || meters.has(meter.id) || !nonempty(meter.label)
        || !Number.isFinite(meter.usedRatio) || meter.usedRatio < 0
        || (provider.id !== "qwen" && meter.usedRatio > 1)
        || !(meter.resetAt === null || epoch(meter.resetAt))
        || typeof meter.detail !== "string") return false;
      meters.add(meter.id);
      if (provider.id === "qwen") {
        if ((meter.id !== "weekly" && meter.id !== "five-hour")
          || (meter.id === "weekly" && meter.label !== "7d")
          || (meter.id === "five-hour" && meter.label !== "5h")) return false;
        if (!/^\d+ \/ \d+( estimated)?$/.test(meter.detail)
          || (provider.state === "estimated") !== meter.detail.endsWith(" estimated")) return false;
      } else if (meter.id !== "weekly" || meter.label !== "7d"
        || meter.detail !== providerDetail(provider)) {
        return false;
      }
    }
    if (provider.state !== "unavailable"
      && (!meters.has("weekly") || (provider.id !== "qwen" && meters.size !== 1))) return false;
    if (provider.id !== "qwen" && provider.state === "stale") {
      if (candidate.generatedAt - provider.observedAt >= providerStaleMaxMs(provider.id)
        || provider.meters.some((meter) => meter.resetAt !== null
          && meter.resetAt <= candidate.generatedAt)) return false;
    }
  }
  return providers.size === PROVIDERS.size;
}

export function defaultUsageCachePath(env = process.env) {
  const home = typeof env?.HOME === "string" ? env.HOME : "";
  return isAbsolute(home) ? join(home, ".local/state/qq/telemetry/usage-cache.json") : null;
}

function expireProviderStale(candidate, at) {
  const current = Number.isFinite(at) && at >= 0 ? Math.floor(at) : Date.now();
  return {
    ...candidate,
    providers: candidate.providers.map((provider) => {
      if (provider.id === "qwen" || provider.state !== "stale") return provider;
      const expiredByAge = current < provider.observedAt
        || current - provider.observedAt >= providerStaleMaxMs(provider.id);
      const expiredByReset = provider.meters.some((meter) => meter.resetAt !== null
        && current >= meter.resetAt);
      return expiredByAge || expiredByReset
        ? { ...provider, state: "unavailable", observedAt: null, meters: [] }
        : provider;
    }),
  };
}

/** Read and isolate one producer-owned, non-secret usage cache snapshot. */
export async function readUsageCache(filePath, now = Date.now) {
  if (typeof filePath !== "string" || !isAbsolute(filePath)) return null;
  let handle;
  try {
    const noFollow = constants.O_NOFOLLOW ?? 0;
    handle = await open(filePath, constants.O_RDONLY | noFollow);
    const stat = await handle.stat();
    const expectedUid = typeof process.getuid === "function" ? process.getuid() : stat.uid;
    if (!stat.isFile() || (stat.mode & 0o7777) !== 0o600 || stat.uid !== expectedUid
      || stat.size <= 0 || stat.size > MAX_USAGE_CACHE_BYTES) return null;
    const raw = await handle.readFile({ encoding: "utf8" });
    const candidate = JSON.parse(raw);
    if (!validEnvelope(candidate)) return null;
    const at = typeof now === "function" ? now() : now;
    return normalizeUsage(expireProviderStale(candidate, at), candidate.generatedAt);
  } catch {
    return null;
  } finally {
    try { await handle?.close(); } catch {}
  }
}
