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
- `stale`: a last-known-good reading with its original `observedAt`; and
- `unavailable`: no usable current or eligible last-good reading
  (`observedAt: null`, no meters).

For Codex and Grok, last-known-good data is eligible for at most 15 minutes and
never beyond a known quota reset. A request, authentication, or response-format
failure changes an eligible row to `stale`, not `ready`; expiry changes only that
row to `unavailable`. A fresh sibling provider still becomes `ready` in the same
cache cycle. The reader also expires Codex/Grok stale rows independently, so a
stopped producer cannot make one stale row persist indefinitely or hide a fresh
row from another provider. Qwen retains its existing calibrated/window-bound
estimate and stale policy.

All timestamps are epoch milliseconds or `null`. Stable meter identities are
`weekly` / `7d` and, for Qwen when known, `five-hour` / `5h`. `usedRatio` is a
nonnegative number; Codex/Grok percentages are bounded to one while Qwen may
exceed one. `detail` contains only neutral display text such as a Qwen
used/limit value and an `estimated` marker.

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

Codex and Grok first use the qq-models-owned OAuth files
`.qq-codex-auth.json` and `.qq-grok-auth.json`. Their containing directory is
resolved exactly as qq-models resolves DSH home:

1. `QQ_DSH_HOME`;
2. `DSH_HOME`;
3. `$XDG_STATE_HOME/qq`;
4. `$HOME/.local/state/qq`.

Environment values and credential paths must be absolute and canonical. Every
path component must be a real directory (not a symlink), and a credential must
be a current-user, regular, readable, mode-`0600`, bounded file. Dedicated
content must match `qq.models-auth/v1`, OAuth type, connector identity,
nonempty token fields, and an unexpired millisecond expiry. Codex accepts
qq-models' explicit `accountId` representation or the equivalent account claim
from its access JWT. A present unsafe, expired, wrong-connector, or malformed
selected dedicated store fails closed; it never searches a lower-precedence
store or silently switches to Pi.

When the selected dedicated file is genuinely absent, a similarly validated,
read-only Pi credential may be used as a compatibility fallback (Codex, or
legacy xai for Grok). This is not a refresh path. The dashboard never writes,
rotates, locks, or refreshes qq-models or Pi OAuth state. qq-models remains the
owner. Check recovery with `qq-models-login status`, then run
`qq-models-login codex` or `qq-models-login grok` (or use the corresponding
qq-models `/login`) when login/refresh is required.

Provider requests run concurrently and independently. Each uses a six-second
attempt timeout and at most one delayed retry for network failures, 408, 425,
429, and selected 5xx responses. Permanent client/authentication responses,
including 401 and 403, are not retried. A provider response is accepted only
after a successful 2xx status and strict JSON normalization. Known current
snake/camel field forms accept finite percentages as JSON numbers or strict
numeric strings in the range 0..100. Reset times may be unambiguous modern epoch
seconds, epoch milliseconds, or timezone-qualified RFC 3339 strings. Negative,
non-finite, fractional/ambiguous timestamps, conflicting variants, malformed
JSON, and junk field values are rejected.

Qwen gateway readings require explicit `TELEMETRY_QWEN_*` overrides or the
gated `~/.local/state/qq/telemetry/qwen.cookies` snapshot. Initialize the
snapshot with `qq-dashboard-cookies refresh`; the helper inventories only
qwencloud.com cookies and requires explicit confirmation before writing.
Neither the dashboard nor its producer reads Firefox or bypasses that gate. Use
`qq-dashboard-cookies status` and `validate` to inspect readiness.

A Firefox profile or `cookies.sqlite` alone is not Qwen initialization. Until a
snapshot or explicit override exists, Qwen correctly appears unavailable (or
uses an eligible persisted estimate/stale reading if one already exists).

## Security boundary

The shell producer alone reads credentials, cookies, and raw provider responses.
Codex and Grok authorization/account headers are supplied through mode-`0600`
private temporary header files, never process arguments. Bodies remain in the
private temporary directory, are cleared before each cycle, and only normalized
display fields enter the mode-`0600` cache. Credentials, refresh tokens, raw
payloads, HTTP diagnostics, execution profiles, and local paths never enter
Node, child stdout, the cache, or qq-ui. Headless stdout remains exactly the
fixed cache-update signal.
