# QQ Dashboard

`qq-dashboard` owns QQ's presentation-neutral, operator-only view of **what is
happening right now**. It has two compatible surfaces:

- an optional in-process Cordis service with a cached live projects → sessions
  snapshot for operator UIs; and
- the existing terminal dashboard for Codex, Grok, and Qwen plan usage and QQ
  execution profiles.

The service projects existing authorities. `qq-core` remains authoritative for
live identity, status, topology, and project catalog rows. `qq-workflows`
remains authoritative for architect semantic phase and phase start time. The
dashboard does not infer phase from labels, case prose, sidecars, or elapsed
poll observations.

## In-process service

The package root is a Cordis plugin. Loading it calls:

```js
ctx.provide("qq-dashboard", service);
```

The service exposes one read method:

```js
const dashboard = ctx.get("qq-dashboard", false);
const snapshot = dashboard?.snapshot();
```

`snapshot()` is synchronous, side-effect-free, and returns a cached immutable
`qq.dashboard/v1` object:

```js
{
  schema: "qq.dashboard/v1",
  generatedAt: 1788000000000,
  projects: [{
    key: "opaque grouping identity",
    name: "route-name",
    label: "Project label",
    folder: "",
    folderLabel: "",
    sessions: [{
      sessionId: "session-…",       // action identity, never display text
      alias: "7",
      label: "architect",
      parentSessionId: "",
      depth: 0,
      activity: "working",          // qq-core running → working
      idleForMs: null,
      workflow: "architect",
      phase: "planning",            // planning | plan | work | none | unknown
      phaseStartedAt: 1787999000000
    }]
  }],
  usage: { generatedAt: 1788000000000, providers: [] }
}
```

Rows are deterministic, parent-before-child, and grouped by the root chair's
project/folder. Children inherit the root even when their cwd is a worktree.
The reserved `projects` chair subtree and non-project Home rows are excluded.
Display fallbacks never surface a physical UUID: alias, then a non-UUID human
label, then `session`. UUIDs remain available only as action/topology identity.
`idleForMs` is a nonnegative duration or `null`; missing, negative, or non-finite
source values remain unknown (`null`) so consumers render no timer.

The plugin performs a full private-cache refresh on agent lifecycle/status
events. A short timer updates live `qq-core` agent rows for idle-duration
freshness, but reuses the last workflow aggregate between its independent
30-second refreshes; project catalog refresh is likewise cadence-limited to 30
seconds. Lifecycle events force an immediate aggregate refresh. In particular,
the UI's ~100 ms read cadence is never used to poll workflow ledgers. Therefore
UI sheets may call `snapshot()` every ~100 ms without causing filesystem,
network, credential, or subprocess work. Optional workflow replacement or failure cannot suppress live
session state. Architect phase is consumed only from the fixed synchronous
aggregate method:

```js
ctx.get("qq-workflows", false)?.workflows?.snapshots()
// [{ sessionUuid, workflow, phase, phaseStartedAt }]
```

Structured provider usage is a strict non-secret display cache. The MVP cache
is intentionally empty; the terminal dashboard remains the provider-plan
surface. No credentials, cookies, local session paths, or provider refresh
callbacks cross the service boundary.

### Host composition

The plugin requires `qq-core` and is itself optional to the host/UI. A host
composition should load it after `qq-core` and before a UI that reads the
service. Optional `qq-workflows` may be loaded, unloaded, or replaced at any
time because it is resolved dynamically. Equivalent Cordis host metadata is:

```yaml
- id: qq-dashboard
  name: '@hypermemetic-ai/qq-dashboard'
  inject: [qq-core]
```

`qq-ui` should resolve `ctx.get("qq-dashboard", false)` through an optional
closure and retain its existing picker when absent. Session-row jumps use the
existing same-origin endpoint:

```text
GET ${basePath}/sessions/open?session=${encodeURIComponent(sessionId)}
```

The session UUID belongs only in the href or `data-session-id`, never visible
text or title. Host loading and qq-ui rendering are owned by those respective
compositions; this package does not mount HTTP routes.

Pure consumers/tests may import `@hypermemetic-ai/qq-dashboard/snapshot`; cache
owners may import `@hypermemetic-ai/qq-dashboard/service`.

## Terminal commands

```text
qq-dashboard [--once]
qq-dashboard-cookies refresh
qq-dashboard-cookies status
qq-dashboard-cookies validate
```

The terminal page retains:

- Codex, Grok, and Qwen plan usage, quota windows, resets, and exhaustion; and
- QQ architect, runner, scribe, and QA execution profiles.

Interactive mode refreshes automatically. Press `r` to refresh immediately or
`q` to quit. QQ remains the owner of execution-profile policy and runtime
behavior; this surface consumes `qq-profile list --json`.

## Check and install

Use a landed checkout of public `main`. The checkout must be at a clean commit;
the installer refuses tracked, staged, and untracked changes.

```sh
git clone https://github.com/hypermemetic-ai/qq-dashboard.git
cd qq-dashboard
git switch main
git pull --ff-only
npm test
./install.sh
```

The product-owned installer atomically replaces
`${HOME}/.local/lib/qq/dashboard`. It installs both command binaries, their
relative helper library, the ESM/Cordis package surface, and a source-commit
provenance marker. The marker describes the artifact only; consumers must not
read it as a compatibility, version, or pinning mechanism. If staging or
replacement fails, the prior installed artifact is preserved or restored.

Tests and operators may select another install location with an explicit
absolute path:

```sh
QQ_DASHBOARD_INSTALL_ROOT=/absolute/path/to/dashboard ./install.sh
```

The repository must still be clean and committed. Installation does not fetch
source, mutate provider state, or manage a daemon. To upgrade, fast-forward the
landed `main` checkout, run `npm test`, and install again.

## Runtime requirements

The in-process service needs Node.js and a Cordis host-provided `qq-core`
service. The terminal utilities need:

- Bash;
- `curl`, `jq`, GNU `date`, and standard core utilities;
- `qq-profile` on `PATH`, or an exact executable supplied through
  `QQ_PROFILE_BIN`;
- Pi's local authorization and session stores for provider usage collection;
- Python 3 and Firefox only when refreshing the Qwen browser-cookie snapshot.

Provider credentials are read only by terminal provider requests and are never
displayed. Installation and upgrades do not touch the existing non-secret
cache or Qwen cookie snapshot under `~/.local/state/qq/telemetry/`.

## Validate

```sh
npm test
npm run check
```

Tests use private temporary homes and installation roots. They cover live
project grouping, aliases and UUID-safe fallbacks, activity mapping, topology
and ordering, workflow phase pass-through, provider cache isolation, malformed
optional dependencies, snapshot read purity, plugin provision/disposal, the
existing terminal dashboard, and atomic installation/restoration. They never
access the operator's installed dashboard or telemetry state.

Extracted from `hypermemetic-ai/qq` at commit
`4ce0518392faab970ab1fbd3cc8fc49256918677`.
