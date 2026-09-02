#!/usr/bin/env bash
set -euo pipefail
set +x
# Tests that replace HOME must not inherit qq-models store selection from
# the operator environment. Precedence tests set private values explicitly.
unset QQ_DSH_HOME DSH_HOME XDG_STATE_HOME

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
TMP=$(mktemp -d "${TMPDIR:-/tmp}/qq-dashboard-install-test.XXXXXX")
cleanup() { rm -rf -- "$TMP"; }
trap cleanup EXIT
chmod 700 "$TMP"

# Exercise the installer from a clean committed repository containing the exact
# tracked sources under test. Every install and HOME remains under TMP.
product_source="$TMP/product-source"
mkdir -m 700 "$product_source"
if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git -C "$ROOT" ls-files -z --cached --others --exclude-standard \
    | (cd "$ROOT" && tar --null --files-from=- -cf -) \
    | (cd "$product_source" && tar -xf -)
else
  # Some sandbox runners expose the source overlay without discoverable Git
  # metadata. Copy that exact working tree, then create the isolated repository
  # used by every installer assertion below.
  (cd "$ROOT" && tar -cf - .gitignore README.md bin docs install.sh package.json src tests) \
    | (cd "$product_source" && tar -xf -)
fi
# The agent workspace may export an outer worktree explicitly. The remaining
# suite owns an isolated nested repository and must not redirect Git there.
unset GIT_DIR GIT_WORK_TREE
git -C "$product_source" init -q -b main
git -C "$product_source" config user.name qq-dashboard-test
git -C "$product_source" config user.email qq-dashboard-test@example.invalid
git -C "$product_source" add -A
git -C "$product_source" commit -q -m source
product_commit=$(git -C "$product_source" rev-parse HEAD)

if QQ_DASHBOARD_INSTALL_ROOT=relative "$product_source/install.sh" \
  >"$TMP/relative.out" 2>"$TMP/relative.err"; then
  echo 'installer accepted a relative QQ_DASHBOARD_INSTALL_ROOT' >&2
  exit 1
fi
grep -Fq 'QQ_DASHBOARD_INSTALL_ROOT must be an absolute path' "$TMP/relative.err"

test_home="$TMP/default-home"
mkdir -m 700 "$test_home"
HOME="$test_home" env -u QQ_DASHBOARD_INSTALL_ROOT "$product_source/install.sh" \
  >"$TMP/default.out"
default_root="$test_home/.local/lib/qq/dashboard"
[[ -x "$default_root/bin/qq-dashboard" ]]
[[ -x "$default_root/bin/qq-dashboard-cookies" ]]
[[ -f "$default_root/bin/lib/telemetry-lib.sh" ]]
[[ -f "$default_root/package.json" ]]
[[ -f "$default_root/docs/provider-usage.md" ]]
[[ -f "$default_root/src/plugin.mjs" ]]
[[ -f "$default_root/src/service.mjs" ]]
[[ -f "$default_root/src/snapshot.mjs" ]]
[[ -f "$default_root/src/usage-cache.mjs" ]]
[[ -f "$default_root/src/usage-producer.mjs" ]]
[[ $(<"$default_root/share/qq-dashboard/source-commit") == "$product_commit" ]]
node --input-type=module - "$default_root" <<'NODE'
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const root = process.argv[2];
const plugin = await import(pathToFileURL(`${root}/src/plugin.mjs`));
assert.equal(plugin.name, "qq-dashboard");
assert.equal(plugin.provide, "qq-dashboard");
NODE
HOME="$test_home" "$default_root/bin/qq-dashboard" --help >"$TMP/dashboard-help"
HOME="$test_home" "$default_root/bin/qq-dashboard-cookies" --help >"$TMP/cookies-help"
grep -Fq 'Usage: qq-dashboard [--once|--headless] [--help]' "$TMP/dashboard-help"
grep -Fq 'Usage: qq-dashboard-cookies <refresh|status|validate> [--help]' "$TMP/cookies-help"
formatted=$(HOME="$test_home" bash -c 'source "$1"; fmt_num 1234567' \
  _ "$default_root/bin/qq-dashboard")
