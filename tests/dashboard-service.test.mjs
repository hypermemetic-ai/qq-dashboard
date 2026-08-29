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
});

function catalog() {
  return [
    {
      name: "beta",
      label: "Beta",
      cwd: "/projects/beta-api",
      grouped: true,
      folders: [
        { name: "api", label: "API", cwd: "/projects/beta-api" },
        { name: "web", label: "Web", cwd: "/projects/beta-web" },
      ],
    },
    {
      name: "alpha",
      label: "Alpha",
      cwd: "/projects/alpha",
      grouped: false,
      folders: [{ name: "alpha", label: "Alpha", cwd: "/projects/alpha" }],
    },
  ];
}

function agents() {
  // Deliberately unordered. The projection must establish forest/alias order.
  return [
    {
      id: IDS.child2,
      alias: "2",
      label: "implementation",
      status: "idle",
      idle_for_ms: 12_345,
      parent: IDS.alpha10,
      cwd: "/projects/.qq-worktrees/alpha/implementation",
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
      cwd: "/projects/beta-web/./",
    },
    {
      id: IDS.alpha10,
      alias: "10",
      label: "architect",
      status: "running",
      idle_for_ms: 999,
      parent: "",
      cwd: "/projects/alpha",
    },
    {
      id: IDS.grand,
      alias: "",
      label: IDS.grand,
      status: "idle",
      idle_for_ms: -5,
      parent: IDS.child2,
      cwd: "/tmp/child-worktree",
    },
    {
      id: IDS.home,
      alias: "4",
      label: "Home",
      status: "running",
      parent: "",
      cwd: "/home/operator",
    },
    {
      id: IDS.projects,
      alias: "projects",
      label: "Projects",
      status: "idle",
      parent: "",
      cwd: "/projects",
      scope: "projects",
    },
    {
      id: IDS.alpha3,
      alias: "3",
      label: "second chair",
      status: "idle",
      idle_for_ms: 456,
      parent: "",
      cwd: "/projects/alpha/../alpha",
    },
  ];
}

test("groups live topology by root project with safe aliases, status and deterministic order", () => {
  const result = projectSnapshot({
    generatedAt: 1_788_000_000_000,
    projects: catalog(),
    agents: agents(),
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
  assert.ok(!JSON.stringify(result.projects).includes("must stay system-hidden"));
  assert.ok(!result.projects.some((project) => project.sessions.some((row) => row.sessionId === IDS.home)));

  const beta = result.projects[1].sessions[0];
  assert.equal(beta.workflow, "architect");
  assert.equal(beta.phase, "work");
  assert.equal(beta.phaseStartedAt, 1_787_999_500_000);
});

test("unknown idle durations stay null instead of creating a fake zero timer", () => {
  const values = [undefined, -1, Number.NaN, Number.POSITIVE_INFINITY, 0, 1.9];
  const projected = values.map((idle_for_ms) => projectSnapshot({
    projects: catalog(),
    agents: [{
      id: IDS.alpha10,
      alias: "1",
      label: "chair",
      status: "idle",
      ...(idle_for_ms === undefined ? {} : { idle_for_ms }),
      parent: "",
      cwd: "/projects/alpha",
    }],
  }).projects[0].sessions[0].idleForMs);

  assert.deepEqual(projected, [null, null, null, null, 0, 1]);
});

test("only the workflow aggregate supplies semantic phase and malformed rows stay unknown", () => {
  const result = projectSnapshot({
    generatedAt: 100,
    projects: catalog(),
    agents: [{
      id: IDS.alpha10,
      alias: "",
      label: "planning phase since yesterday",
      status: "running",
      parent: "",
      cwd: "/projects/alpha",
    }],
    workflowRows: [{
      sessionUuid: IDS.alpha10,
      workflow: "architect",
      phase: "IMPLEMENTATION",
      phaseStartedAt: "yesterday",
    }],
  });
  const row = result.projects[0].sessions[0];
  assert.equal(row.label, "planning phase since yesterday");
  assert.equal(row.workflow, "architect");
  assert.equal(row.phase, "unknown");
  assert.equal(row.phaseStartedAt, null);

  const noTimer = projectSnapshot({
    projects: catalog(),
    agents: [{
      id: IDS.alpha10,
      alias: "1",
      label: "chair",
      status: "running",
      parent: "",
      cwd: "/projects/alpha",
    }],
    workflowRows: [{
      sessionUuid: IDS.alpha10,
      workflow: "architect",
      phase: "work",
      phaseStartedAt: null,
    }],
  }).projects[0].sessions[0];
  assert.equal(noTimer.phase, "work", "valid aggregate semantics pass through");
  assert.equal(noTimer.phaseStartedAt, null, "a missing authority timestamp never creates a fake timer");

  const absent = projectSnapshot({ projects: catalog(), agents: agents() });
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
          id: "weekly",
          label: "7 day",
          usedRatio: 0.42,
          resetAt: 9_999,
          detail: "42% used",
          cookie: "secret",
        }],
      },
    ],
  };
  const result = projectSnapshot({ projects: catalog(), agents: agents(), usage });
  assert.equal(result.projects[0].sessions.length, 4);
  assert.deepEqual(result.usage, {
    generatedAt: 1234,
    providers: [
      {
        id: "codex",
        label: "Codex",
        state: "ready",
        observedAt: 1210,
        meters: [{
          id: "weekly",
          label: "7 day",
          usedRatio: 0.42,
          resetAt: 9_999,
          detail: "42% used",
        }],
      },
      {
        id: "grok",
        label: "Grok",
        state: "unavailable",
        observedAt: 1200,
        meters: [],
      },
    ],
  });
  assert.ok(!JSON.stringify(result.usage).includes("credential"));
  assert.ok(!JSON.stringify(result.usage).includes("cookie"));
  assert.deepEqual(normalizeUsage({ providers: "bad" }, 55), { generatedAt: 55, providers: [] });
});

