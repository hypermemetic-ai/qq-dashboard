#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/qq-dashboard-test.XXXXXX")"
cleanup() { rm -rf -- "$TMP"; }
trap cleanup EXIT
chmod 700 "$TMP"
mkdir -p "$TMP/home" "$TMP/fake-bin"
chmod 700 "$TMP/home" "$TMP/fake-bin"
cat >"$TMP/profile-list.json" <<'JSON'
{
  "schema": "qq.profile-list/v1",
  "roles": [
    {
      "name": "runner",
      "default": "grok-high",
      "profiles": [
        {"name":"qwen-deepseek-max","provider":"qwen-token-plan","model":"deepseek-v4-flash-0731","effort":"max"},
        {"name":"sol-high","provider":"openai-codex","model":"gpt-5.6-sol","effort":"high"},
        {"name":"grok-high","provider":"xai","model":"grok-4.6","effort":"high"}
      ]
    },
    {
      "name": "architect",
      "default": "grok-high",
      "profiles": [
        {"name":"sol-max","provider":"openai-codex","model":"gpt-5.6-sol","effort":"max"},
        {"name":"grok-high","provider":"xai","model":"grok-4.6","effort":"high"},
        {"name":"grok-xhigh","provider":"xai","model":"grok-4.6","effort":"xhigh"}
      ]
    }
  ],
  "services": [
    {"name":"scribe","provider":"xai","model":"grok-4.6","effort":"high"},
    {"name":"qa","provider":"openai-codex","model":"gpt-5.6-sol","effort":"xhigh"}
  ]
}
JSON
cat >"$TMP/fake-bin/qq-profile" <<'SH'
#!/usr/bin/env bash
[[ "$*" == "list --json" ]] || exit 64
cat -- "$QQ_PROFILE_FIXTURE"
SH
chmod 700 "$TMP/fake-bin/qq-profile"

output=$(HOME="$TMP/home" QQ_PROFILE_BIN="$TMP/fake-bin/qq-profile" QQ_PROFILE_FIXTURE="$TMP/profile-list.json" \
  bash -c 'source "$1"; load_roles; printf "%s\n" "$ROLES_BODY"' _ "$ROOT/bin/qq-dashboard")
[[ "$output" == *'runner'* ]]
[[ "$output" == *'deepseek-v4-flash-0731'*'max'* ]]
[[ "$output" == *'gpt-5.6-sol'*'high'* ]]
[[ "$output" == *'grok-4.6'*'high'* ]]
[[ "$output" == *'grok-4.6'*'high'*'default'* ]]
[[ "$output" != *'gpt-5.6-luna'* ]]
[[ "$output" != *'qwen-deepseek-max'* ]]
[[ "$output" != *'qwen-token-plan/deepseek-v4-flash-0731'* ]]
plain_roles=$(printf '%s' "$output" | sed 's/\x1b\[[0-9;]*m//g')
[[ "$plain_roles" == *$'architect\n'*'gpt-5.6-sol'*'max'*$'\n'*'grok-4.6'*'high'*'default'*$'\n'*'grok-4.6'*'xhigh'* ]]
[[ "$output" == *'architect'* ]]
[[ "$output" == *'scribe'* ]]
[[ "$output" == *'scribe (service)'* ]]
[[ "$output" == *'qa'* ]]
[[ "$output" == *'qa (service)'* ]]
[[ "$output" == *'gpt-5.6-sol'*'xhigh'* ]]
[[ "$output" != *'cap 200000'* ]]

frame=$(HOME="$TMP/home" QQ_PROFILE_BIN="$TMP/fake-bin/qq-profile" QQ_PROFILE_FIXTURE="$TMP/profile-list.json" \
  bash -c 'source "$1"; load_roles; GPT_WEEK="7d       unavailable"; GROK_WEEK="7d       unavailable"; QWEN_L1="7d       unavailable"; QWEN_L2=""; render_body' _ "$ROOT/bin/qq-dashboard")
