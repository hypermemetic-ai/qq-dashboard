# QQ Dashboard

`qq-dashboard` owns QQ's presentation-neutral, operator-only view of **what is
happening right now**. It has two compatible surfaces:

- an optional in-process Cordis service with a cached live projects → sessions
  snapshot for operator UIs; and
- the existing terminal dashboard for Codex, Grok, and Qwen plan usage and QQ
  execution profiles.

The service projects existing authorities. `qq-core` remains authoritative for
live identity, status, topology, and active project-chair rows. `qq-workflows`
remains authoritative for architect semantic phase and phase start time. The
dashboard does not infer phase from labels, case prose, sidecars, or elapsed
poll observations.

## In-process service

The package root is a Cordis plugin. Loading it provides the cached service and,
by default, supervises one invisible cache-only usage producer for the same
plugin lifetime:

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
project/folder. Each refresh reads the full live forest once with
`qq-core.listAgents()`, awaits active project chairs once with `qq-core.list()`,
and joins top-level roots by exact session ID. Children inherit the joined root.
Grouping never consults agent cwd, worktree paths, labels, or case prose. The
reserved `projects` chair subtree and projectless Home/system roots are omitted.
Display fallbacks never surface a physical UUID: alias, then a non-UUID human
label, then `session`. UUIDs remain available only as action/topology identity.
`idleForMs` is a nonnegative duration or `null`; missing, negative, or non-finite
source values remain unknown (`null`) so consumers render no timer.

Construction publishes a valid empty snapshot immediately and starts the first
private-cache refresh in the background. A short owner timer and agent
lifecycle/status events refresh both `qq-core` projections. Refreshes are
serialized and burst-coalesced, so slow asynchronous `list()` reads never
overlap or build an unbounded backlog. Timer refreshes reuse the last workflow
aggregate and provider-usage file between their independent 30-second cadences;
lifecycle events force a workflow aggregate refresh but never bypass the usage
cadence. A fixed successful-publication signal from the supervised producer is
the one exception: it schedules an immediate strict cache read, serialized and
coalesced with any active refresh, so a newly created file need not wait for the
next cadence. In particular, the UI's ~100 ms read cadence is never used to poll
qq-core, workflow ledgers, the filesystem, or a subprocess. Therefore UI sheets
may call `snapshot()` every ~100 ms without causing filesystem, network,
credential, or subprocess work. A failed core refresh retains the last complete
core pair, and optional workflow replacement or failure cannot suppress live session state. Architect
phase is consumed only from the fixed synchronous aggregate method:

```js
ctx.get("qq-workflows", false)?.workflows?.snapshots()
// [{ sessionUuid, workflow, phase, phaseStartedAt }]
```

## Provider usage

The plugin supervises one shell-only `--headless` producer and reads its strict,
non-secret display cache. Startup, retry, disposal/HMR, cache schema, provider
prerequisites, and security boundaries are documented in
[Provider usage](docs/provider-usage.md).

Qwen gateway usage requires `qq-dashboard-cookies refresh` and explicit
operator confirmation. A Firefox profile alone does not initialize Qwen, and
the producer never bypasses this gate.

### Host composition

The plugin requires `qq-core` and is itself optional to the host/UI. A host
composition should load it after `qq-core` and before a UI that reads the
service. Optional `qq-workflows` may be loaded, unloaded, or replaced at any
time because it is resolved dynamically. Automatic production is disabled when
`config.usage` is present, an explicit `config.usageFor` is supplied, or
`config.produceUsage === false`; this keeps deterministic embedders and tests
free of subprocesses. Setting only `produceUsage: false` retains regular strict
reads of a cache produced elsewhere. Equivalent Cordis host metadata is:

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
owners may import `@hypermemetic-ai/qq-dashboard/service`. The strict file
reader and path helper are exported from `@hypermemetic-ai/qq-dashboard/usage-cache`.
The lifecycle supervisor and fixed signal are exported from
`@hypermemetic-ai/qq-dashboard/usage-producer` for host-level testing; normal
Cordis compositions should let the root plugin own it.

## Terminal commands

```text
qq-dashboard
qq-dashboard --once
qq-dashboard --headless
qq-dashboard-cookies refresh
qq-dashboard-cookies status
qq-dashboard-cookies validate
```

The terminal page retains:

- Codex, Grok, and Qwen plan usage, quota windows, resets, and exhaustion; and
- QQ architect, runner, scribe, and QA execution profiles.

Interactive mode refreshes automatically. Press `r` to refresh immediately or
`q` to quit. `--once` retains the fetched one-frame command. `--headless` is
available for diagnostics and non-Cordis owners, but a normally loaded plugin
already owns one instance and should not be paired with a duplicate manual
producer. QQ remains the owner of execution-profile policy and runtime behavior;
the interactive and `--once` surfaces consume `qq-profile list --json`, while
headless mode deliberately does not.

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
source, mutate provider state, or install an operating-system daemon. The
loaded Cordis plugin owns its child producer directly. To upgrade, fast-forward
the landed `main` checkout, run `npm test`, and install again.

## Runtime requirements

The in-process service needs Node.js and a Cordis host-provided `qq-core`
service. The terminal utilities need:

- Bash;
- `curl`, `jq`, GNU `date`, and standard core utilities;
- `qq-profile` on `PATH`, or an exact executable supplied through
  `QQ_PROFILE_BIN`, for interactive and `--once` profile rendering (not
  headless production);
- qq-models' Codex/Grok OAuth stores (with validated Pi fallback only when the
  selected dedicated file is absent) and Pi's Qwen token meter;
- Python 3 and Firefox only when refreshing the Qwen browser-cookie snapshot.

Provider credentials stay in the shell producer and never enter Node, the cache,
or the UI. Installation and upgrades do not touch existing telemetry state. See
[the provider security boundary](docs/provider-usage.md#security-boundary).

## Validate

```sh
npm test
npm run check
```

Tests use private temporary homes and installation roots. They cover live
project grouping, aliases and UUID-safe fallbacks, activity mapping, topology
and ordering, workflow phase pass-through, provider cache isolation, malformed
optional dependencies, snapshot read purity, plugin provision/disposal, forced
usage-read serialization, supervisor signal/restart/disposal behavior, headless
producer isolation, the existing terminal dashboard, and atomic
installation/restoration. They never
access the operator's installed dashboard or telemetry state.

Extracted from `hypermemetic-ai/qq` at commit
`4ce0518392faab970ab1fbd3cc8fc49256918677`.
