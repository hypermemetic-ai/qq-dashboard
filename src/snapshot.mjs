/** Presentation-neutral live operator snapshot projection. */

export const DASHBOARD_SCHEMA = "qq.dashboard/v1";

const SESSION_ID = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_TEXT = /(?:session-)?[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const PHASES = new Set(["planning", "plan", "work"]);

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

function normalizePath(value) {
  const raw = text(value);
  if (!raw.startsWith("/")) return "";
  const parts = [];
  for (const part of raw.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function projectKey(project, folder) {
  // This encoding is stable but deliberately undocumented to consumers. Keys
  // are equality identities; routes and labels use the explicit fields below.
  return `p:${encodeURIComponent(project)}:${encodeURIComponent(folder)}`;
}

function projectGroups(projects) {
  if (!Array.isArray(projects)) return [];
  const groups = [];
  const keys = new Set();
  for (const candidate of projects) {
    if (!candidate || typeof candidate !== "object") continue;
    const name = text(candidate.name);
    if (!name) continue;
    const label = displayText(candidate.label) || displayText(name) || "project";
    const folders = Array.isArray(candidate.folders) ? candidate.folders : [];
    const grouped = candidate.grouped === true;
    if (grouped) {
      for (const candidateFolder of folders) {
        if (!candidateFolder || typeof candidateFolder !== "object") continue;
        const folder = text(candidateFolder.name);
        const cwd = normalizePath(candidateFolder.cwd);
        if (!folder || !cwd) continue;
        const key = projectKey(name, folder);
        if (keys.has(key)) continue;
        keys.add(key);
        groups.push({
          key,
          name,
          label,
          folder,
          folderLabel: displayText(candidateFolder.label) || displayText(folder) || "folder",
          cwd,
        });
      }
      continue;
    }
    const cwd = normalizePath(candidate.cwd)
      || normalizePath(folders.find((folder) => folder && typeof folder === "object")?.cwd);
    if (!cwd) continue;
    const key = projectKey(name, "");
    if (keys.has(key)) continue;
    keys.add(key);
    groups.push({ key, name, label, folder: "", folderLabel: "", cwd });
  }
  return groups.sort((left, right) => (
    compareText(left.label, right.label)
    || compareText(left.name, right.name)
    || compareText(left.folderLabel, right.folderLabel)
    || compareText(left.folder, right.folder)
    || compareText(left.key, right.key)
  ));
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
        : 0,
      parent: SESSION_ID.test(parent) && parent !== id ? parent : "",
      cwd: normalizePath(candidate.cwd),
      project: text(candidate.project),
      folder: text(candidate.folder),
      scope: text(candidate.scope),
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
      observedAt: epoch(provider.observedAt),
      meters: Object.freeze((Array.isArray(provider.meters) ? provider.meters : [])
        .map(safeMeter)
        .filter(Boolean)),
    }));
  }
  providers.sort((left, right) => compareText(left.label, right.label) || compareText(left.id, right.id));
  return Object.freeze({ generatedAt, providers: Object.freeze(providers) });
}

function classify(row, groups, groupsByName) {
  if (row.project) {
    const candidates = groupsByName.get(row.project) ?? [];
    const explicit = candidates.find((group) => group.folder === row.folder);
    if (explicit) return explicit;
    if (!row.folder && candidates.length === 1) return candidates[0];
  }
  return groups.find((group) => group.cwd === row.cwd) ?? null;
}

function sessionProjection(row, parentSessionId, depth, workflows) {
  const workflow = workflows.get(row.id);
  const alias = row.alias;
  const label = row.label || alias || "session";
  return Object.freeze({
    sessionId: row.id,
    alias,
    label,
    parentSessionId,
    depth,
    activity: row.status === "running" ? "working" : "idle",
    idleForMs: row.status === "running" ? null : row.idleForMs,
    workflow: workflow?.workflow ?? null,
    phase: workflow?.phase ?? "none",
    phaseStartedAt: workflow?.phaseStartedAt ?? null,
  });
}

/**
 * Build qq.dashboard/v1 from already captured dependency rows. This function
 * performs no I/O and does not infer workflow semantics from labels or prose.
 */
export function projectSnapshot({
  generatedAt = Date.now(),
  projects = [],
  agents = [],
  workflowRows = [],
  usage,
} = {}) {
  const at = epoch(generatedAt) ?? 0;
  const groups = projectGroups(projects);
  const groupsByName = new Map();
  for (const group of groups) {
    const matches = groupsByName.get(group.name) ?? [];
    matches.push(group);
    groupsByName.set(group.name, matches);
  }
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

  const semanticWorkflows = workflowMap(workflowRows);
  const sessionsByKey = new Map(groups.map((group) => [group.key, []]));
  const visited = new Set();

  const excludeSubtree = (row) => {
    if (visited.has(row.id)) return;
    visited.add(row.id);
    for (const child of children.get(row.id) ?? []) excludeSubtree(child);
  };
  const walk = (row, group, depth, parentSessionId) => {
    if (visited.has(row.id)) return;
    // The reserved Projects chair and everything below it are system topology,
    // not an operator project group.
    if (row.alias === "projects" || row.scope === "projects") {
      excludeSubtree(row);
      return;
    }
    visited.add(row.id);
    if (group) {
      sessionsByKey.get(group.key).push(sessionProjection(
        row,
        parentSessionId,
        depth,
        semanticWorkflows,
      ));
    }
    for (const child of children.get(row.id) ?? []) {
      walk(child, group, depth + 1, group ? row.id : "");
    }
  };

  const roots = children.get("") ?? [];
  for (const root of roots) walk(root, classify(root, groups, groupsByName), 0, "");
  // Malformed cycles are degraded deterministically instead of disappearing or
  // recursing forever. The selected row becomes a topology root.
  for (const row of rows.slice().sort(compareAliases)) {
    if (!visited.has(row.id)) walk(row, classify(row, groups, groupsByName), 0, "");
  }

  const activeProjects = groups.flatMap((group) => {
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
    projects: Object.freeze(activeProjects),
    usage: normalizeUsage(usage, at),
  });
}

export const internals = Object.freeze({ SESSION_ID, UUID_TEXT });
