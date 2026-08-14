#!/usr/bin/env bash
# Shared pure helpers for qq telemetry commands.

: "${BAR_CELLS:=16}"
: "${FILL:=█}"
: "${EMPTY:=░}"

fmt_num() {
  local n="${1:-0}" sign="" out=""
  n=${n%%.*}
  if [[ "$n" == -* ]]; then
    sign="-"
    n=${n#-}
  fi
  [[ "$n" =~ ^[0-9]+$ ]] || n=0
  while [ "${#n}" -gt 3 ]; do
    out=",${n: -3}${out}"
    n=${n:0:${#n}-3}
  done
  printf '%s%s%s' "$sign" "$n" "$out"
}

bar() {
  local fraction="${1:-0}" filled empty_count i result=""
  filled=$(awk -v f="$fraction" -v n="$BAR_CELLS" '
    BEGIN {
      if (f !~ /^[-+]?[0-9]*\.?[0-9]+$/) f=0
      if (f<0) f=0
      if (f>1) f=1
      printf "%d", f*n+0.5
    }')
  empty_count=$((BAR_CELLS - filled))
  for ((i=0; i<filled; i++)); do result+="$FILL"; done
  for ((i=0; i<empty_count; i++)); do result+="$EMPTY"; done
  printf '%s' "$result"
}

tier_ceiling() {
  local json="${1:-}" spec="${2:-}" window="${3:-weekly}"
  case "$window" in
    weekly|five_hour) ;;
    *) return 1 ;;
  esac
  jq -er --arg spec "$spec" --arg window "$window" \
    '.data.DataV2.data.data[$spec][$window] | numbers | floor' \
    <<<"$json" 2>/dev/null
}

wall_event_matcher() {
  local line="${1:-}"
  jq -e '
    (.message.stopReason == "error") and
    ((.message.errorMessage // "") |
      test("insufficient_quota|quota has been exhausted"; "i"))
  ' >/dev/null 2>&1 <<<"$line"
}
