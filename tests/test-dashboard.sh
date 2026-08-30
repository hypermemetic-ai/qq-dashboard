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

# The dedicated qq-models credential reader accepts only the fixed, safe store.
# Status 1 is an absent store (eligible for the legacy fallback); every unsafe
# or malformed store is status 2 and emits no credential diagnostic.
store_probe_err="$TMP/store-probe.err"
probe_grok_store() {
  local home=$1 expected=$2 actual
  actual=$(HOME="$home" bash -c '
    source "$1"
    token=""
    if token=$(grok_access_from_store); then status=0; else status=$?; fi
    printf "%s|%s" "$status" "$token"
  ' _ "$ROOT/bin/qq-dashboard" 2>>"$store_probe_err")
  if [[ "$actual" != "$expected" ]]; then
    printf 'unexpected Grok store probe for %s: %q != %q\n' "$home" "$actual" "$expected" >&2
    return 1
  fi
}
store_home="$TMP/store-home"
store_path="$store_home/.local/state/qq/.qq-grok-auth.json"
mkdir -p "$store_home/.local/state/qq"
printf '%s\n' '{"access":"store-fixture-token","refresh":"private","expires":999}' >"$store_path"
chmod 600 "$store_path"
probe_grok_store "$store_home" '0|store-fixture-token'
rm "$store_path"
probe_grok_store "$store_home" '1|'
printf '%s\n' '{malformed' >"$store_path"
probe_grok_store "$store_home" '2|'
printf '%s\n' '{"access":42}' >"$store_path"
probe_grok_store "$store_home" '2|'
printf '%s\n' '{"access":""}' >"$store_path"
probe_grok_store "$store_home" '2|'
printf '%s\n' '{"access":"header injection\nvalue"}' >"$store_path"
probe_grok_store "$store_home" '2|'
printf '%s\n' '{"access":"unreadable"}' >"$store_path"
chmod 000 "$store_path"
probe_grok_store "$store_home" '2|'
chmod 600 "$store_path"
rm "$store_path"
mkdir "$store_path"
probe_grok_store "$store_home" '2|'
rmdir "$store_path"
printf '%s\n' '{"access":"symlink-target"}' >"$TMP/store-target.json"
ln -s "$TMP/store-target.json" "$store_path"
probe_grok_store "$store_home" '2|'
unsafe_parent_home="$TMP/unsafe-parent-home"
mkdir "$unsafe_parent_home" "$TMP/external-local"
ln -s "$TMP/external-local" "$unsafe_parent_home/.local"
probe_grok_store "$unsafe_parent_home" '2|'
unsafe_home_target="$TMP/unsafe-home-target"
mkdir "$unsafe_home_target"
ln -s "$unsafe_home_target" "$TMP/unsafe-home-link"
probe_grok_store "$TMP/unsafe-home-link" '2|'
probe_grok_store relative-home '2|'
[[ ! -s "$store_probe_err" ]]

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

# Exercise the actual --once producer with a valid dedicated qq-models store.
# The fake endpoint rejects missing identity headers, a bearer in process args,
# an unsafe header file, or an unexpected credential. It records no secret.
grok_home="$TMP/grok-home"
grok_auth="$grok_home/.local/state/qq/.qq-grok-auth.json"
mkdir -p "$grok_home/.pi/agent" "$(dirname -- "$grok_auth")"
cat >"$grok_home/.pi/agent/auth.json" <<'JSON'
{
  "openai-codex": {"access":"codex-e2e-access","accountId":"codex-e2e-account"},
  "xai-auth": {"access":"legacy-must-not-bypass"}
}
JSON
cat >"$grok_auth" <<'JSON'
{"access":"dedicated-e2e-token","refresh":"private-refresh","expires":1999999999999}
JSON
chmod 600 "$grok_auth"
cp "$grok_auth" "$TMP/grok-auth-before"
cat >"$TMP/fake-bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
url=''
auth_file=''
user_agent=0
identifier=0
version=0
mode=0
for argument in "$@"; do
  [[ "$argument" != *dedicated-e2e-token* ]]
  [[ "$argument" != *legacy-must-not-bypass* ]]
  case "$argument" in
    https://*) url=$argument ;;
    @*) auth_file=${argument#@} ;;
    'User-Agent: @hypermemetic-ai/qq-models/0.0.0 (+https://github.com/hypermemetic-ai/qq)') user_agent=1 ;;
    'x-grok-client-identifier: @hypermemetic-ai/qq-models') identifier=1 ;;
    'x-grok-client-version: 1.0.3') version=1 ;;
    'x-grok-client-mode: headless') mode=1 ;;
  esac