[[ "$frame" == *'Codex'* ]]
[[ "$frame" == *'Grok'* ]]
[[ "$frame" == *'Qwen'* ]]
[[ "$frame" != *'no cookie session'* ]]
[[ "$frame" != *'cap 200000'* ]]
plain=$(printf '%s' "$frame" | sed 's/\x1b\[[0-9;]*m//g')
[[ "$plain" == *$'\n\n\n Execution profiles\n'* ]]

fresh_qwen=$(HOME="$TMP/home" \
  bash -c 'source "$1"; QWEN_WALL_TEXT="quota exhausted"; QWEN_WALL_TS=1000000; qwen_render_rows 0.25 2000000000000 "" "" 100 0 0 "" 2000; printf "%s\n" "$QWEN_L1"' _ "$ROOT/bin/qq-dashboard")
[[ "$fresh_qwen" != *'EXHAUSTED'* ]]
stale_qwen=$(HOME="$TMP/home" \
  bash -c 'source "$1"; QWEN_WALL_TEXT="quota exhausted"; QWEN_WALL_TS=1000000; qwen_render_rows 0.25 2000000000000 "" "" 100 0 1 "5m ago" 2000; printf "%s\n" "$QWEN_L1"' _ "$ROOT/bin/qq-dashboard")
[[ "$stale_qwen" != *'EXHAUSTED'* ]]
new_wall_qwen=$(HOME="$TMP/home" \
  bash -c 'source "$1"; QWEN_WALL_TEXT="quota exhausted"; QWEN_WALL_TS=3000000; qwen_render_rows 0.25 2000000000000 "" "" 100 0 0 "" 2000; printf "%s\n" "$QWEN_L1"' _ "$ROOT/bin/qq-dashboard")
[[ "$new_wall_qwen" == *'EXHAUSTED'* ]]
full_qwen=$(HOME="$TMP/home" \
  bash -c 'source "$1"; QWEN_WALL_TEXT=""; qwen_render_rows 1 2000000000000 "" "" 100 0 0; printf "%s\n" "$QWEN_L1"' _ "$ROOT/bin/qq-dashboard")
[[ "$full_qwen" == *'EXHAUSTED'* ]]
renewed_qwen=$(HOME="$TMP/home" \
  bash -c 'source "$1"; QWEN_WALL_TEXT="quota exhausted"; QWEN_WALL_TS=1000000; qwen_render_rows 0 "" "" "" 40000 12000 0 "" 2000; printf "%s\n%s\n" "$QWEN_L1" "$QWEN_L2"' _ "$ROOT/bin/qq-dashboard")
renewed_plain=$(printf '%s' "$renewed_qwen" | sed 's/\x1b\[[0-9;]*m//g')
[[ "$renewed_plain" == *'7d'*'0 / 40,000'*'window not started'* ]]
[[ "$renewed_plain" == *'5h'*'0 / 12,000'*'window not started'* ]]
[[ "$renewed_plain" != *'EXHAUSTED'* ]]
renewed_summary=$(HOME="$TMP/home" bash -c 'source "$1"; GATEWAY_SPEC=pro; GATEWAY_WEEKLY=0.0; GATEWAY_RESET=""; GATEWAY_WEEKLY_CEILING=40000; GATEWAY_5H_CEILING=12000; print_gateway_summary' _ "$ROOT/bin/qq-dashboard-cookies")
[[ "$renewed_summary" == *'gateway round-trip: ok'* ]]
[[ "$renewed_summary" == *'weekly reset: window not started'* ]]

mkdir -p "$TMP/home/.pi/agent" "$TMP/fake-bin"
cat >"$TMP/home/.pi/agent/auth.json" <<'JSON'
{"xai":{"type":"oauth","access":"stale","refresh":"refresh","expires":1}}
JSON
cat >"$TMP/fake-bin/pi" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$PI_LOG"
SH
chmod 700 "$TMP/fake-bin/pi"
PI_LOG="$TMP/pi.log" PATH="$TMP/fake-bin:$PATH" HOME="$TMP/home" \
  bash -c 'source "$1"; refresh_xai_auth' _ "$ROOT/bin/qq-dashboard"
