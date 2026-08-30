import assert from "node:assert/strict";
import test from "node:test";

import { apply, inject, name, provide } from "../src/plugin.mjs";
import { createDashboardCache, defaults as cacheDefaults } from "../src/service.mjs";
import { DASHBOARD_SCHEMA, normalizeUsage, projectSnapshot } from "../src/snapshot.mjs";

const IDS = Object.freeze({
  alpha10: "session-10000000-0000-4000-8000-000000000010",
  alpha3: "session-10000000-0000-4000-8000-000000000003",
  child2: "session-20000000-0000-4000-8000-000000000002",
  grand: "session-30000000-0000-4000-8000-000000000003",
  beta: "session-40000000-0000-4000-8000-000000000004",
  projects: "session-50000000-0000-4000-8000-000000000005",
  projectsChild: "session-60000000-0000-4000-8000-000000000006",
  home: "session-70000000-0000-4000-8000-000000000007",
  cycleA: "session-80000000-0000-4000-8000-000000000008",
  cycleB: "session-90000000-0000-4000-8000-000000000009",
});

function activeProjectRows() {
  // Production-shaped rows from await qq-core.list(). Deliberately unordered.
  return [
    {
      id: IDS.beta,
      project: "beta",
      projectLabel: "Beta",
      folder: "web",
      folderLabel: "Web",
      cwd: "/projects/beta-web",
    },
    {
      id: IDS.alpha10,
      project: "alpha",
      projectLabel: "Alpha",
      cwd: "/projects/alpha",
    },
    {
      id: IDS.alpha3,
      project: "alpha",
      projectLabel: "Alpha",
      cwd: "/projects/alpha",
    },
    // These malformed authority rows are triggers: child IDs cannot seed a
    // group, and reserved Projects topology stays hidden even if assigned.
    {
      id: IDS.child2,
      project: "beta",
      projectLabel: "Wrong child assignment",
      folder: "api",
      folderLabel: "API",
    },
    {
      id: IDS.projects,
      project: "alpha",
      projectLabel: "Alpha",
    },
  ];
}

function agents() {
  // Deliberately unordered. Cwd values actively contradict the authoritative
  // list() join: no result may change when these descriptive values change.
  return [
    {
      id: IDS.child2,
      alias: "2",
      label: "implementation",
      status: "idle",
      idle_for_ms: 12_345,
      parent: IDS.alpha10,
      cwd: "/projects/.qq-worktrees/beta/not-alpha",
      project: "beta",
      folder: "api",
    },
    {
      id: IDS.projectsChild,
      alias: "1",
      label: "must stay system-hidden",
      status: "running",
      parent: IDS.projects,
      cwd: "/projects/alpha",
    },
    {
      id: IDS.beta,
      alias: "7",
      label: "beta architect",
      status: "idle",
      idle_for_ms: 99,
      parent: "",
      cwd: "/projects/alpha",
    },
    {
      id: IDS.alpha10,
      alias: "10",
      label: "architect",
      status: "running",
      idle_for_ms: 999,
      parent: "",
      cwd: "/projects/beta-web",
    },
    {
      id: IDS.grand,
      alias: "",
      label: IDS.grand,
      status: "idle",
      idle_for_ms: -5,
      parent: IDS.child2,
      cwd: "/tmp/unrelated-worktree",
    },
    {
      id: IDS.home,
      alias: "4",
      label: "Home",
      status: "running",
      parent: "",
      // Exact collision with a known project chair cwd must not classify it.
      cwd: "/projects/alpha",
    },
    {
      id: IDS.projects,
      alias: "projects",
      label: "Projects",
      status: "idle",
      parent: "",
      cwd: "/projects",
    },
    {
      id: IDS.alpha3,
      alias: "3",
      label: "second chair",
      status: "idle",
      idle_for_ms: 456,
      parent: "",
      cwd: "/home/operator",
    },
  ];
}

function projection(overrides = {}) {
  return projectSnapshot({
    projectRows: activeProjectRows(),
    agents: agents(),
    ...overrides,
  });
}