done
case "$url" in
  *chatgpt*)
    printf '%s\n' '{"rate_limit":{"primary_window":{"used_percent":25,"reset_at":2000000000}}}'
    ;;
  *cli-chat-proxy.grok.com*)
    [[ $user_agent = 1 && $identifier = 1 && $version = 1 && $mode = 1 ]]
    [[ -f "$auth_file" && ! -L "$auth_file" && $(stat -c %a "$auth_file") = 600 ]]
    grep -Fxq 'Authorization: Bearer dedicated-e2e-token' "$auth_file"
    printf 'grok-request-ok\n' >>"$GROK_PROBE_LOG"
    printf '%s\n' '{"config":{"creditUsagePercent":37,"currentPeriod":{"end":"2033-05-18T03:33:20Z"}},"privateRaw":"raw-billing-marker"}'
    ;;
  *) exit 44 ;;
esac
SH
chmod 700 "$TMP/fake-bin/curl"
grok_out="$TMP/grok-once.out"
grok_err="$TMP/grok-once.err"
PATH="$TMP/fake-bin:$PATH" GROK_PROBE_LOG="$TMP/grok-request.log" HOME="$grok_home" \
  QQ_PROFILE_BIN="$TMP/fake-bin/profile-fail" "$ROOT/bin/qq-dashboard" --once \
  >"$grok_out" 2>"$grok_err"
cmp "$TMP/grok-auth-before" "$grok_auth"
grok_cache="$grok_home/.local/state/qq/telemetry/usage-cache.json"
grep -Fq '37%' "$grok_out"
if grep -Fq '52%' "$grok_out"; then
  echo 'Grok test encoded the live diagnosis value' >&2
  exit 1
fi
[[ "$(cat "$TMP/grok-request.log")" == grok-request-ok ]]
jq -e '
  .providers[0].state == "ready" and
  .providers[1].state == "ready" and
  .providers[1].meters[0].usedRatio == 0.37 and
  .providers[1].meters[0].resetAt == 2000000000000 and
  .providers[2].state == "unavailable"
' "$grok_cache" >/dev/null
[[ "$(stat -c %a "$grok_cache")" == 600 ]]
if grep -REq 'dedicated-e2e-token|private-refresh|raw-billing-marker|\.qq-grok-auth\.json' \
    "$grok_out" "$grok_err" "$grok_cache" "$TMP/grok-request.log"; then
  echo 'Grok producer leaked credential, payload, or credential path' >&2
  exit 1
fi

# A present but malformed dedicated store fails closed instead of falling back
# to Pi. Codex and Qwen rows still complete normally.
printf '%s\n' '{malformed' >"$grok_auth"
PATH="$TMP/fake-bin:$PATH" GROK_PROBE_LOG="$TMP/grok-request.log" HOME="$grok_home" \
  QQ_PROFILE_BIN="$TMP/fake-bin/profile-fail" "$ROOT/bin/qq-dashboard" --once \
  >"$TMP/grok-rejected.out" 2>"$TMP/grok-rejected.err"
[[ "$(wc -l <"$TMP/grok-request.log")" == 1 ]]
jq -e '
  .providers[0].state == "ready" and
  .providers[1].state == "unavailable" and
  .providers[1].observedAt == null and
  (.providers[1].meters | length) == 0 and
  .providers[2].state == "unavailable"
' "$grok_cache" >/dev/null
if grep -REq 'legacy-must-not-bypass|\.qq-grok-auth\.json' \
    "$TMP/grok-rejected.out" "$TMP/grok-rejected.err" "$grok_cache"; then
  echo 'rejected Grok credential leaked or used legacy fallback' >&2
  exit 1
fi

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