test("cache snapshot performs no dependency reads and tolerates optional workflow failures", () => {
  let now = 1_000;
  let projectCalls = 0;
  let agentCalls = 0;
  let workflowCalls = 0;
  let workflowMode = "valid";
  const core = {
    listProjects() { projectCalls += 1; return catalog(); },
    listAgents() { agentCalls += 1; return agents(); },
  };
  const workflows = {
    workflows: {
      snapshots() {
        workflowCalls += 1;
        if (workflowMode === "throw") throw new Error("optional plugin replacement");
        if (workflowMode === "malformed") return Promise.resolve([]);
        return [{
          sessionUuid: IDS.beta,
          workflow: "architect",
          phase: "plan",
          phaseStartedAt: 900,
        }];
      },
    },
    // The old/wrong location must never be consumed.
    snapshots() { throw new Error("wrong contract"); },
  };
  const cache = createDashboardCache({
    core,
    workflows: () => workflows,
    now: () => now,
    catalogRefreshMs: 10_000,
    workflowRefreshMs: 1_000,
  });
  assert.equal(projectCalls, 1);
  assert.equal(agentCalls, 1);
  assert.equal(workflowCalls, 1);

  const first = cache.service.snapshot();
  assert.strictEqual(cache.service.snapshot(), first, "snapshot should return the cached object");
  assert.equal(projectCalls, 1);
  assert.equal(agentCalls, 1);
  assert.equal(workflowCalls, 1);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.projects[0].sessions));
  const beta = first.projects.find((project) => project.name === "beta").sessions[0];
  assert.equal(beta.phase, "plan");
  assert.equal(beta.phaseStartedAt, 900);

  now += 100;
  cache.tick();
  assert.equal(projectCalls, 1, "project filesystem classification stays cadence-cached");
  assert.equal(agentCalls, 2, "a timer tick may refresh in-memory live rows");
  assert.equal(workflowCalls, 1, "a timer tick must not read workflow ledgers");
  assert.equal(
    cache.service.snapshot().projects.find((project) => project.name === "beta").sessions[0].phase,
    "plan",
    "a sub-cadence timer tick reuses the last workflow aggregate",
  );

  now += 899;
  cache.tick();
  assert.equal(workflowCalls, 1, "workflow rows remain cached just before their cadence");
  now += 1;
  cache.tick();
  assert.equal(workflowCalls, 2, "workflow rows eventually refresh at a safe owner cadence");

  workflowMode = "throw";
  now += 100;
  cache.refresh();
  assert.equal(projectCalls, 1, "project filesystem classification stays cadence-cached");
  assert.equal(agentCalls, 5);
  assert.equal(workflowCalls, 3, "an explicit lifecycle refresh updates workflow rows");
  const noWorkflow = cache.service.snapshot();
  assert.equal(noWorkflow.projects.find((project) => project.name === "beta").sessions[0].phase, "none");
  assert.equal(noWorkflow.projects[0].sessions.length, 4);

  workflowMode = "malformed";
  now += 10_000;
  core.listProjects = () => { projectCalls += 1; throw new Error("catalog refresh failed"); };
  core.listAgents = () => { agentCalls += 1; throw new Error("agent refresh failed"); };
  cache.refresh();
  assert.equal(cache.service.snapshot().projects[0].sessions.length, 4, "last complete core rows survive refresh failure");
});

