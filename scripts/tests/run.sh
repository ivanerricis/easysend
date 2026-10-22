#!/usr/bin/env bash
# Tests for the one-click update scripts (update-runner.sh, update-service.sh, status helpers).
# Pure bash, no dependencies: bash scripts/tests/run.sh
# The runner is pointed at a stub instead of deploy.sh through EASYSEND_DEPLOY_CMD; FAKE_RC is the
# stub's exit code and FAKE_STEPS the update_step calls it makes.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$HERE/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

E="$TMP/easysend"
PASS=0 FAIL=0 SKIP=0
ID=0123456789abcdef0123456789abcdef

pass() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }
skip() { SKIP=$((SKIP + 1)); printf '  SKIP %s\n' "$1"; }
# check DESCRIPTION EXPECTED ACTUAL
check() {
  if [[ "$2" == "$3" ]]; then pass "$1"; else fail "$1 (expected '$2', got '$3')"; fi
}

cat >"$TMP/stub-deploy.sh" <<'STUB'
#!/usr/bin/env bash
source "$EASYSEND_DIR/scripts/lib/common.sh"
for s in ${FAKE_STEPS:-compose backup pull}; do update_step "$s"; done
cp "$EASYSEND_UPDATE_STATUS" "$EASYSEND_DIR/mid.json" 2>/dev/null
echo "stub args: $*"
exit "${FAKE_RC:-0}"
STUB
chmod +x "$TMP/stub-deploy.sh"

reset() {
  rm -rf "$E"
  mkdir -p "$E/scripts/lib" "$E/updates"
  cp "$SRC/lib/common.sh" "$E/scripts/lib/"
  cp "$SRC/update-runner.sh" "$SRC/update-service.sh" "$E/scripts/"
  printf 'APP_VERSION=0.1.0\n' >"$E/.env"
  unset FAKE_RC FAKE_STEPS
}
req() { printf '%b' "$1" >"$E/updates/request"; }
good_req() { req "id=$ID\nversion=${1:-0.2.0}\nrequestedAt=1700000000\n"; }
run_runner() { EASYSEND_DIR="$E" EASYSEND_DEPLOY_CMD="$TMP/stub-deploy.sh" bash "$E/scripts/update-runner.sh" >"$TMP/runner.out" 2>&1; }
jget() { grep -o "\"$1\":[^,}]*" "$E/updates/status.json" | head -n 1 | cut -d: -f2- | tr -d '"'; }
# expect DESCRIPTION STATE ERROR(or null) [STEP]
expect() {
  check "$1: state" "$2" "$(jget state)"
  check "$1: error" "$3" "$(jget error)"
  check "$1: step" "${4:-done}" "$(jget step)"
  if [[ -e "$E/updates/request" || -e "$E/.deploy/update-request" ]]; then fail "$1: request consumed"; else pass "$1: request consumed"; fi
}

echo "update-runner"

reset
run_runner
if [[ ! -e "$E/updates/status.json" ]]; then pass "no request: no-op, no status"; else fail "no request: wrote a status"; fi

