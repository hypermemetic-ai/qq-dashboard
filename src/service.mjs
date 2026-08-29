import { normalizeUsage, projectSnapshot } from "./snapshot.mjs";

const DEFAULT_WORKFLOW_REFRESH_MS = 30_000;

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

function timestamp(now) {
  const observed = now();
  return Number.isFinite(observed) && observed >= 0 ? Math.floor(observed) : 0;
}

/**
 * Own asynchronous dependency reads outside public snapshot(). Refresh requests
 * are serialized and coalesced, so slow core.list() calls cannot overlap or
 * build an unbounded timer backlog. Each actual refresh reads the full agent
 * forest once and active project chairs once.
 */
export function createDashboardCache({
  core,
  workflows,
  now = Date.now,
  workflowRefreshMs = DEFAULT_WORKFLOW_REFRESH_MS,
  usage,
} = {}) {
  if (!core || typeof core.listAgents !== "function" || typeof core.list !== "function") {
    throw new TypeError("qq-dashboard: qq-core listAgents/list service is required");
  }
  const initialAt = timestamp(now);
  const usageCache = normalizeUsage(usage, initialAt);
  let agents = [];
  let projectRows = [];
  let workflowsCache = [];
  let workflowObserved = false;
  let lastWorkflowAt = -Infinity;
  let current = projectSnapshot({ generatedAt: initialAt, usage: usageCache });
  let queued = false;
  let queuedWorkflow = false;
  let active = null;

  async function update({ refreshWorkflows }) {
    const at = timestamp(now);

    // Capture both core authorities as one pair. A transient or malformed read
    // preserves the last complete pair instead of joining data from two times.
    let nextAgents;
    let nextProjectRows;
    try {
      nextAgents = core.listAgents();
    } catch {
      nextAgents = null;
    }
    try {
      nextProjectRows = await core.list();
    } catch {
      nextProjectRows = null;
    }
    if (Array.isArray(nextAgents) && Array.isArray(nextProjectRows)) {
      agents = nextAgents;
      projectRows = nextProjectRows;
    }

    const cadence = Number.isFinite(workflowRefreshMs) && workflowRefreshMs >= 0
      ? workflowRefreshMs
      : DEFAULT_WORKFLOW_REFRESH_MS;
    if (refreshWorkflows || !workflowObserved || at - lastWorkflowAt >= cadence) {
      workflowObserved = true;
      lastWorkflowAt = at;
      workflowsCache = workflowRows(optional(workflows));
    }
    current = projectSnapshot({
      generatedAt: at,
      projectRows,
      agents,
      workflowRows: workflowsCache,
      usage: usageCache,
    });
    return current;
  }

  function schedule(refreshWorkflows) {
    queued = true;
    queuedWorkflow ||= refreshWorkflows;
    if (!active) {
      active = (async () => {
        while (queued) {
          const full = queuedWorkflow;
          queued = false;
          queuedWorkflow = false;
          await update({ refreshWorkflows: full });
        }
        return current;
      })().finally(() => { active = null; });
    }
    return active;
  }

  function refresh() {
    return schedule(true);
  }

  function tick() {
    return schedule(false);
  }

  const service = Object.freeze({
    /** Synchronous, side-effect-free and I/O-free cached projection. */
    snapshot() { return current; },
  });

  const ready = refresh();
  return Object.freeze({ service, refresh, tick, ready });
}

export const defaults = Object.freeze({
  workflowRefreshMs: DEFAULT_WORKFLOW_REFRESH_MS,
});
