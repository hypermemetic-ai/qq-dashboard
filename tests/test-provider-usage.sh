#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/qq-provider-usage-test.XXXXXX")"
cleanup_test() { rm -rf -- "$TEST_TMP"; }
trap cleanup_test EXIT
chmod 700 "$TEST_TMP"
HOME="$TEST_TMP/home"
mkdir -m 700 "$HOME"
export HOME
# shellcheck source=bin/qq-dashboard
source "$ROOT/bin/qq-dashboard"
# Replace the producer cleanup trap: TEST_TMP contains its private temp dir.
trap cleanup_test EXIT
HEADLESS=1

store_file() {
  local root=$1 connector=$2 access=$3 account=${4:-}
  mkdir -p -- "$root"
  jq -cn --arg connector "$connector" --arg access "$access" --arg account "$account" '
    {schema:"qq.models-auth/v1", type:"oauth", connector:$connector,
     access:$access, refresh:"synthetic-refresh", expires:4102444800000}
    + if $account == "" then {} else {accountId:$account} end
  ' >"$root/.qq-$connector-auth.json"
  chmod 600 "$root/.qq-$connector-auth.json"
}

pi_file() {
  mkdir -p -- "$(dirname -- "$AUTH_FILE")"
  jq -cn '{
    "openai-codex": {access:"pi-codex", refresh:"synthetic-refresh",
      expires:4102444800000, accountId:"pi-account"},
    "xai-auth": {access:"pi-grok", refresh:"synthetic-refresh", expires:4102444800000}
  }' >"$AUTH_FILE"
  chmod 600 "$AUTH_FILE"
}

status_of() {
  local connector=$1 status
  if models_auth_from_store "$connector"; then status=0; else status=$?; fi
  printf '%s' "$status"
}

# qq-models path precedence and whitespace trimming.
qq_home="$TEST_TMP/qq-home"
dsh_home="$TEST_TMP/dsh-home"
xdg_root="$TEST_TMP/xdg-state"
default_home="$HOME/.local/state/qq"
store_file "$qq_home" grok qq-choice
store_file "$dsh_home" grok dsh-choice
store_file "$xdg_root/qq" grok xdg-choice
store_file "$default_home" grok default-choice
QQ_DSH_HOME="  $qq_home  " DSH_HOME="$dsh_home" XDG_STATE_HOME="$xdg_root" models_auth_from_store grok
[[ "$AUTH_ACCESS" == qq-choice ]]
unset QQ_DSH_HOME
DSH_HOME="$dsh_home" XDG_STATE_HOME="$xdg_root" models_auth_from_store grok
[[ "$AUTH_ACCESS" == dsh-choice ]]
unset DSH_HOME
XDG_STATE_HOME="$xdg_root" models_auth_from_store grok
[[ "$AUTH_ACCESS" == xdg-choice ]]
unset XDG_STATE_HOME
models_auth_from_store grok
[[ "$AUTH_ACCESS" == default-choice ]]

# A configured higher-priority path is authoritative. Unsafe, malformed, or
# absent selected dedicated state never searches a lower-priority dedicated
# store; only genuine absence is eligible for the validated Pi fallback.
pi_file
unsafe_high="$TEST_TMP/unsafe-high"
store_file "$unsafe_high" grok unsafe-choice
chmod 644 "$unsafe_high/.qq-grok-auth.json"
QQ_DSH_HOME="$unsafe_high" DSH_HOME="$dsh_home"
[[ "$(status_of grok)" == 2 ]]
if provider_credentials grok; then exit 1; else [[ $? == 2 ]]; fi
QQ_DSH_HOME=relative-path
[[ "$(status_of grok)" == 2 ]]
QQ_DSH_HOME="$TEST_TMP/control"$'\t'path
[[ "$(status_of grok)" == 2 ]]
QQ_DSH_HOME="$TEST_TMP/noncanonical/../selected"
[[ "$(status_of grok)" == 2 ]]
QQ_DSH_HOME="$TEST_TMP/missing-selected" DSH_HOME="$dsh_home"
provider_credentials grok
[[ "$AUTH_ACCESS" == pi-grok ]]
provider_credentials codex
[[ "$AUTH_ACCESS" == pi-codex && "$AUTH_ACCOUNT" == pi-account ]]
chmod 644 "$AUTH_FILE"
if provider_credentials codex; then exit 1; else [[ $? == 2 ]]; fi
chmod 600 "$AUTH_FILE"
unset QQ_DSH_HOME DSH_HOME

