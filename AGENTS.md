# qq-dashboard repository guidance

`qq-dashboard` is a QQ-specific terminal dashboard. Public source visibility does not make it a general-purpose telemetry framework.

- Keep the dashboard read-only. QQ owns execution-profile policy and mutation.
- Read execution profiles only through `qq-profile list --json`; do not import QQ source or read its private policy file directly.
- Provider credentials and Qwen cookies must never appear in dashboard output, logs, fixtures, or commits.
- Preserve the confined mode-0600 Qwen cookie snapshot and its explicit refresh gate.
- Keep provider failures and execution-profile failures isolated by section.
- Prefer direct provider implementations over a plugin framework.
- Run `npm test` for every change.
