import { createDashboardCache } from "./service.mjs";

export const name = "qq-dashboard";
export const inject = ["qq-core"];
export const provide = "qq-dashboard";

function refreshCadence(value) {
  return Number.isFinite(value) && value >= 50 ? Math.floor(value) : 100;
}

/** Provide the cached live operator snapshot to in-process presentation plugins. */
export function apply(ctx, config = {}) {
  const core = ctx.get?.("qq-core");
  const cache = createDashboardCache({
    core,
    workflows: () => ctx.get?.("qq-workflows", false) ?? null,
    now: typeof config.now === "function" ? config.now : Date.now,
    catalogRefreshMs: config.catalogRefreshMs,
    workflowRefreshMs: config.workflowRefreshMs,
    // Optional static non-secret display rows only. No provider refresh or
    // credentials cross this plugin boundary.
    usage: config.usage,
  });
  ctx.provide("qq-dashboard", cache.service);

  const disposers = [];
  if (typeof ctx.on === "function") {
    for (const event of ["agent/created", "agent/status", "agent/disposed"]) {
      const off = ctx.on(event, () => { cache.refresh(); });
      if (typeof off === "function") disposers.push(off);
    }
  }
  // Timer ticks update in-memory live rows and the cadence-limited project
  // catalog, but reuse cached workflow rows. The workflow aggregate can read
  // ledgers synchronously and is refreshed only on its safe cadence or on
  // lifecycle events, never at the UI polling cadence.
  const timer = setInterval(() => { cache.tick(); }, refreshCadence(config.refreshMs));
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