# Dedicated Codex account-id forms: explicit field and the same JWT claim
# qq-models accepts. The synthetic JWT contains no credential material.
codex_home="$TEST_TMP/codex-home"
store_file "$codex_home" codex codex-choice explicit-account
QQ_DSH_HOME="$codex_home" models_auth_from_store codex
[[ "$AUTH_ACCESS" == codex-choice && "$AUTH_ACCOUNT" == explicit-account ]]
printf '%s\n' '{malformed' >"$codex_home/.qq-codex-auth.json"
chmod 600 "$codex_home/.qq-codex-auth.json"
if QQ_DSH_HOME="$codex_home" provider_credentials codex; then exit 1; else [[ $? == 2 ]]; fi
payload=$(printf '%s' '{"https://api.openai.com/auth":{"chatgpt_account_id":"jwt-account"}}' \
  | base64 -w0 | tr '+/' '-_' | tr -d '=')
store_file "$codex_home" codex "x.$payload.x"
QQ_DSH_HOME="$codex_home" models_auth_from_store codex
[[ "$AUTH_ACCOUNT" == jwt-account ]]
unset QQ_DSH_HOME

# Final-file and parent symlinks, non-regular files, permissive modes, wrong
# schema/connector, expired values, and malformed JSON all fail closed.
security_home="$TEST_TMP/security-home"
store_file "$security_home" grok secure-choice
QQ_DSH_HOME="$security_home"
cp "$security_home/.qq-grok-auth.json" "$TEST_TMP/store-copy"
rm "$security_home/.qq-grok-auth.json"
ln -s "$TEST_TMP/store-copy" "$security_home/.qq-grok-auth.json"
[[ "$(status_of grok)" == 2 ]]
rm "$security_home/.qq-grok-auth.json"
mkdir "$security_home/.qq-grok-auth.json"
[[ "$(status_of grok)" == 2 ]]
rmdir "$security_home/.qq-grok-auth.json"
store_file "$security_home" grok secure-choice
chmod 640 "$security_home/.qq-grok-auth.json"
[[ "$(status_of grok)" == 2 ]]
chmod 600 "$security_home/.qq-grok-auth.json"
printf '%s\n' '{malformed' >"$security_home/.qq-grok-auth.json"
[[ "$(status_of grok)" == 2 ]]
for mutation in wrong-schema wrong-connector expired injected; do
  case "$mutation" in
    wrong-schema) jq -cn '{schema:"other",type:"oauth",connector:"grok",access:"x",refresh:"r",expires:4102444800000}' ;;
    wrong-connector) jq -cn '{schema:"qq.models-auth/v1",type:"oauth",connector:"codex",access:"x",refresh:"r",expires:4102444800000}' ;;
    expired) jq -cn '{schema:"qq.models-auth/v1",type:"oauth",connector:"grok",access:"x",refresh:"r",expires:1}' ;;
    injected) jq -cn '{schema:"qq.models-auth/v1",type:"oauth",connector:"grok",access:"bad\nvalue",refresh:"r",expires:4102444800000}' ;;
  esac >"$security_home/.qq-grok-auth.json"
  chmod 600 "$security_home/.qq-grok-auth.json"
  [[ "$(status_of grok)" == 2 ]]
done
parent_target="$TEST_TMP/parent-target"
mkdir "$parent_target"
parent_link="$TEST_TMP/parent-link"
ln -s "$parent_target" "$parent_link"
QQ_DSH_HOME="$parent_link"
[[ "$(status_of grok)" == 2 ]]
unset QQ_DSH_HOME

normalize() {
  local provider=$1 json=$2
  printf '%s\n' "$json" >"$TEST_TMP/response.json"
  normalize_provider_response "$provider" "$TEST_TMP/response.json"
}
reject_response() {
  local provider=$1 json=$2
  if normalize "$provider" "$json" >/dev/null 2>&1; then return 1; fi
}