reset
good_req
FAKE_RC=0 run_runner
expect "valid request" succeeded null
check "valid request: id" "$ID" "$(jget id)"
check "valid request: target" "0.2.0" "$(jget targetVersion)"
check "valid request: from" "0.1.0" "$(jget fromVersion)"
check "valid request: finishedAt set" "yes" "$([[ "$(jget finishedAt)" =~ ^[0-9]+$ ]] && echo yes || echo no)"
check "valid request: mid-run state" "running" "$(grep -o '"state":"[^"]*"' "$E/mid.json" | cut -d'"' -f4)"
check "valid request: mid-run step" "pull" "$(grep -o '"step":"[^"]*"' "$E/mid.json" | cut -d'"' -f4)"
check "valid request: mid-run id kept" "$ID" "$(grep -o '"id":"[^"]*"' "$E/mid.json" | cut -d'"' -f4)"
if grep -q 'stub args: 0.2.0 --yes' "$E/.deploy/update.log"; then pass "deploy called with version and --yes, log written"; else fail "deploy call/log"; fi

reset
mkdir -p "$E/.deploy"
echo 0.2.0 >"$E/.deploy/current-version"
good_req 0.2.0
run_runner
expect "equal version" succeeded already_current
if [[ ! -e "$E/.deploy/update.log" ]]; then pass "equal version: deploy not run"; else fail "equal version: deploy ran"; fi

bad_requests=(
  "id=$ID\nversion=0.2.0\n"
  "id=$ID\nversion=0.2.0\nrequestedAt=1\nextra=1\n"
  "id=$ID\nid=$ID\nversion=0.2.0\nrequestedAt=1\n"
  "id=$ID\nversion=v0.2.0\nrequestedAt=1\n"
  "id=$ID\nversion=0.2\nrequestedAt=1\n"
  "id=$ID\nversion=0.2.0; rm -rf /\nrequestedAt=1\n"
  "id=ABCDEF0123456789ABCDEF0123456789\nversion=0.2.0\nrequestedAt=1\n"
  "id=abc\nversion=0.2.0\nrequestedAt=1\n"
  "id=$ID\nversion=0.2.0\nrequestedAt=abc\n"
  "id=$ID\r\nversion=0.2.0\r\nrequestedAt=1\r\n"
  "id=$ID\nversion=0.2.0\ngarbage\nrequestedAt=1\n"
  ""
)
i=0
for content in "${bad_requests[@]}"; do
  i=$((i + 1))
  reset
  req "$content"
  run_runner
  expect "invalid request #$i" failed invalid_request
  if [[ ! -e "$E/.deploy/update.log" ]]; then pass "invalid request #$i: deploy not run"; else fail "invalid request #$i: deploy ran"; fi
done

reset
req "id=$ID\nversion=0.2.0\nrequestedAt=1\n$(printf 'x%.0s' $(seq 1 300))\n"
run_runner
expect "oversize request" failed invalid_request
check "oversize request: id null" "null" "$(jget id)"

reset
req "id=$ID\nversion=0.2.0\nextra=1\nrequestedAt=1\n"
run_runner
check "invalid request keeps a valid id" "$ID" "$(jget id)"

reset
echo "target" >"$TMP/linktarget"
if ln -s "$TMP/linktarget" "$E/updates/request" 2>/dev/null && [[ -L "$E/updates/request" ]]; then
  run_runner
  expect "symlink request" failed invalid_request
  check "symlink request: target untouched" "target" "$(cat "$TMP/linktarget")"
else
  skip "symlink request (symlinks not available here)"
fi

for spec in "75 failed busy" "20 failed compose" "21 failed backup" "30 rolled_back deploy" "31 failed rollback_failed" "1 failed deploy"; do
  read -r rc state error <<<"$spec"
  reset
  good_req
  FAKE_RC="$rc" run_runner
  expect "deploy exit $rc" "$state" "$error"
done

reset
good_req
echo "victim" >"$TMP/victim"
if ln -s "$TMP/victim" "$E/updates/status.json" 2>/dev/null && [[ -L "$E/updates/status.json" ]]; then
  FAKE_RC=0 run_runner
  expect "planted status symlink" succeeded null
  check "planted status symlink: replaced by a regular file" "no" "$([[ -L "$E/updates/status.json" ]] && echo yes || echo no)"
  check "planted status symlink: target untouched" "victim" "$(cat "$TMP/victim")"
else
  skip "planted status symlink (symlinks not available here)"
fi

reset
good_req
mkdir -p "$E/.deploy"
for n in 1 2 3 4 5 6 7; do
  echo old >"$E/.deploy/update-2020010${n}T000000Z-1.log"
  sleep 0.05
done
echo current >"$E/.deploy/update.log"
FAKE_RC=0 run_runner
logs=("$E/.deploy"/update-*.log)
check "log rotation keeps 5 rotated logs" "5" "${#logs[@]}"

echo "status helpers"
reset
if (
  source "$E/scripts/lib/common.sh"
  UPDATE_ID=zzz write_update_status "$E/updates/x.json" running starting
) 2>/dev/null; then fail "write_update_status accepts a bad id"; else pass "write_update_status rejects a bad id"; fi
if (
  source "$E/scripts/lib/common.sh"
  write_update_status "$E/updates/x.json" running bogus
) 2>/dev/null; then fail "write_update_status accepts a bad step"; else pass "write_update_status rejects a bad step"; fi
(
  source "$E/scripts/lib/common.sh"
  unset EASYSEND_UPDATE_STATUS
  update_step pull
)
if [[ -z "$(ls -A "$E/updates")" ]]; then pass "update_step is a no-op without EASYSEND_UPDATE_STATUS"; else fail "update_step wrote something"; fi
if (
  source "$E/scripts/lib/common.sh"
  EASYSEND_UPDATE_STATUS="$E/nonexistent-dir/status.json" update_step pull
) >/dev/null 2>&1; then pass "update_step never fails"; else fail "update_step failed on an unwritable path"; fi

echo "update-service"
if [[ "$(id -u)" == "0" ]]; then
  reset
  S="$TMP/systemd"
  svc() { EASYSEND_DIR="$E" EASYSEND_SYSTEMD_DIR="$S" EASYSEND_SKIP_SYSTEMCTL=1 bash "$E/scripts/update-service.sh" "$@" >"$TMP/svc.out" 2>&1; }
  svc install --user root
  check "install: path unit" "yes" "$([[ -f "$S/easysend-update.path" ]] && echo yes || echo no)"
  check "install: service unit" "yes" "$([[ -f "$S/easysend-update.service" ]] && echo yes || echo no)"
  if grep -q "^PathExists=$E/updates/request$" "$S/easysend-update.path"; then pass "install: PathExists"; else fail "install: PathExists"; fi
  if grep -q "^ExecStart=$E/scripts/update-runner.sh$" "$S/easysend-update.service"; then pass "install: ExecStart"; else fail "install: ExecStart"; fi
  if grep -q '"version":1' "$E/updates/runner.json"; then pass "install: runner.json"; else fail "install: runner.json"; fi
  check "install: updates mode" "2770" "$(stat -c %a "$E/updates")"
  check "install: updates owner" "1000" "$(stat -c %u "$E/updates")"
  if svc install --user root; then pass "install is idempotent"; else fail "install is idempotent"; fi
  svc status
  if grep -q 'runner.json: present' "$TMP/svc.out"; then pass "status"; else fail "status"; fi
  svc uninstall
  check "uninstall: units removed" "no" "$([[ -e "$S/easysend-update.path" || -e "$S/easysend-update.service" ]] && echo yes || echo no)"
  check "uninstall: runner.json removed" "no" "$([[ -e "$E/updates/runner.json" ]] && echo yes || echo no)"
  check "uninstall: updates kept" "yes" "$([[ -d "$E/updates" ]] && echo yes || echo no)"
  if svc install --user nosuchuser; then fail "install accepts an unknown user"; else pass "install rejects an unknown user"; fi
else
  skip "update-service install/uninstall (needs root)"
fi

echo
echo "passed: $PASS  failed: $FAIL  skipped: $SKIP"
((FAIL == 0))
