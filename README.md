# QQ Dashboard

A private, QQ-specific terminal dashboard for operational information used when running agent methodology.

The first page shows:

- Codex, Grok, and Qwen plan usage, quota windows, resets, and exhaustion;
- QQ architect, runner, scribe, and QA execution profiles.

This is deliberately not a general-purpose telemetry product. QQ remains the owner of execution-profile policy and runtime behavior; the dashboard consumes the stable read-only `qq-profile list --json` projection.

## Commands

```text
qq-dashboard [--once]
qq-dashboard-cookies refresh
qq-dashboard-cookies status
qq-dashboard-cookies validate
```

Interactive mode refreshes automatically. Press `r` to refresh immediately or `q` to quit.

## Runtime requirements

- Bash
- `curl`, `jq`, GNU `date`, and standard core utilities
- `qq-profile` on `PATH`, or an exact executable supplied through `QQ_PROFILE_BIN`
- Pi's local authorization and session stores for provider usage collection
- Python 3 and Firefox only when refreshing the Qwen browser-cookie snapshot

Provider credentials are read only for provider requests and are never displayed. The existing non-secret cache and Qwen cookie snapshot remain under `~/.local/state/qq/telemetry/` so extraction from QQ does not discard or migrate operator state.

## Validate

```text
npm test
```

Extracted from `hypermemetic-ai/qq` at commit `4ce0518392faab970ab1fbd3cc8fc49256918677`.
