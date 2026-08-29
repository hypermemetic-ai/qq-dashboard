import { normalizeUsage, projectSnapshot } from "./snapshot.mjs";

const DEFAULT_CATALOG_REFRESH_MS = 30_000;

function optional(getter) {
  if (typeof getter !== "function") return null;
  try { return getter() ?? null; } catch { return null; }
}

function workflowRows(service) {
  const snapshots = service?.workflows?.snapshots;
  if (typeof snapshots !== "function") return [];
  try {
    const rows = snapshots.call(service.workflows);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/**
 * Own the dependency reads outside the public snapshot() call. Call refresh()
 * from host events/a timer; snapshot() is then just one cached object read.
 */
export function createDashboardCache({
  core,
  workflows,
  now = Date.now,
  catalogRefreshMs = DEFAULT_CATALOG_REFRESH_MS,
  usage,
} = {}) {
  if (!core || typeof core.listAgents !== "function" || typeof core.listProjects !== "function") {
    throw new TypeError("qq-dashboard: qq-core listAgents/listProjects service is required");
  }
  const initialNow = now();
  const initialAt = Number.isFinite(initialNow) && initialNow >= 0 ? Math.floor(initialNow) : 0;
  const usageCache = normalizeUsage(usage, initialAt);
  let catalog = [];
  let agents = [];
  let catalogObserved = false;
  let lastCatalogAt = -Infinity;
  let current = projectSnapshot({ generatedAt: initialAt, usage: usageCache });

  function refresh() {
    const observedNow = now();
    const at = Number.isFinite(observedNow) && observedNow >= 0 ? Math.floor(observedNow) : 0;
    const cadence = Number.isFinite(catalogRefreshMs) && catalogRefreshMs >= 0
      ? catalogRefreshMs
      : DEFAULT_CATALOG_REFRESH_MS;
    if (!catalogObserved || at - lastCatalogAt >= cadence) {
      catalogObserved = true;
      lastCatalogAt = at;
      try {
        const listed = core.listProjects();
        if (Array.isArray(listed)) catalog = listed;
      } catch {
        // Keep the last complete catalog. Agent state can still refresh.
      }
    }
    try {
      const listed = core.listAgents();
      if (Array.isArray(listed)) agents = listed;
    } catch {
      // Keep the last complete live catalog across a transient core failure.
    }
    current = projectSnapshot({
      generatedAt: at,
      projects: catalog,
      agents,
      workflowRows: workflowRows(optional(workflows)),
      usage: usageCache,
    });
    return current;
  }

  const service = Object.freeze({
    /** Synchronous, side-effect-free and I/O-free cached projection. */
    snapshot() { return current; },
  });

  refresh();
  return Object.freeze({ service, refresh });
}

export const defaults = Object.freeze({ catalogRefreshMs: DEFAULT_CATALOG_REFRESH_MS });
