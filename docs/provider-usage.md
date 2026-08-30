# Provider usage reference

This reference documents the provider cache consumed by qq-dashboard and qq-ui,
the shell-only credential boundary, and provider setup prerequisites.

## Cache contract

Structured provider usage is a strict non-secret display cache shared by the
shell producer and optional in-process reader. After every fetched `--once` or
interactive frame, and after every cache-only headless cycle, `qq-dashboard`
atomically replaces this file with mode `0600`:

```text
~/.local/state/qq/telemetry/usage-cache.json
```

The on-disk envelope is separate from the public dashboard schema:

```js
{
  schema: "qq.dashboard-usage/v1",
  generatedAt: 1788000000000,       // producer-cycle epoch milliseconds
  providers: [{
    id: "codex",
    label: "Codex",
    state: "ready",
    observedAt: 1788000000000,
    meters: [{
      id: "weekly",
      label: "7d",
      usedRatio: 0.42,
      resetAt: 1788600000000,
      detail: ""
    }]
  }]
}
```

A valid producer cycle contains Codex, Grok, and Qwen rows even when a provider
is unavailable. States have exact display-cache meanings:

- `ready`: a fresh provider reading;
- `estimated`: a calibrated Qwen estimate derived from the local token meter;
- `stale`: the last Qwen provider reading, still inside its quota window; and
- `unavailable`: no usable reading for this cycle (`observedAt: null`, no
  meters).

All timestamps are epoch milliseconds or `null`. Stable meter identities are
`weekly` / `7d` and, for Qwen when known, `five-hour` / `5h`. `usedRatio` is a
nonnegative number and may exceed one. `detail` contains only neutral display
text such as a Qwen used/limit value and an `estimated` marker.

The plugin reads the file once during its initial owner refresh and then at most
once per its independent 30-second usage cadence, plus a prompt read after an
exact successful producer signal. It rejects symlinks, non-regular or oversized
files, malformed JSON, wrong schemas, and invalid rows. Missing or rejected
input starts empty and later preserves the last valid cache; it never suppresses
live project/session state. A static `config.usage` remains available for
embedders and tests and suppresses the default file reader unless an explicit
`config.usageFor` is injected.

With the default file reader, the plugin starts bundled `qq-dashboard
--headless` as one non-detached child. The child fetches immediately, then
repeats at `TELEMETRY_REFRESH` (30 seconds by default) while retaining the
existing process-local Qwen gateway cadence and calibration. It skips execution
profiles and all frame/ANSI output. Its piped stdout protocol is only the fixed
`qq-dashboard:usage-cache-updated` line after a successful atomic write; stdin
is ignored and stderr is discarded. Unexpected exits restart after a bounded
delay. Plugin disposal or HMR clears a pending restart and sends `SIGTERM` to
the child, with no restart after disposal.

The Node reader/supervisor never reads authentication or cookie stores, performs
provider requests, or receives child diagnostics or payloads. Only the existing
shell producer reads local credentials/cookies and provider endpoints. It
serializes only the normalized fields above through a mode-`0600`,
same-directory temporary file and atomic rename. Credentials, cookies, raw
provider payloads, execution profiles, ANSI text, local paths, and profile data
never cross the cache or stdout boundary. Serialization or write failure emits
no signal and preserves the prior cache.

## Provider prerequisites

- **Codex:** the shell producer reads the existing OpenAI Codex authorization
  entry from Pi's local auth store.
- **Grok:** the producer reads qq-models' OAuth store at the fixed HOME-relative
  location `~/.local/state/qq/.qq-grok-auth.json`. It does not refresh or mutate
  this file; qq-models owns refresh. Legacy Pi xai entries are accepted only
  when the dedicated store is absent. An unsafe or invalid dedicated store
  fails closed.
- **Qwen:** gateway readings require explicit `TELEMETRY_QWEN_*` overrides or
  the gated `~/.local/state/qq/telemetry/qwen.cookies` snapshot. Initialize the
  snapshot with `qq-dashboard-cookies refresh`; the helper inventories only
  qwencloud.com cookies and requires explicit confirmation before writing.
  Neither the dashboard nor its producer reads Firefox or bypasses that gate.
  Use `qq-dashboard-cookies status` and `validate` to inspect readiness.

A Firefox profile or `cookies.sqlite` alone is not Qwen initialization. Until a
snapshot or explicit override exists, Qwen correctly appears unavailable (or
uses an eligible persisted estimate/stale reading if one already exists).

## Security boundary

The shell producer alone reads credentials, cookies, and raw provider responses.
Grok's bearer is supplied through a mode-`0600` private temporary header file,
not a process argument. Raw responses remain in private temporary files; only
normalized display fields enter the mode-`0600` cache. Credentials, cookie
values, raw payloads, and local credential paths never enter Node, child stdout,
the cache, or qq-ui.
