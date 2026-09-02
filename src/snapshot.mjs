/** Presentation-neutral live operator snapshot projection. */

export const DASHBOARD_SCHEMA = "qq.dashboard/v1";

const SESSION_ID = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_TEXT = /(?:session-)?[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const PHASES = new Set(["planning", "plan", "work"]);
const PROVIDER_ISSUES = new Set([
  "login-required", "configuration", "provider-error", "response-error", "temporary",
]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function displayText(value) {
  const valueText = text(value);
  return valueText && !UUID_TEXT.test(valueText) ? valueText : "";
}

function epoch(value) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareAliases(left, right) {
  const leftAlias = displayText(left.alias);
  const rightAlias = displayText(right.alias);
  const leftNumber = /^\d+$/.test(leftAlias) ? Number(leftAlias) : null;
  const rightNumber = /^\d+$/.test(rightAlias) ? Number(rightAlias) : null;
  if (leftNumber !== null && rightNumber !== null && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }
  if (leftNumber !== null && rightNumber === null) return -1;
  if (leftNumber === null && rightNumber !== null) return 1;
  return compareText(leftAlias, rightAlias)
    || compareText(displayText(left.label), displayText(right.label))
    || compareText(left.id, right.id);
}

function projectKey(project, folder) {
  // Stable equality identity only. Consumers must use explicit presentation and
  // routing fields rather than interpreting this encoding.
  return `p:${encodeURIComponent(project)}:${encodeURIComponent(folder)}`;
}

function normalizeProjectRows(projectRows) {
  if (!Array.isArray(projectRows)) return [];
  const rows = [];
  const seenSessions = new Set();
  for (const candidate of projectRows) {
    if (!candidate || typeof candidate !== "object") continue;
    const id = text(candidate.id);
    const project = text(candidate.project);
    if (!SESSION_ID.test(id) || !project || seenSessions.has(id)) continue;
    seenSessions.add(id);
    const folder = text(candidate.folder);
    rows.push({
      id,
      key: projectKey(project, folder),
      name: project,
      label: displayText(candidate.projectLabel) || displayText(project) || "project",
      folder,
      folderLabel: folder
        ? displayText(candidate.folderLabel) || displayText(folder) || "folder"
        : "",
    });
  }
  return rows;
}

function normalizeAgents(agents) {
  if (!Array.isArray(agents)) return [];
  const rows = [];
  const seen = new Set();
  for (const candidate of agents) {
    if (!candidate || typeof candidate !== "object") continue;
    const id = text(candidate.id);
    if (!SESSION_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    const parent = text(candidate.parent);
    rows.push({
      id,
      alias: displayText(candidate.alias),
      label: displayText(candidate.label),
      status: candidate.status === "running" ? "running" : "idle",
      idleForMs: Number.isFinite(candidate.idle_for_ms) && candidate.idle_for_ms >= 0
        ? Math.floor(candidate.idle_for_ms)
        : null,
      parent: SESSION_ID.test(parent) && parent !== id ? parent : "",
    });
  }
  return rows;
}

function workflowMap(rows) {
  const result = new Map();
  if (!Array.isArray(rows)) return result;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const sessionId = text(row.sessionUuid);
    if (!SESSION_ID.test(sessionId) || result.has(sessionId)) continue;
    const workflow = displayText(row.workflow);
    if (!workflow) continue;
    const phase = PHASES.has(row.phase) ? row.phase : "unknown";
    result.set(sessionId, {
      workflow,
      phase,
      phaseStartedAt: phase === "unknown" ? null : epoch(row.phaseStartedAt),
    });
  }
  return result;
}

function safeMeter(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  const id = text(candidate.id);
  if (!id) return null;
  const ratio = Number.isFinite(candidate.usedRatio) && candidate.usedRatio >= 0
    ? candidate.usedRatio
    : null;
  return Object.freeze({
    id,
    label: displayText(candidate.label) || displayText(id) || "usage",
    usedRatio: ratio,
    resetAt: epoch(candidate.resetAt),
    detail: displayText(candidate.detail),
  });
}

/** Strictly copy the non-secret display cache shape. Unknown fields are lost. */
export function normalizeUsage(candidate, fallbackGeneratedAt = Date.now()) {
  const generatedAt = epoch(candidate?.generatedAt) ?? epoch(fallbackGeneratedAt) ?? 0;
  const providers = [];
  const seen = new Set();
  for (const provider of Array.isArray(candidate?.providers) ? candidate.providers : []) {
    if (!provider || typeof provider !== "object") continue;
    const id = text(provider.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    providers.push(Object.freeze({
      id,
      label: displayText(provider.label) || displayText(id) || "provider",
      state: displayText(provider.state) || "unknown",
      issue: PROVIDER_ISSUES.has(provider.issue) ? provider.issue : null,
      observedAt: epoch(provider.observedAt),
      meters: Object.freeze((Array.isArray(provider.meters) ? provider.meters : [])
        .map(safeMeter)
        .filter(Boolean)),
    }));
  }
  providers.sort((left, right) => compareText(left.label, right.label) || compareText(left.id, right.id));
  return Object.freeze({ generatedAt, providers: Object.freeze(providers) });
}

function sessionProjection(row, parentSessionId, depth, workflows) {
  const workflow = workflows.get(row.id);
  return Object.freeze({
    sessionId: row.id,
    alias: row.alias,
    label: row.label || row.alias || "session",
    parentSessionId,
    depth,
    activity: row.status === "running" ? "working" : "idle",
    idleForMs: row.status === "running" ? null : row.idleForMs,
    workflow: workflow?.workflow ?? null,
    phase: workflow?.phase ?? "none",
    phaseStartedAt: workflow?.phaseStartedAt ?? null,
  });
}

function compareGroups(left, right) {
  return compareText(left.label, right.label)
    || compareText(left.name, right.name)
    || compareText(left.folderLabel, right.folderLabel)
    || compareText(left.folder, right.folder)
    || compareText(left.key, right.key);
}

/**
 * Build qq.dashboard/v1 from already captured dependency rows. `projectRows`
 * must be the authoritative active project-chair projection from qq-core.list().
 * Agent cwd, worktree paths, labels and prose are never grouping authorities.
 */
export function projectSnapshot({
  generatedAt = Date.now(),
  projectRows = [],
  agents = [],
  workflowRows = [],
  usage,
} = {}) {
  const at = epoch(generatedAt) ?? 0;
  const rows = normalizeAgents(agents);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const children = new Map();
  for (const row of rows) {
    const parent = row.parent && byId.has(row.parent) ? row.parent : "";
    const siblings = children.get(parent) ?? [];
    siblings.push(row);
    children.set(parent, siblings);
  }
  for (const siblings of children.values()) siblings.sort(compareAliases);

  // qq-core.list() describes chairs. Only IDs that are roots of this captured
  // live forest may seed a group; a child can only inherit its root's group.
  const roots = children.get("") ?? [];
  const rootIds = new Set(roots.map((row) => row.id));
  const assignments = normalizeProjectRows(projectRows)
    .filter((row) => rootIds.has(row.id));
  const assignmentByRoot = new Map(assignments.map((row) => [row.id, row]));
  const groupsByKey = new Map();
  for (const assignment of assignments) {
    const existing = groupsByKey.get(assignment.key);
    if (!existing) {
      groupsByKey.set(assignment.key, {
        key: assignment.key,
        name: assignment.name,
        label: assignment.label,
        folder: assignment.folder,
        folderLabel: assignment.folderLabel,
      });
      continue;
    }
    // If malformed authority rows disagree on labels for one identity, choose a
    // deterministic safe presentation rather than depending on input order.
    if (compareText(assignment.label, existing.label) < 0) existing.label = assignment.label;
    if (compareText(assignment.folderLabel, existing.folderLabel) < 0) {
      existing.folderLabel = assignment.folderLabel;
    }
  }
  const groups = [...groupsByKey.values()].sort(compareGroups);
  const sessionsByKey = new Map(groups.map((group) => [group.key, []]));
  const semanticWorkflows = workflowMap(workflowRows);
  const visited = new Set();

  const excludeSubtree = (row) => {
    if (visited.has(row.id)) return;
    visited.add(row.id);
    for (const child of children.get(row.id) ?? []) excludeSubtree(child);
  };
  const walk = (row, group, depth, parentSessionId) => {
    if (visited.has(row.id)) return;
    // Reserved Projects topology is never an operator project, even if a
    // malformed authority row accidentally assigns it one.
    if (row.alias === "projects") {
      excludeSubtree(row);
      return;
    }
    visited.add(row.id);
    if (!group) {
      excludeSubtree(row);
      return;
    }
    sessionsByKey.get(group.key).push(sessionProjection(
      row,
      parentSessionId,
      depth,
      semanticWorkflows,
    ));
    for (const child of children.get(row.id) ?? []) {
      walk(child, group, depth + 1, row.id);
    }
  };

  for (const root of roots) walk(root, assignmentByRoot.get(root.id) ?? null, 0, "");
  // Cycles contain no top-level root and therefore no authoritative root join;
  // omit them deterministically along with all other projectless/system rows.
  for (const row of rows.slice().sort(compareAliases)) {
    if (!visited.has(row.id)) excludeSubtree(row);
  }

  const projects = groups.flatMap((group) => {
    const sessions = sessionsByKey.get(group.key);
    if (!sessions?.length) return [];
    return [Object.freeze({
      key: group.key,
      name: group.name,
      label: group.label,
      folder: group.folder,
      folderLabel: group.folderLabel,
      sessions: Object.freeze(sessions),
    })];
  });

  return Object.freeze({
    schema: DASHBOARD_SCHEMA,
    generatedAt: at,
    projects: Object.freeze(projects),
    usage: normalizeUsage(usage, at),
  });
}

export const internals = Object.freeze({ SESSION_ID, UUID_TEXT });