# Current documented fields plus reasonable snake/camel, number/string, and
# seconds/milliseconds/RFC3339 representations normalize to one contract.
[[ "$(normalize codex '{"rate_limit":{"primary_window":{"used_percent":25,"reset_at":2000000000}}}')" == $'25\t2000000000000' ]]
[[ "$(normalize codex '{"rateLimit":{"primaryWindow":{"usedPercent":"25.5","resetAt":"2000000000000"}}}')" == $'25.5\t2000000000000' ]]
[[ "$(normalize codex '{"rate_limit":{"primaryWindow":{"usedPercent":1e2,"resetAt":"2033-05-18T03:33:20Z"}}}')" == $'1E+2\t2000000000000' ]]
[[ "$(normalize grok '{"config":{"creditUsagePercent":"30.25","currentPeriod":{"end":"2033-05-18T04:33:20+01:00"}}}')" == $'30.25\t2000000000000' ]]
[[ "$(normalize grok '{"config":{"credit_usage_percent":30,"billing_period_end":2000000000}}')" == $'30\t2000000000000' ]]
[[ "$(normalize grok '{"config":{"creditUsagePercent":30,"billingPeriodEnd":"2033-05-18T03:33:20.123Z"}}')" == $'30\t2000000000123' ]]
[[ "$(normalize grok '{"config":{"creditUsagePercent":0}}')" == $'0\t' ]]
# Identical duplicate variants are accepted; conflicting ones are ambiguous.
[[ "$(normalize grok '{"config":{"creditUsagePercent":30,"credit_usage_percent":"30","billingPeriodEnd":"2000000000","billing_period_end":2000000000}}')" == $'30\t2000000000000' ]]
reject_response grok '{"config":{"creditUsagePercent":30,"credit_usage_percent":31}}'
reject_response codex '{"rate_limit":{"primary_window":{"used_percent":-1,"reset_at":2000000000}}}'
reject_response codex '{"rate_limit":{"primary_window":{"used_percent":101,"reset_at":2000000000}}}'
reject_response codex '{"rate_limit":{"primary_window":{"used_percent":1e999,"reset_at":2000000000}}}'
reject_response codex '{"rate_limit":{"primary_window":{"used_percent":"NaN","reset_at":2000000000}}}'
reject_response codex '{"rate_limit":{"primary_window":{"used_percent":25,"reset_at":100000000000}}}'
reject_response codex '{"rate_limit":{"primary_window":{"used_percent":25,"reset_at":-1}}}'
reject_response codex '{"rate_limit":{"primary_window":{"used_percent":25,"reset_at":2000000000.5}}}'
reject_response grok '{"config":{"creditUsagePercent":"private junk","billingPeriodEnd":"2033-05-18"}}'
reject_response grok '{malformed'

# Status-aware bounded request behavior: retry network/transient responses,
# stop after two attempts, and never retry permanent authentication failures.
fake_bin="$TEST_TMP/fake-bin"
mkdir -m 700 "$fake_bin"
cat >"$fake_bin/curl" <<'CURL'
#!/usr/bin/env bash
set -euo pipefail
output=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) output=$2; shift 2 ;;
    -w) shift 2 ;;
    --connect-timeout|-m|-H) shift 2 ;;
    https://*) shift ;;
    *) shift ;;
  esac
done
count=0
[[ ! -f "$REQUEST_COUNT" ]] || count=$(cat "$REQUEST_COUNT")
count=$((count + 1))
printf '%s\n' "$count" >"$REQUEST_COUNT"
result=$(sed -n "${count}p" "$REQUEST_PLAN")
case "$result" in
  network) exit 28 ;;
  2*) printf '%s\n' '{"ok":true}' >"$output" ;;
esac
printf '%s' "$result"
CURL
chmod 700 "$fake_bin/curl"
request_case() {
  local plan=$1 expected_status=$2 expected_count=$3
  printf '%s\n' "$plan" | tr ' ' '\n' >"$TEST_TMP/request-plan"
  rm -f -- "$TEST_TMP/request-count" "$TEST_TMP/request-output"
  if PATH="$fake_bin:$PATH" REQUEST_PLAN="$TEST_TMP/request-plan" REQUEST_COUNT="$TEST_TMP/request-count" \
      provider_api_get "$TEST_TMP/request-output" https://provider.invalid; then
    status=0
  else
    status=$?
  fi
  [[ "$status" == "$expected_status" && "$(cat "$TEST_TMP/request-count")" == "$expected_count" ]]
}
request_case '503 200' 0 2
request_case 'network 200' 0 2
request_case '401 200' 1 1
request_case '400 200' 1 1
request_case '503 503 200' 1 2

