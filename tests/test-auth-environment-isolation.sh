#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/qq-auth-isolation-test.XXXXXX")"
cleanup() { rm -rf -- "$TEST_TMP"; }
trap cleanup EXIT
chmod 700 "$TEST_TMP"

external="$TEST_TMP/external-provider-home"
xdg="$TEST_TMP/external-xdg-state"
mkdir -m 700 "$external" "$xdg" "$xdg/qq"
marker="synthetic-external-credential-$PPID-$$"

write_external_stores() {
  local root=$1
  MARKER="$marker" ROOT_PATH="$root" python3 - <<'PY'
import json
import os
from pathlib import Path

root = Path(os.environ["ROOT_PATH"])
marker = os.environ["MARKER"]
common = {
    "schema": "qq.models-auth/v1",
    "type": "oauth",
    "expires": 4102444800000,
    "access": marker,
    "refresh": marker + "-refresh",
}
for connector in ("codex", "grok"):
    row = {**common, "connector": connector}
    if connector == "codex":
        row["accountId"] = "synthetic-account"
    path = root / f".qq-{connector}-auth.json"
    with path.open("w") as handle:
        json.dump(row, handle)
    path.chmod(0o600)
PY
}
write_external_stores "$external"
write_external_stores "$xdg/qq"

run_with_hostile_ambient() {
  local test_name=$1 expected_output=$2
  local output="$TEST_TMP/$1.stdout" error="$TEST_TMP/$1.stderr" status
  set +e
  QQ_DSH_HOME="$external" DSH_HOME="$external" XDG_STATE_HOME="$xdg" \
    "$ROOT/tests/$test_name" >"$output" 2>"$error"
  status=$?
  set -e

  if [[ "$status" -ne 0 ]]; then
    printf '%s\n' 'provider test failed under hostile ambient store selection' >&2
    return 1
  fi
  if MARKER="$marker" EXTERNAL_PATH="$external" EXPECTED_OUTPUT="$expected_output" \
      python3 - "$output" "$error" <<'PY'
import os
import sys

needles = (os.environ["MARKER"].encode(), os.environ["EXTERNAL_PATH"].encode())
stdout = open(sys.argv[1], "rb").read()
stderr = open(sys.argv[2], "rb").read()
if any(needle in stream for needle in needles for stream in (stdout, stderr)):
    raise SystemExit(1)
if stdout != os.environ["EXPECTED_OUTPUT"].encode() + b"\n" or stderr:
    raise SystemExit(1)
PY
  then
    :
  else
    printf '%s\n' 'provider test disclosed hostile ambient credential state' >&2
    return 1
  fi
}

run_with_hostile_ambient test-dashboard.sh 'test-dashboard: pass'
run_with_hostile_ambient test-provider-usage.sh 'test-provider-usage: pass'
printf '%s\n' 'test-auth-environment-isolation: pass'