async function waitFor(predicate, message, timeoutMs = 1_000) {
  const end = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= end) assert.fail(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("groups by authoritative root ID with project order and parent-before-child alias order", () => {
  const result = projection({
    generatedAt: 1_788_000_000_000,
    workflowRows: [
      {
        sessionUuid: IDS.alpha10,
        workflow: "architect",
        phase: "planning",
        phaseStartedAt: 1_787_999_000_000,
      },
      {
        sessionUuid: IDS.beta,
        workflow: "architect",
        phase: "work",
        phaseStartedAt: 1_787_999_500_000,
      },
    ],
  });

  assert.equal(result.schema, DASHBOARD_SCHEMA);
  assert.equal(result.generatedAt, 1_788_000_000_000);
  assert.deepEqual(result.projects.map((project) => [
    project.name,
    project.label,
    project.folder,
    project.folderLabel,
  ]), [
    ["alpha", "Alpha", "", ""],
    ["beta", "Beta", "web", "Web"],
  ]);
  assert.ok(result.projects.every((project) => project.key && project.key !== project.label));

  const alpha = result.projects[0].sessions;
  assert.deepEqual(alpha.map((row) => row.sessionId), [
    IDS.alpha3,
    IDS.alpha10,
    IDS.child2,
    IDS.grand,
  ]);
  assert.deepEqual(alpha.map((row) => row.depth), [0, 0, 1, 2]);
  assert.deepEqual(alpha.map((row) => row.parentSessionId), ["", "", IDS.alpha10, IDS.child2]);
  assert.deepEqual(alpha.map((row) => row.activity), ["idle", "working", "idle", "idle"]);
  assert.deepEqual(alpha.map((row) => row.idleForMs), [456, null, 12_345, null]);
  assert.deepEqual(alpha[1], {
    sessionId: IDS.alpha10,
    alias: "10",
    label: "architect",
    parentSessionId: "",
    depth: 0,
    activity: "working",
    idleForMs: null,
    workflow: "architect",
    phase: "planning",
    phaseStartedAt: 1_787_999_000_000,
  });
  assert.equal(alpha[3].alias, "");
  assert.equal(alpha[3].label, "session", "a physical UUID must never become display fallback");

  const allIds = result.projects.flatMap((project) => project.sessions.map((row) => row.sessionId));
  assert.ok(!allIds.includes(IDS.home), "projectless/home roots are omitted despite cwd collision");
  assert.ok(!allIds.includes(IDS.projects), "reserved Projects chair is omitted");
  assert.ok(!allIds.includes(IDS.projectsChild), "reserved Projects descendants are omitted");
  assert.ok(!result.projects.some((project) => project.label === "Wrong child assignment"));

  const beta = result.projects[1].sessions[0];
  assert.equal(beta.sessionId, IDS.beta, "mismatched chair cwd cannot override core.list() identity");
  assert.equal(beta.workflow, "architect");
  assert.equal(beta.phase, "work");
  assert.equal(beta.phaseStartedAt, 1_787_999_500_000);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.projects));
  assert.ok(Object.isFrozen(alpha));
});

test("changing or colliding cwd metadata cannot affect grouping", () => {
  const baseline = projection();
  const changedAgents = agents().map((row, index) => ({
    ...row,
    cwd: index % 2 ? "/same/home/system/collision" : "/different/worktree",
    project: index % 2 ? "invented" : "beta",
    folder: "invented",
  }));
  const changedAuthorityCwds = activeProjectRows().map((row) => ({
    ...row,
    cwd: "/one/shared/path",
  }));
  const changed = projectSnapshot({ projectRows: changedAuthorityCwds, agents: changedAgents });
  assert.deepEqual(changed.projects, baseline.projects);
});

test("only exact top-level root IDs seed grouping; projectless roots and cycles are omitted", () => {
  const rows = [
    ...agents(),
    { id: IDS.cycleA, alias: "20", status: "running", parent: IDS.cycleB, cwd: "/projects/alpha" },
    { id: IDS.cycleB, alias: "21", status: "running", parent: IDS.cycleA, cwd: "/projects/alpha" },
  ];
  const projectRows = [
    ...activeProjectRows(),
    { id: IDS.cycleA, project: "alpha", projectLabel: "Alpha" },
    { id: "not-a-session", project: "z", projectLabel: "Z" },
    { id: IDS.home, project: "", projectLabel: "Alpha" },
  ];
  const result = projectSnapshot({ projectRows, agents: rows });
  const ids = result.projects.flatMap((project) => project.sessions.map((row) => row.sessionId));
  assert.ok(!ids.includes(IDS.cycleA));
  assert.ok(!ids.includes(IDS.cycleB));
  assert.ok(!ids.includes(IDS.home));
});

