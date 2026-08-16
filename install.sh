#!/usr/bin/env bash
# Atomically install qq-dashboard from a clean landed repository commit.
set -euo pipefail

fail() {
  printf 'qq-dashboard install: %s\n' "$*" >&2
  exit 1
}

for command_name in git install mktemp realpath; do
  command -v "$command_name" >/dev/null 2>&1 \
    || fail "required command is unavailable: $command_name"
done

script_path=$(realpath -e -- "${BASH_SOURCE[0]}")
source_root=$(dirname -- "$script_path")
repository_root=$(git -C "$source_root" rev-parse --show-toplevel 2>/dev/null) \
  || fail "source is not a Git repository"
repository_root=$(realpath -e -- "$repository_root")
[[ "$repository_root" == "$source_root" ]] \
  || fail "installer must run from the qq-dashboard repository root"
source_commit=$(git -C "$source_root" rev-parse --verify 'HEAD^{commit}' 2>/dev/null) \
  || fail "source has no committed HEAD"
[[ -z $(git -C "$source_root" status --porcelain --untracked-files=all) ]] \
  || fail "source repository is dirty; commit or remove all changes before installing"

if [[ ${QQ_DASHBOARD_INSTALL_ROOT+x} ]]; then
  [[ -n "$QQ_DASHBOARD_INSTALL_ROOT" && "$QQ_DASHBOARD_INSTALL_ROOT" == /* ]] \
    || fail "QQ_DASHBOARD_INSTALL_ROOT must be an absolute path"
  install_root=$QQ_DASHBOARD_INSTALL_ROOT
else
  [[ -n ${HOME:-} && "$HOME" == /* ]] \
    || fail "HOME must be an absolute path"
  install_root=$HOME/.local/lib/qq/dashboard
fi
[[ "$install_root" != *$'\n'* && "$install_root" != *$'\r'* ]] \
  || fail "install root must not contain a newline"
install_root=$(realpath -m -- "$install_root")
[[ "$install_root" != / ]] || fail "refusing to install over the filesystem root"
install_parent=$(dirname -- "$install_root")
install_name=$(basename -- "$install_root")
umask 077
mkdir -p -- "$install_parent"
stage=$(mktemp -d "$install_parent/.${install_name}.install.XXXXXX")
backup=""
restore_needed=0

cleanup() {
  local rc=$?
  trap - EXIT
  if [[ $rc -ne 0 ]]; then
    rm -rf -- "$stage"
    if [[ $restore_needed -eq 1 ]]; then
      rm -rf -- "$install_root"
      if ! command mv -T -- "$backup" "$install_root"; then
        printf 'qq-dashboard install: failed to restore prior artifact from %s\n' "$backup" >&2
      fi
    fi
  fi
  exit "$rc"
}
trap cleanup EXIT

install -D -m 0755 "$source_root/bin/qq-dashboard" "$stage/bin/qq-dashboard"
install -D -m 0755 "$source_root/bin/qq-dashboard-cookies" "$stage/bin/qq-dashboard-cookies"
install -D -m 0644 "$source_root/bin/lib/telemetry-lib.sh" "$stage/bin/lib/telemetry-lib.sh"
install -D -m 0644 /dev/null "$stage/share/qq-dashboard/source-commit"
printf '%s\n' "$source_commit" >"$stage/share/qq-dashboard/source-commit"

[[ -x "$stage/bin/qq-dashboard" \
  && -x "$stage/bin/qq-dashboard-cookies" \
  && -f "$stage/bin/lib/telemetry-lib.sh" \
  && $(<"$stage/share/qq-dashboard/source-commit") == "$source_commit" ]] \
  || fail "staged artifact is incomplete"

if [[ -e "$install_root" || -L "$install_root" ]]; then
  backup=$(mktemp -d "$install_parent/.${install_name}.previous.XXXXXX")
  rmdir -- "$backup"
  command mv -T -- "$install_root" "$backup"
  restore_needed=1
fi
command mv -T -- "$stage" "$install_root"
restore_needed=0
if [[ -n "$backup" ]] && ! rm -rf -- "$backup"; then
  printf 'qq-dashboard install: warning: could not remove prior artifact at %s\n' "$backup" >&2
fi
trap - EXIT
printf 'qq-dashboard installed %s at %s\n' "$source_commit" "$install_root"