# End-to-end cycle seam: one provider and Qwen can succeed while the other
# fails; last-good rows retain original observation time and expire by age/reset.
cycle_home="$TEST_TMP/cycle-home"
store_file "$cycle_home" codex cycle-codex cycle-account
store_file "$cycle_home" grok cycle-grok
cp "$cycle_home/.qq-codex-auth.json" "$TEST_TMP/codex-before"
cp "$cycle_home/.qq-grok-auth.json" "$TEST_TMP/grok-before"
QQ_DSH_HOME="$cycle_home"
USAGE_CACHE="$TEST_TMP/cycle-cache.json"
FAKE_NOW=1900000000
now_epoch() { printf '%s' "$FAKE_NOW"; }
cat >"$TEST_TMP/cycle-codex.json" <<'JSON'
{"rate_limit":{"primary_window":{"used_percent":20,"reset_at":2000000000}},"ignoredMarker":"body-marker"}
JSON
cat >"$TEST_TMP/cycle-grok.json" <<'JSON'
{"config":{"creditUsagePercent":40,"billingPeriodEnd":2000000000000},"ignoredMarker":"body-marker"}
JSON
REQUEST_MODE=codex
provider_api_get() {
  local output=$1 url=$2
  case "$REQUEST_MODE:$url" in
    codex:*chatgpt*|both:*chatgpt*) cp "$TEST_TMP/cycle-codex.json" "$output" ;;
    grok:*grok.com*|both:*grok.com*) cp "$TEST_TMP/cycle-grok.json" "$output" ;;
    *) return 1 ;;
  esac
  chmod 600 "$output"
}
qwen_update() {
  QWEN_USAGE_STATE=ready; QWEN_USAGE_OBSERVED_AT=$USAGE_GENERATED_AT
  QWEN_WEEKLY_RATIO=.5; QWEN_WEEKLY_RESET_AT=2000000000000
  QWEN_WEEKLY_DETAIL='1 / 2'; QWEN_FIVE_RATIO=''; QWEN_FIVE_RESET_AT=''; QWEN_FIVE_DETAIL=''
  QWEN_L1='7d       live'; QWEN_L2=''
}
fetch_all
first_observed=$CODEX_USAGE_OBSERVED_AT
[[ "$CODEX_USAGE_STATE:$GROK_USAGE_STATE:$QWEN_USAGE_STATE" == ready:unavailable:ready ]]
persist_usage_cache
FAKE_NOW=$((FAKE_NOW + 30)); REQUEST_MODE=fail
fetch_all
[[ "$CODEX_USAGE_STATE" == stale && "$CODEX_USAGE_OBSERVED_AT" == "$first_observed" ]]
[[ "$GROK_USAGE_STATE:$QWEN_USAGE_STATE" == unavailable:ready ]]
persist_usage_cache
FAKE_NOW=$((FAKE_NOW + 30)); REQUEST_MODE=grok
fetch_all
[[ "$CODEX_USAGE_STATE:$GROK_USAGE_STATE:$QWEN_USAGE_STATE" == stale:ready:ready ]]
[[ "$CODEX_USAGE_OBSERVED_AT" == "$first_observed" ]]
persist_usage_cache
FAKE_NOW=$((first_observed / 1000 + PROVIDER_STALE_MAX_SECS)); REQUEST_MODE=fail
fetch_all
[[ "$CODEX_USAGE_STATE" == unavailable && "$GROK_USAGE_STATE" == stale && "$QWEN_USAGE_STATE" == ready ]]

# A reset bound expires last-good sooner than the age horizon.
rm -f -- "$USAGE_CACHE"
FAKE_NOW=1900000000
printf '%s\n' '{"rate_limit":{"primary_window":{"used_percent":20,"reset_at":1900000060}}}' >"$TEST_TMP/cycle-codex.json"
REQUEST_MODE=codex
fetch_all
persist_usage_cache
FAKE_NOW=1900000060; REQUEST_MODE=fail
fetch_all
[[ "$CODEX_USAGE_STATE" == unavailable ]]

cmp "$TEST_TMP/codex-before" "$cycle_home/.qq-codex-auth.json"
cmp "$TEST_TMP/grok-before" "$cycle_home/.qq-grok-auth.json"
[[ "$(stat -c %a "$USAGE_CACHE")" == 600 ]]
if grep -Eq 'cycle-codex|cycle-grok|cycle-account|synthetic-refresh|body-marker' "$USAGE_CACHE"; then exit 1; fi
if grep -Fq "$TEST_TMP" "$USAGE_CACHE"; then exit 1; fi

echo 'test-provider-usage: pass'