test("aliases and labels use safe human fallback without exposing UUID text", () => {
  const result = projectSnapshot({
    projectRows: [
      { id: IDS.alpha10, project: "alpha", projectLabel: IDS.beta },
      { id: IDS.beta, project: "beta", projectLabel: `project ${IDS.beta}` },
    ],
    agents: [
      { id: IDS.alpha10, alias: IDS.alpha3, label: `chair ${IDS.alpha3}`, status: "running" },
      { id: IDS.beta, alias: "", label: "Human chair", status: "idle", idle_for_ms: 0 },
    ],
  });
  assert.deepEqual(result.projects.map((project) => project.label), ["alpha", "beta"]);
  assert.equal(result.projects[0].sessions[0].alias, "");
  assert.equal(result.projects[0].sessions[0].label, "session");
  assert.equal(result.projects[1].sessions[0].label, "Human chair");
});

test("unknown idle durations stay null instead of creating fake zero timers", () => {
  const values = [undefined, -1, Number.NaN, Number.POSITIVE_INFINITY, 0, 1.9];
  const projected = values.map((idle_for_ms) => projectSnapshot({
    projectRows: [{ id: IDS.alpha10, project: "alpha", projectLabel: "Alpha" }],
    agents: [{
      id: IDS.alpha10,
      alias: "1",
      label: "chair",
      status: "idle",
      ...(idle_for_ms === undefined ? {} : { idle_for_ms }),
      parent: "",
    }],
  }).projects[0].sessions[0].idleForMs);

  assert.deepEqual(projected, [null, null, null, null, 0, 1]);
});

test("only workflow snapshots supply semantic phase and timestamps pass through", () => {
  const malformed = projectSnapshot({
    generatedAt: 100,
    projectRows: [{ id: IDS.alpha10, project: "alpha", projectLabel: "Alpha" }],
    agents: [{
      id: IDS.alpha10,
      alias: "",
      label: "planning phase since yesterday",
      status: "running",
      parent: "",
      phase: "work",
      phaseStartedAt: 1,
    }],
    workflowRows: [{
      sessionUuid: IDS.alpha10,
      workflow: "architect",
      phase: "IMPLEMENTATION",
      phaseStartedAt: "yesterday",
    }],
  }).projects[0].sessions[0];
  assert.equal(malformed.label, "planning phase since yesterday");
  assert.equal(malformed.workflow, "architect");
  assert.equal(malformed.phase, "unknown");
  assert.equal(malformed.phaseStartedAt, null);

  for (const phase of ["planning", "plan", "work"]) {
    const row = projectSnapshot({
      projectRows: [{ id: IDS.alpha10, project: "alpha" }],
      agents: [{ id: IDS.alpha10, alias: "1", status: "running" }],
      workflowRows: [{
        sessionUuid: IDS.alpha10,
        workflow: "architect",
        phase,
        phaseStartedAt: 8_765.9,
      }],
    }).projects[0].sessions[0];
    assert.equal(row.phase, phase);
    assert.equal(row.phaseStartedAt, 8_765);
  }

  const missingTimestamp = projectSnapshot({
    projectRows: [{ id: IDS.alpha10, project: "alpha" }],
    agents: [{ id: IDS.alpha10, alias: "1", status: "running" }],
    workflowRows: [{
      sessionUuid: IDS.alpha10,
      workflow: "architect",
      phase: "work",
      phaseStartedAt: null,
    }],
  }).projects[0].sessions[0];
  assert.equal(missingTimestamp.phaseStartedAt, null);

  const absent = projection();
  const ordinary = absent.projects[0].sessions.find((session) => session.sessionId === IDS.alpha10);
  assert.equal(ordinary.workflow, null);
  assert.equal(ordinary.phase, "none");
  assert.equal(ordinary.phaseStartedAt, null);
});