test("empty and failing project catalogs are cadence-limited outside snapshot", () => {
  let now = 0;
  let calls = 0;
  let fail = false;
  const cache = createDashboardCache({
    core: {
      listProjects() {
        calls += 1;
        if (fail) throw new Error("temporary catalog failure");
        return [];
      },
      listAgents() { return []; },
    },
    now: () => now,
    catalogRefreshMs: 1_000,
  });
  assert.equal(calls, 1);
  cache.refresh();
  cache.refresh();
  assert.equal(calls, 1, "a valid empty catalog must remain cached");
  now = 1_000;
  fail = true;
  cache.refresh();
  assert.equal(calls, 2);
  now = 1_001;
  cache.refresh();
  assert.equal(calls, 2, "a failed attempt must not hammer filesystem classification");
  assert.deepEqual(cache.service.snapshot().projects, []);
});

test("Cordis plugin provides cache, uses lightweight timer ticks, and disposes effects", async () => {
  assert.equal(name, "qq-dashboard");
  assert.equal(provide, "qq-dashboard");
  assert.deepEqual(inject, ["qq-core"]);
  assert.equal(cacheDefaults.workflowRefreshMs, 30_000);

  let status = "idle";
  let calls = 0;
  let workflowCalls = 0;
  const listeners = new Map();
  const removed = [];
  const effects = [];
  const provided = new Map();
  const core = {
    listProjects: catalog,
    listAgents() {
      calls += 1;
      return [{
        id: IDS.alpha10,
        alias: "8",
        label: "chair",
        status,
        idle_for_ms: 5,
        parent: "",
        cwd: "/projects/alpha",
      }];
    },
  };
  const workflows = {
    workflows: {
      snapshots() {
        workflowCalls += 1;
        return [];
      },
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
  const disposeReturned = apply(ctx, { refreshMs: 50 });
  const service = provided.get("qq-dashboard");
  assert.equal(service.snapshot().projects[0].sessions[0].activity, "idle");
  const afterApply = calls;
  service.snapshot();
  service.snapshot();
  assert.equal(calls, afterApply, "UI-frequency reads must not touch qq-core");
  assert.equal(workflowCalls, 1);

  await new Promise((resolve) => setTimeout(resolve, 130));
  assert.ok(calls > afterApply, "the owner timer should refresh live agent rows");
  assert.equal(workflowCalls, 1, "owner timer ticks must not poll workflow ledgers");

  status = "running";
  listeners.get("agent/status")?.({});
  assert.equal(service.snapshot().projects[0].sessions[0].activity, "working");
  assert.equal(service.snapshot().projects[0].sessions[0].idleForMs, null);
  assert.equal(workflowCalls, 2, "agent lifecycle events perform a full refresh");
  disposeReturned();
  effects[0]?.();
  assert.deepEqual(new Set(removed), new Set(["agent/created", "agent/status", "agent/disposed"]));
});

test("required core and malformed input fail or degrade without leaking UUID display text", () => {
  assert.throws(
    () => createDashboardCache({ core: { listAgents() { return []; } } }),
    /listAgents\/listProjects service is required/,
  );
  const malformed = projectSnapshot({
    projects: [{ name: "x", label: IDS.alpha3, cwd: "/x", grouped: false }],
    agents: [{ id: IDS.alpha3, alias: IDS.alpha10, label: `chair ${IDS.alpha10}`, cwd: "/x" }],
    workflowRows: null,
    usage: null,
  });
  assert.equal(malformed.projects[0].label, "x");
  assert.equal(malformed.projects[0].sessions[0].alias, "");
  assert.equal(malformed.projects[0].sessions[0].label, "session");
  assert.deepEqual(malformed.usage.providers, []);
});