[[ "$formatted" == 1,234,567 ]]
[[ ! -e "$test_home/.local/state/qq/telemetry" ]]

assert_dirty_refusal() {
  local label=$1
  if HOME="$test_home" env -u QQ_DASHBOARD_INSTALL_ROOT "$product_source/install.sh" \
    >"$TMP/$label.out" 2>"$TMP/$label.err"; then
    echo "installer accepted $label source changes" >&2
    exit 1
  fi
  grep -Fq 'source repository is dirty' "$TMP/$label.err"
  [[ $(<"$default_root/share/qq-dashboard/source-commit") == "$product_commit" ]]
}

touch "$product_source/untracked"
assert_dirty_refusal untracked
rm -- "$product_source/untracked"
printf '\nunstaged installer test\n' >>"$product_source/README.md"
assert_dirty_refusal unstaged
git -C "$product_source" checkout -q -- README.md
printf '\nstaged installer test\n' >>"$product_source/README.md"
git -C "$product_source" add README.md
assert_dirty_refusal staged
git -C "$product_source" reset -q HEAD -- README.md
git -C "$product_source" checkout -q -- README.md

# Fail the final artifact rename after the prior root has moved aside. The
# installer must restore the complete prior artifact and remove staging paths.
printf '\ninstaller failure-safety test commit\n' >>"$product_source/README.md"
git -C "$product_source" add README.md
git -C "$product_source" commit -q -m upgrade
upgrade_commit=$(git -C "$product_source" rev-parse HEAD)
printf 'prior\n' >"$default_root/prior-artifact"
mkdir -m 700 "$TMP/mv-shim"
cat >"$TMP/mv-shim/mv" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
for argument in "$@"; do
  if [[ "$argument" == */.dashboard.install.* && ! -e "$QQ_DASHBOARD_MV_SHIM_STATE" ]]; then
    : >"$QQ_DASHBOARD_MV_SHIM_STATE"
    exit 73
  fi
done
exec /bin/mv "$@"
SH
chmod 700 "$TMP/mv-shim/mv"
if HOME="$test_home" PATH="$TMP/mv-shim:$PATH" \
  QQ_DASHBOARD_MV_SHIM_STATE="$TMP/mv-shim.failed" \
  env -u QQ_DASHBOARD_INSTALL_ROOT "$product_source/install.sh" \
  >"$TMP/failed.out" 2>"$TMP/failed.err"; then
  echo 'injected installation failure unexpectedly succeeded' >&2
  exit 1
fi
[[ -f "$default_root/prior-artifact" ]]
[[ $(<"$default_root/share/qq-dashboard/source-commit") == "$product_commit" ]]
[[ -z $(find "$(dirname -- "$default_root")" -maxdepth 1 \
  \( -name '.dashboard.install.*' -o -name '.dashboard.previous.*' \) -print -quit) ]]

HOME="$test_home" env -u QQ_DASHBOARD_INSTALL_ROOT "$product_source/install.sh" \
  >"$TMP/upgrade.out"
[[ $(<"$default_root/share/qq-dashboard/source-commit") == "$upgrade_commit" ]]
[[ ! -e "$default_root/prior-artifact" ]]

override_root="$TMP/override/dashboard"
QQ_DASHBOARD_INSTALL_ROOT="$override_root" "$product_source/install.sh" \
  >"$TMP/override.out"
[[ -x "$override_root/bin/qq-dashboard" ]]
[[ -x "$override_root/bin/qq-dashboard-cookies" ]]
[[ -f "$override_root/bin/lib/telemetry-lib.sh" ]]
[[ -f "$override_root/package.json" ]]
[[ -f "$override_root/docs/provider-usage.md" ]]
[[ -f "$override_root/src/plugin.mjs" ]]
[[ -f "$override_root/src/usage-cache.mjs" ]]
[[ -f "$override_root/src/usage-producer.mjs" ]]
[[ $(<"$override_root/share/qq-dashboard/source-commit") == "$upgrade_commit" ]]
[[ ! -e "$TMP/.local/state/qq/telemetry" ]]

printf 'test-install: pass\n'