test("usage is strict cached display data and provider failure cannot suppress live state", () => {
  const usage = {
    generatedAt: 1234,
    providers: [
      {
        id: "grok",
        label: "Grok",
        state: "unavailable",
        observedAt: 1200,
        credential: "must-not-cross-boundary",
        meters: [],
      },
      {
        id: "codex",
        label: "Codex",
        state: "ready",
        observedAt: 1210,
        meters: [{
          id: "five-hour",
          label: "5 hour",
          usedRatio: 0.25,
          resetAt: 5000,
          detail: "25% used",
          token: "secret",
        }],
      },
      { id: "codex", label: "duplicate", meters: [] },
      { id: "qwen", label: "Qwen", state: "stale", observedAt: null, meters: [] },
      null,
    ],
  };
  const normalized = normalizeUsage(usage, 9999);
  assert.equal(normalized.generatedAt, 1234);
  assert.deepEqual(normalized.providers.map((provider) => provider.id), ["codex", "grok", "qwen"]);
  assert.deepEqual(normalized.providers[0], {
    id: "codex",
    label: "Codex",
    state: "ready",
    observedAt: 1210,
    meters: [{
      id: "five-hour",
      label: "5 hour",
      usedRatio: 0.25,
      resetAt: 5000,
      detail: "25% used",
    }],
  });
  assert.ok(!JSON.stringify(normalized).includes("secret"));
  assert.ok(!JSON.stringify(normalized).includes("credential"));

  const result = projection({ usage });
  assert.equal(result.projects[0].sessions.length, 4);
  assert.equal(result.usage.providers.find((provider) => provider.id === "grok").state, "unavailable");
});

test("async cache snapshot is pure, reads each core authority once, and cadence-caches workflows", async () => {
  let now = 100;
  let agentCalls = 0;
  let projectCalls = 0;
  let workflowCalls = 0;
  let workflowMode = "valid";
  const core = {
    listAgents() { agentCalls += 1; return agents(); },
    async list() { projectCalls += 1; return activeProjectRows(); },
  };
  const workflowService = {
    workflows: {
      snapshots() {
        workflowCalls += 1;
        if (workflowMode === "throw") throw new Error("temporary workflow failure");
        if (workflowMode === "malformed") return { rows: [] };
        return [{
          sessionUuid: IDS.alpha10,
          workflow: "architect",
          phase: "plan",
          phaseStartedAt: 50,
        }];
      },
    },
  };
  const usage = {
    generatedAt: 90,
    providers: [{ id: "codex", label: "Codex", state: "ready", meters: [] }],
  };
  const cache = createDashboardCache({
    core,
    workflows: () => workflowService,
    now: () => now,
    workflowRefreshMs: 1_000,
    usage,
  });

  assert.deepEqual(cache.service.snapshot().projects, [], "construction publishes an empty cache, never awaits in snapshot");
  await cache.ready;
  assert.equal(agentCalls, 1);
  assert.equal(projectCalls, 1);
  assert.equal(workflowCalls, 1);
  const first = cache.service.snapshot();
  assert.equal(first.projects[0].sessions[1].phase, "plan");
  assert.equal(first.projects[0].sessions[1].phaseStartedAt, 50);

  const same = cache.service.snapshot();
  cache.service.snapshot();
  assert.strictEqual(same, first);
  assert.equal(agentCalls, 1, "snapshot does not read listAgents");
  assert.equal(projectCalls, 1, "snapshot does not read async list");
  assert.equal(workflowCalls, 1, "snapshot does not read workflow ledgers");

  now += 100;
  await cache.tick();
  assert.equal(agentCalls, 2);
  assert.equal(projectCalls, 2);
  assert.equal(workflowCalls, 1);
  now += 899;
  await cache.tick();
  assert.equal(workflowCalls, 1);
  now += 1;
  await cache.tick();
  assert.equal(workflowCalls, 2, "workflow aggregate refreshes only at owner cadence");

  workflowMode = "throw";
  now += 100;
  await cache.refresh();
  assert.equal(workflowCalls, 3, "lifecycle refresh reads workflow aggregate");
  const withoutWorkflow = cache.service.snapshot();
  assert.equal(withoutWorkflow.projects[0].sessions[1].phase, "none");
  assert.equal(withoutWorkflow.projects[0].sessions.length, 4);

  workflowMode = "malformed";
  core.listAgents = () => { agentCalls += 1; throw new Error("agent failure"); };
  core.list = async () => { projectCalls += 1; throw new Error("list failure"); };
  await cache.refresh();
  assert.equal(cache.service.snapshot().projects[0].sessions.length, 4, "last complete core pair survives failure");
  assert.equal(cache.service.snapshot().usage.providers[0].id, "codex");
});

