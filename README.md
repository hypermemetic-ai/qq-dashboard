# QQ Dashboard

A QQ-specific terminal dashboard for operational information used when running agent methodology.

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

## Check and install

Use a landed checkout of public `main`. The checkout must be at a clean commit; the installer refuses tracked, staged, and untracked changes.

```sh
git clone https://github.com/hypermemetic-ai/qq-dashboard.git
cd qq-dashboard
git switch main
git pull --ff-only
npm test
./install.sh
```

The product-owned installer atomically replaces `${HOME}/.local/lib/qq/dashboard`. It installs both command binaries, their relative helper library, and a source-commit provenance marker. The marker describes the artifact only; consumers must not read it as a compatibility, version, or pinning mechanism. If staging or replacement fails, the prior installed artifact is preserved or restored.

Tests and operators may select another install location with an explicit absolute path:

```sh
QQ_DASHBOARD_INSTALL_ROOT=/absolute/path/to/dashboard ./install.sh
```

The repository must still be clean and committed. The installer does not fetch source and has no daemon or service lifecycle to manage.

To upgrade, fast-forward the landed `main` checkout, run the product checks, and install again:

```sh
git switch main
git pull --ff-only
npm test
./install.sh
```

The npm package surface remains available for standalone package validation, but QQ consumes only the stable product-installed commands, not an npm commit dependency.

## Runtime requirements

- Bash
- `curl`, `jq`, GNU `date`, and standard core utilities
- `qq-profile` on `PATH`, or an exact executable supplied through `QQ_PROFILE_BIN`
- Pi's local authorization and session stores for provider usage collection
- Python 3 and Firefox only when refreshing the Qwen browser-cookie snapshot

Provider credentials are read only for provider requests and are never displayed. Installation and upgrades do not touch the existing non-secret cache or Qwen cookie snapshot under `~/.local/state/qq/telemetry/`.

## Validate

```sh
npm test
```

The tests use private temporary homes and installation roots. They cover dashboard behavior, default and overridden installation, executable and relative-library delivery, provenance, dirty-source refusal, and restoration of a prior artifact after an injected installation failure. They never access the operator's installed dashboard or telemetry state.

Extracted from `hypermemetic-ai/qq` at commit `4ce0518392faab970ab1fbd3cc8fc49256918677`.