[[ "$(cat "$TMP/pi.log")" == 'auth check --provider xai' ]]

signal_tmp="$TMP/signal-cleanup"
mkdir "$signal_tmp"
set +e
HOME="$TMP/home" \
  bash -c 'source "$1"; rm -rf -- "$TELEMETRY_TMP"; TELEMETRY_TMP="$2"; kill -TERM $$; sleep 1' \
  _ "$ROOT/bin/qq-dashboard" "$signal_tmp"
signal_status=$?
set -e
[[ "$signal_status" -eq 143 ]]
[[ ! -e "$signal_tmp" ]]

cat >"$TMP/fake-bin/profile-fail" <<'SH'
#!/usr/bin/env bash
exit 42
SH
cat >"$TMP/fake-bin/profile-malformed" <<'SH'
#!/usr/bin/env bash
printf 'not json\n'
SH
chmod 700 "$TMP/fake-bin/profile-fail" "$TMP/fake-bin/profile-malformed"
mkdir -p "$TMP/provider-home/.pi/agent"
cat >"$TMP/provider-home/.pi/agent/auth.json" <<'JSON'
{
  "openai-codex": {"access":"codex-access","accountId":"codex-account"},
  "xai-auth": {"access":"grok-access"}
}
JSON
provider_frame=$(HOME="$TMP/provider-home" QQ_PROFILE_BIN="$TMP/fake-bin/profile-fail" \
  bash -c '
    source "$1"
    api_get() {
      if [[ "$1" == *chatgpt* ]]; then
        printf "%s\n" '\''{"rate_limit":{"primary_window":{"used_percent":25,"reset_at":2000000000}}}'\''
      else
        printf "%s\n" '\''{"config":{"creditUsagePercent":30,"currentPeriod":{"end":"2033-05-18T03:33:20Z"}}}'\''
      fi
    }
    qwen_update() {
      QWEN_L1="7d       live"; QWEN_L2=""
      QWEN_USAGE_STATE=ready; QWEN_USAGE_OBSERVED_AT=1900000000000
      QWEN_WEEKLY_RATIO=.5; QWEN_WEEKLY_RESET_AT=2000000000000
      QWEN_WEEKLY_DETAIL="20000 / 40000"
      QWEN_FIVE_RATIO=""; QWEN_FIVE_RESET_AT=""; QWEN_FIVE_DETAIL=""
    }
    fetch_all
    persist_usage_cache
    render_body
  ' _ "$ROOT/bin/qq-dashboard" 2>"$TMP/profile-fail.err")
provider_plain=$(printf '%s' "$provider_frame" | sed 's/\x1b\[[0-9;]*m//g')
[[ "$provider_plain" == *'Codex'*'25%'* ]]
[[ "$provider_plain" == *'Grok'*'30%'* ]]
[[ "$provider_plain" == *'Qwen'*'live'* ]]
[[ "$provider_plain" == *'Execution profiles'*'unavailable'* ]]
[[ "$(cat "$TMP/profile-fail.err")" == 'qq-dashboard: execution profiles unavailable from qq-profile' ]]
usage_cache="$TMP/provider-home/.local/state/qq/telemetry/usage-cache.json"
jq -e '
  .schema == "qq.dashboard-usage/v1" and
  (.generatedAt | type == "number") and
  ([.providers[].id] == ["codex", "grok", "qwen"]) and
  (.providers[0].state == "ready" and .providers[0].meters[0].usedRatio == 0.25 and
    .providers[0].meters[0].resetAt == 2000000000000) and
  (.providers[1].state == "ready" and .providers[1].meters[0].usedRatio == 0.3 and
    .providers[1].meters[0].resetAt == 2000000000000) and
  (.providers[2].state == "ready" and .providers[2].meters[0].usedRatio == 0.5)
' "$usage_cache" >/dev/null
[[ "$(stat -c %a "$usage_cache")" == 600 ]]
! grep -Eq 'codex-access|codex-account|grok-access|runner|profile' "$usage_cache"
! grep -q $'\033' "$usage_cache"

structured_qwen=$(HOME="$TMP/home" bash -c '
  source "$1"
  qwen_render_rows 0.25 2000000000000 0.5 1999990000000 40000 12000 1 "5m ago" 1900000000 stale
  printf "%s\n" "$QWEN_USAGE_STATE|$QWEN_USAGE_OBSERVED_AT|$QWEN_WEEKLY_RATIO|$QWEN_WEEKLY_RESET_AT|$QWEN_FIVE_RATIO"
' _ "$ROOT/bin/qq-dashboard")
[[ "$structured_qwen" == 'stale|1900000000000|0.25|2000000000000|0.5' ]]

estimated_qwen=$(HOME="$TMP/home" bash -c '
  source "$1"
  QWEN_MTR_CADENCE=0
  qwen_gateway_state_load() {
    QWEN_RATE=.01; QWEN_ANCHOR_TS=800; QWEN_ANCHOR_TOKENS=100
    QWEN_ANCHOR_CREDITS=10; QWEN_ANCHOR_RESET=2000000000000
    QWEN_PERSISTED_TS=900; QWEN_PERSISTED_P1W=.25; QWEN_PERSISTED_P1WR=2000000000000
    QWEN_PERSISTED_P5=.1; QWEN_PERSISTED_P5R=1999990000000
    QWEN_PERSISTED_CEILW=40; QWEN_PERSISTED_CEIL5=20
  }
  qwen_meter() {
    QWEN_MTR_T7=200; QWEN_MTR_T5=50; QWEN_METER_AVAILABLE=1; QWEN_METER_INIT=1
  }
  qwen_cookie_args() { return 1; }
  qwen_update 1000
  printf "%s\n" "$QWEN_USAGE_STATE|$QWEN_USAGE_OBSERVED_AT|$QWEN_WEEKLY_RATIO|$QWEN_WEEKLY_RESET_AT|$QWEN_WEEKLY_DETAIL"
' _ "$ROOT/bin/qq-dashboard")
[[ "$estimated_qwen" == 'estimated|900000|0.275|2000000000000|11 / 40 estimated' ]]

preserved=$(HOME="$TMP/home" bash -c '
  source "$1"
  mkdir -p -- "$(dirname -- "$USAGE_CACHE")"
  printf "prior\n" >"$USAGE_CACHE"
  jq() { return 1; }
  persist_usage_cache || true
  cat -- "$USAGE_CACHE"
' _ "$ROOT/bin/qq-dashboard")
[[ "$preserved" == prior ]]

malformed_frame=$(HOME="$TMP/provider-home" QQ_PROFILE_BIN="$TMP/fake-bin/profile-malformed" \
  "$ROOT/bin/qq-dashboard" --once 2>"$TMP/profile-malformed.err")
malformed_plain=$(printf '%s' "$malformed_frame" | sed 's/\x1b\[[0-9;]*m//g')
[[ "$malformed_plain" == *'Codex'* ]]
[[ "$malformed_plain" == *'Grok'* ]]
[[ "$malformed_plain" == *'Qwen'* ]]
[[ "$malformed_plain" == *'Execution profiles'*'unavailable'* ]]
jq -e '
  .schema == "qq.dashboard-usage/v1" and
  ([.providers[].id] == ["codex", "grok", "qwen"]) and
  ([.providers[].state] | all(. == "unavailable")) and
  ([.providers[].observedAt] | all(. == null)) and
  ([.providers[].meters] | all(length == 0))
' "$usage_cache" >/dev/null
! grep -Eq 'codex-access|codex-account|grok-access' "$usage_cache"

echo 'test-dashboard: pass'
