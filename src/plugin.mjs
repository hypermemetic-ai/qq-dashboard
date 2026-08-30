import { createDashboardCache } from "./service.mjs";
import { defaultUsageCachePath, readUsageCache } from "./usage-cache.mjs";

export const name = "qq-dashboard";
export const inject = ["qq-core"];
export const provide = "qq-dashboard";

function refreshCadence(value) {
  return Number.isFinite(value) && value >= 50 ? Math.floor(value) : 100;
}

/** Provide the cached live operator snapshot to in-process presentation plugins. */
export function apply(ctx, config = {}) {
  const core = ctx.get?.("qq-core");
  const hasStaticUsage = Object.prototype.hasOwnProperty.call(config, "usage");
  const usageFile = typeof config.usageFile === "string"
    ? config.usageFile
    : defaultUsageCachePath();
  const usageFor = typeof config.usageFor === "function"
    ? config.usageFor
    : hasStaticUsage || !usageFile ? null : () => readUsageCache(usageFile);
  const cache = createDashboardCache({
    core,
    workflows: () => ctx.get?.("qq-workflows", false) ?? null,
    now: typeof config.now === "function" ? config.now : Date.now,
    workflowRefreshMs: config.workflowRefreshMs,
    usageRefreshMs: config.usageRefreshMs,
    usageFor,
    // Optional static non-secret display rows suppress the default file reader.
    usage: config.usage,
  });
  ctx.provide("qq-dashboard", cache.service);

  const disposers = [];
  if (typeof ctx.on === "function") {
    for (const event of ["agent/created", "agent/status", "agent/disposed"]) {
      const off = ctx.on(event, () => { void cache.refresh(); });
      if (typeof off === "function") disposers.push(off);
    }
  }
  // Timer ticks update the cached live forest and authoritative active project
  // chair rows, but reuse cached workflow rows. The workflow aggregate can read
  // ledgers synchronously and is refreshed only on its safe cadence or on
  // lifecycle events, never at the UI polling cadence.
  const timer = setInterval(() => { void cache.tick(); }, refreshCadence(config.refreshMs));
  timer.unref?.();

  const dispose = () => {
    clearInterval(timer);
    while (disposers.length) {
      try { disposers.pop()?.(); } catch {}
    }
  };
  if (typeof ctx.effect === "function") ctx.effect(() => dispose, "qq-dashboard: live snapshot cache");
  return dispose;
}