test("core pair publication is atomic for malformed reads", async () => {
  let mode = "valid";
  const core = {
    listAgents() {
      if (mode === "bad-agents") return { rows: agents() };
      return mode === "new-agents" ? [] : agents();
    },
    async list() {
      if (mode === "bad-projects") return { rows: activeProjectRows() };
      return activeProjectRows();
    },
  };
  const cache = createDashboardCache({ core });
  await cache.ready;
  const first = cache.service.snapshot();

  mode = "bad-agents";
  await cache.tick();
  assert.deepEqual(cache.service.snapshot().projects, first.projects);
  mode = "bad-projects";
  await cache.tick();
  assert.deepEqual(cache.service.snapshot().projects, first.projects);
  mode = "new-agents";
  await cache.tick();
  assert.deepEqual(cache.service.snapshot().projects, []);
});

test("slow refreshes serialize and coalesce timer/event pressure", async () => {
  let agentCalls = 0;
  let listCalls = 0;
  let activeLists = 0;
  let maximumActive = 0;
  const resolvers = [];
  const core = {
    listAgents() { agentCalls += 1; return agents(); },
    list() {
      listCalls += 1;
      activeLists += 1;
      maximumActive = Math.max(maximumActive, activeLists);
      return new Promise((resolve) => resolvers.push(() => {
        activeLists -= 1;
        resolve(activeProjectRows());
      }));
    },
  };
  const cache = createDashboardCache({ core });
  assert.equal(listCalls, 1);
  const tickA = cache.tick();
  const tickB = cache.tick();
  const refresh = cache.refresh();
  assert.strictEqual(tickA, tickB);
  assert.strictEqual(tickA, refresh);
  assert.equal(listCalls, 1, "no overlapping list calls start while the first is pending");

  resolvers.shift()();
  await waitFor(() => listCalls === 2, "coalesced follow-up refresh did not start");
  assert.equal(agentCalls, 2);
  assert.equal(resolvers.length, 1);
  resolvers.shift()();
  await cache.ready;
  assert.equal(listCalls, 2, "three queued requests become one follow-up read");
  assert.equal(maximumActive, 1);
  assert.equal(cache.service.snapshot().projects.length, 2);
});

test("Cordis plugin provides an optional cached surface and disposes listeners/timer", async () => {
  assert.equal(name, "qq-dashboard");
  assert.equal(provide, "qq-dashboard");
  assert.deepEqual(inject, ["qq-core"]);
  assert.equal(cacheDefaults.workflowRefreshMs, 30_000);
  assert.equal(cacheDefaults.usageRefreshMs, 30_000);

  let status = "idle";
  let agentCalls = 0;
  let listCalls = 0;
  let workflowCalls = 0;
  const listeners = new Map();
  const removed = [];
  const effects = [];
  const provided = new Map();
  const core = {
    async list() {
      listCalls += 1;
      return [{ id: IDS.alpha10, project: "alpha", projectLabel: "Alpha" }];
    },
    listAgents() {
      agentCalls += 1;
      return [{
        id: IDS.alpha10,
        alias: "8",
        label: "chair",
        status,
        idle_for_ms: 5,
        parent: "",
      }];
    },
  };
  const workflows = {
    workflows: {
      snapshots() { workflowCalls += 1; return []; },
    },
  };
  const ctx = {
    get(service) {
      if (service === "qq-core") return core;
      if (service === "qq-workflows") return workflows;
      return null;
    },
    provide(service, value) { provided.set(service, value); },
    on(event, listener) {
      listeners.set(event, listener);
      return () => removed.push(event);
    },
    effect(factory) { effects.push(factory()); },
  };

  const disposeReturned = apply(ctx, { refreshMs: 50, usage: { generatedAt: 0, providers: [] } });
  const service = provided.get("qq-dashboard");
  assert.ok(service);
  await waitFor(() => service.snapshot().projects.length === 1, "initial background refresh did not publish");
  assert.equal(service.snapshot().projects[0].sessions[0].activity, "idle");
  const afterApplyAgents = agentCalls;
  const afterApplyLists = listCalls;
  service.snapshot();
  service.snapshot();
  assert.equal(agentCalls, afterApplyAgents);
  assert.equal(listCalls, afterApplyLists);
  assert.equal(workflowCalls, 1);

  await waitFor(() => agentCalls > afterApplyAgents, "owner timer did not refresh live rows");
  assert.ok(listCalls > afterApplyLists);
  assert.equal(workflowCalls, 1, "timer ticks do not poll workflow ledgers before cadence");

  status = "running";
  listeners.get("agent/status")?.({});
  await waitFor(
    () => service.snapshot().projects[0].sessions[0].activity === "working",
    "lifecycle refresh did not publish",
  );
  assert.equal(service.snapshot().projects[0].sessions[0].idleForMs, null);
  assert.equal(workflowCalls, 2);

  disposeReturned();
  effects[0]?.();
  assert.deepEqual(new Set(removed), new Set(["agent/created", "agent/status", "agent/disposed"]));
});