# Headless mode is the plugin-owned, cache-only producer. It must run repeated
# cycles without loading profiles or writing/rendering a terminal frame, and
# its piped stdout protocol is one exact non-secret signal per successful write.
headless_home="$TMP/headless-home"
headless_tmp="$TMP/headless-tmp"
mkdir -m 700 "$headless_home" "$headless_tmp"
cat >"$TMP/fake-bin/profile-spy" <<'SH'
#!/usr/bin/env bash
printf 'profile invoked: %s\n' "$*" >>"$QQ_PROFILE_SPY_LOG"
printf 'headless-profile-secret\n'
SH
chmod 700 "$TMP/fake-bin/profile-spy"
headless_out="$TMP/headless.out"
headless_err="$TMP/headless.err"
HOME="$headless_home" TMPDIR="$headless_tmp" TELEMETRY_REFRESH=1 \
  QQ_PROFILE_BIN="$TMP/fake-bin/profile-spy" QQ_PROFILE_SPY_LOG="$TMP/profile-spy.log" \
  "$ROOT/bin/qq-dashboard" --headless >"$headless_out" 2>"$headless_err" &
headless_pid=$!
for _ in $(seq 1 80); do
  [[ $(wc -l <"$headless_out") -ge 2 ]] && break
  kill -0 "$headless_pid" 2>/dev/null || break
  sleep 0.05
done
if kill -0 "$headless_pid" 2>/dev/null; then kill -TERM "$headless_pid"; fi
set +e
wait "$headless_pid"
headless_status=$?
set -e
[[ "$headless_status" -eq 143 ]]
[[ $(wc -l <"$headless_out") -ge 2 ]]
if grep -vxF 'qq-dashboard:usage-cache-updated' "$headless_out" >/dev/null; then
  echo 'headless producer emitted a non-protocol stdout line' >&2
  exit 1
fi
[[ ! -s "$headless_err" ]]
[[ ! -e "$TMP/profile-spy.log" ]]
[[ ! -e "$headless_home/.local/state/qq/telemetry/last-frame.txt" ]]
! grep -Eq 'headless-profile-secret|\x1b|QQ DASHBOARD|Execution profiles' "$headless_out"
headless_cache="$headless_home/.local/state/qq/telemetry/usage-cache.json"
[[ "$(stat -c %a "$headless_cache")" == 600 ]]
jq -e '
  .schema == "qq.dashboard-usage/v1" and
  ([.providers[].id] == ["codex", "grok", "qwen"]) and
  ([.providers[].state] | all(. == "unavailable")) and
  ([.providers[].observedAt] | all(. == null)) and
  ([.providers[].meters] | all(length == 0))
' "$headless_cache" >/dev/null
[[ -z $(find "$headless_tmp" -maxdepth 1 -name 'qq-dashboard.*' -print -quit) ]]

# Instrument a faster cache-only loop to prove that a slow fetch always ends
# before the next starts; timer pressure cannot overlap provider requests.
overlap_home="$TMP/headless-overlap-home"
mkdir -m 700 "$overlap_home"
HOME="$overlap_home" HEADLESS_LOG="$TMP/headless-overlap.log" \
  bash -c '
    source "$1"
    REFRESH_SECS=.01
    fetch_all() {
      if [ -e "$HEADLESS_LOG.lock" ]; then printf "overlap\n" >>"$HEADLESS_LOG"; fi
      : >"$HEADLESS_LOG.lock"
      printf "start\n" >>"$HEADLESS_LOG"
      sleep .08
      printf "end\n" >>"$HEADLESS_LOG"
      rm -f -- "$HEADLESS_LOG.lock"
    }
    persist_usage_cache() { return 0; }
    qq_dashboard_main --headless
  ' _ "$ROOT/bin/qq-dashboard" >"$TMP/headless-overlap.out" 2>"$TMP/headless-overlap.err" &
overlap_pid=$!
for _ in $(seq 1 80); do
  [[ $(wc -l <"$TMP/headless-overlap.out") -ge 3 ]] && break
  kill -0 "$overlap_pid" 2>/dev/null || break
  sleep .02
done
if kill -0 "$overlap_pid" 2>/dev/null; then kill -TERM "$overlap_pid"; fi
set +e
wait "$overlap_pid"
overlap_status=$?
set -e
[[ "$overlap_status" -eq 143 ]]
[[ $(wc -l <"$TMP/headless-overlap.out") -ge 3 ]]
! grep -q '^overlap$' "$TMP/headless-overlap.log"
awk '
  NR % 2 == 1 && $0 != "start" { exit 1 }
  NR % 2 == 0 && $0 != "end" { exit 1 }
  END { if (NR < 6) exit 1 }
' "$TMP/headless-overlap.log"
[[ ! -e "$TMP/headless-overlap.log.lock" ]]

echo 'test-dashboard: pass'