test("required core and malformed optional inputs fail or degrade safely", async () => {
  assert.throws(
    () => createDashboardCache({ core: { listAgents() { return []; } } }),
    /listAgents\/list service is required/,
  );
  assert.throws(
    () => createDashboardCache({ core: { list() { return []; } } }),
    /listAgents\/list service is required/,
  );

  const malformed = projectSnapshot({
    projectRows: [null, {}, { id: IDS.alpha3, project: "x", projectLabel: IDS.alpha3 }],
    agents: [null, {}, {
      id: IDS.alpha3,
      alias: IDS.alpha10,
      label: `chair ${IDS.alpha10}`,
      status: "not-running",
    }],
    workflowRows: null,
    usage: null,
  });
  assert.equal(malformed.projects[0].label, "x");
  assert.equal(malformed.projects[0].sessions[0].alias, "");
  assert.equal(malformed.projects[0].sessions[0].label, "session");
  assert.deepEqual(malformed.usage.providers, []);

  const cache = createDashboardCache({
    core: { listAgents() { return null; }, async list() { return undefined; } },
    workflows: () => ({ workflows: { snapshots: "not-a-function" } }),
  });
  await cache.ready;
  assert.deepEqual(cache.service.snapshot().projects, []);
  assert.deepEqual(cache.service.snapshot().usage.providers, []);
});


test("usage source reads on its own cadence and retains the last valid cache", async () => {
  let now = 1_000;
  let usageCalls = 0;
  let mode = "first";
  const usageFor = async () => {
    usageCalls += 1;
    if (mode === "throw") throw new Error("temporary cache read failure");
    if (mode === "missing") return null;
    return {
      generatedAt: mode === "first" ? 900 : 30_900,
      providers: [{
        id: "codex", label: "Codex", state: "ready", observedAt: 800,
        meters: [{ id: "weekly", label: "7d", usedRatio: mode === "first" ? 0.2 : 0.4,
          resetAt: 50_000, detail: "" }],
      }],
    };
  };
  const cache = createDashboardCache({
    core: { listAgents() { return []; }, async list() { return []; } },
    usageFor,
    usageRefreshMs: 30_000,
    now: () => now,
  });
  await cache.ready;
  assert.equal(usageCalls, 1);
  assert.equal(cache.service.snapshot().usage.providers[0].meters[0].usedRatio, 0.2);
  const published = cache.service.snapshot();
  cache.service.snapshot();
  assert.strictEqual(cache.service.snapshot(), published);
  assert.equal(usageCalls, 1, "snapshot never reads the file source");

  now += 29_999;
  await cache.tick();
  assert.equal(usageCalls, 1);
  mode = "second";
  now += 1;
  await cache.tick();
  assert.equal(usageCalls, 2);
  assert.equal(cache.service.snapshot().usage.providers[0].meters[0].usedRatio, 0.4);

  mode = "throw";
  now += 30_000;
  await cache.refresh();
  assert.equal(usageCalls, 3, "lifecycle refresh reads usage only when its cadence is due");
  assert.equal(cache.service.snapshot().usage.providers[0].meters[0].usedRatio, 0.4,
    "read failure retains the last valid usage snapshot");
  mode = "missing";
  now += 30_000;
  await cache.tick();
  assert.equal(cache.service.snapshot().usage.providers[0].meters[0].usedRatio, 0.4,
    "missing cache retains the last valid usage snapshot");
});
