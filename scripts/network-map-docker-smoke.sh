#!/usr/bin/env bash
set -Eeuo pipefail

have(){ command -v "$1" >/dev/null 2>&1; }
fail(){ printf 'FAIL: %s\n' "$*" >&2; exit 1; }
pass(){ printf 'PASS: %s\n' "$*"; }

have docker || fail "Docker is not installed."
have curl || fail "curl is not installed."
docker info >/dev/null 2>&1 || fail "Docker daemon is not available."
docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is not available."

PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
TEST_ROOT="$(mktemp -d /tmp/ems-ipam-map-test.XXXXXX)"
TEST_ID="$(basename "$TEST_ROOT" | tr -cd 'A-Za-z0-9')"
PROJECT_NAME="ems-ipam-map-${TEST_ID,,}"
export POSTGRES_DB="ems_map_test"
export POSTGRES_USER="ems_map_test"
export POSTGRES_PASSWORD="Synthetic-DB-Only-9"
export EMS_ADMIN_USERNAME="map-test-admin"
export EMS_ADMIN_PASSWORD="Synthetic-Admin-Only-9"
export EMS_HTTP_PORT="${EMS_MAP_TEST_PORT:-18081}"
export EMS_STATE_DIR="$TEST_ROOT/state"
export EMS_BACKUP_PATH="$TEST_ROOT/state/backups"
export EMS_DB_VOLUME_NAME="${PROJECT_NAME}-db"
export EMS_NETWORK_NAME="${PROJECT_NAME}-network"
export COOKIE_SECURE=false
mkdir -p "$EMS_STATE_DIR/backups"
chmod 777 "$EMS_STATE_DIR/backups"

compose(){ docker compose --project-name "$PROJECT_NAME" -f "$PROJECT_ROOT/compose.yml" -f "$PROJECT_ROOT/modules/network-map/tests/compose.ssh-fixture.yml" "$@"; }
cleanup(){
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  [[ "$TEST_ROOT" == /tmp/ems-ipam-map-test.* ]] && rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

curl -fsS "http://127.0.0.1:${EMS_HTTP_PORT}/health" >/dev/null 2>&1 && fail "Test port ${EMS_HTTP_PORT} is already in use."
compose config >/dev/null
compose build --pull app
compose up -d --wait

HEALTH="$(curl -fsS "http://127.0.0.1:${EMS_HTTP_PORT}/health")"
[[ "$HEALTH" == *'"network-map"'* ]] || fail "Network Map module did not load in the Docker application."
pass "Docker application loaded Network Map module"

COOKIE_JAR="$TEST_ROOT/cookies.txt"
LOGIN="$(curl -fsS -c "$COOKIE_JAR" -H 'Content-Type: application/json' -H 'X-EMS-CSRF: 1' \
  --data "{\"username\":\"$EMS_ADMIN_USERNAME\",\"password\":\"$EMS_ADMIN_PASSWORD\"}" \
  "http://127.0.0.1:${EMS_HTTP_PORT}/api/auth/login")"
[[ "$LOGIN" == *'"ok":true'* ]] || fail "Admin login failed."

COMPANY="$(curl -fsS -b "$COOKIE_JAR" -H 'Content-Type: application/json' -H 'X-EMS-CSRF: 1' \
  --data "{\"name\":\"Synthetic Map ${TEST_ID}\",\"kind\":\"company\",\"contacts\":[],\"connections\":[]}" \
  "http://127.0.0.1:${EMS_HTTP_PORT}/api/companies")"
COMPANY_ID="$(node -e 'const x=JSON.parse(process.argv[1]);if(!x.ok||!x.id)process.exit(1);process.stdout.write(x.id)' "$COMPANY")" || fail "Company fixture creation failed."
FIXTURE_CONTAINER="$(compose ps -q ssh_fixture)"
FIXTURE_IP="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$FIXTURE_CONTAINER")"
[[ "$FIXTURE_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Synthetic SSH fixture has no isolated IPv4 address."

SETTINGS="$(node -e 'process.stdout.write(JSON.stringify({username:"map-readonly",password:"Synthetic-Map-Password",devices:[{address:process.argv[1],platform:"cisco",name:"Synthetic Core"}],scopes:[],rootId:process.argv[1],port:2222,timeout:8,concurrency:1,saveConfig:true}))' "$FIXTURE_IP")"
SAVE="$(curl -fsS -X PUT -b "$COOKIE_JAR" -H 'Content-Type: application/json' -H 'X-EMS-CSRF: 1' \
  --data "$SETTINGS" "http://127.0.0.1:${EMS_HTTP_PORT}/api/network-map/settings?companyId=${COMPANY_ID}")"
[[ "$SAVE" == *'"ok":true'* ]] || fail "Network Map settings were not saved."
BEFORE="$(curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:${EMS_HTTP_PORT}/api/network-map/snapshots?companyId=${COMPANY_ID}")"
node -e 'const x=JSON.parse(process.argv[1]);if(!x.ok||x.items.length!==0)process.exit(1)' "$BEFORE" || fail "Saving settings unexpectedly started discovery."
LISTED="$(curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:${EMS_HTTP_PORT}/api/network-map/settings?companyId=${COMPANY_ID}")"
node -e 'const x=JSON.parse(process.argv[1]);if(!x.hasPassword||JSON.stringify(x).includes("Synthetic-Map-Password"))process.exit(1)' "$LISTED" || fail "Saved settings exposed or lost the SSH password."
pass "read-only settings saved without automatic discovery or password disclosure"

START="$(curl -fsS -X POST -b "$COOKIE_JAR" -H 'Content-Type: application/json' -H 'X-EMS-CSRF: 1' \
  --data '{}' "http://127.0.0.1:${EMS_HTTP_PORT}/api/network-map/scan?companyId=${COMPANY_ID}")"
[[ "$START" == *'"status":"running"'* ]] || fail "Manual Create Map did not start."
STATE=''
for _ in $(seq 1 60); do
  STATE="$(curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:${EMS_HTTP_PORT}/api/network-map/state?companyId=${COMPANY_ID}")"
  STATUS="$(node -e 'const x=JSON.parse(process.argv[1]);process.stdout.write(x.job?.status||"")' "$STATE")"
  [[ "$STATUS" == "completed" ]] && break
  [[ "$STATUS" == "failed" ]] && fail "Manual Create Map failed."
  sleep 1
done
node -e '
 const x=JSON.parse(process.argv[1]),core=x.topology.nodes.find(n=>n.hostname==="FixtureSwitch");
 if(x.job?.status!=="completed"||!core||core.status!=="online")process.exit(1);
 if(!core.ports.some(p=>p.name==="Gi1/0/2"&&p.vlan==="10"))process.exit(1);
 if(!core.macs.some(m=>m.mac==="00:11:22:33:44:55"&&m.port==="Gi1/0/2"))process.exit(1);
 if(!x.topology.links.some(l=>l.sourcePort==="Gi1/0/1"&&l.targetPort==="Gi0/24"&&/cdp|lldp/.test(l.protocol)))process.exit(1);
' "$STATE" || fail "Synthetic LLDP/CDP, port/VLAN or MAC evidence is missing from the topology."
pass "manual Create Map collected synthetic port, VLAN, MAC and LLDP/CDP topology"

SNAPSHOTS="$(curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:${EMS_HTTP_PORT}/api/network-map/snapshots?companyId=${COMPANY_ID}")"
SNAPSHOT_ID="$(node -e 'const x=JSON.parse(process.argv[1]);if(!x.ok||x.items.length!==1)process.exit(1);process.stdout.write(x.items[0].id)' "$SNAPSHOTS")" || fail "Exactly one manual snapshot was not stored."
SNAPSHOT_FILE="$TEST_ROOT/snapshot.json"
curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:${EMS_HTTP_PORT}/api/network-map/snapshots/${SNAPSHOT_ID}/download?companyId=${COMPANY_ID}" -o "$SNAPSHOT_FILE"
node -e '
 const x=require(process.argv[1]),raw=require("node:fs").readFileSync(process.argv[1],"utf8");
 if(x.format!=="ems-network-map/1"||!x.configExport?.secretsRedacted)process.exit(1);
 if(raw.includes("synthetic-community-value")||raw.includes("synthetic-enable-secret")||raw.includes("Synthetic-Map-Password"))process.exit(1);
 if(!raw.includes("[REDACTED]"))process.exit(1);
' "$SNAPSHOT_FILE" || fail "Readable snapshot is missing or contains a synthetic secret."
pass "readable snapshot stored with configuration secrets removed"

compose restart app >/dev/null
for _ in $(seq 1 45); do
  curl -fsS --max-time 3 "http://127.0.0.1:${EMS_HTTP_PORT}/health" >/dev/null && break
  sleep 1
done
curl -fsS --max-time 3 "http://127.0.0.1:${EMS_HTTP_PORT}/health" >/dev/null || fail "Application did not recover after restart."
curl -fsS -c "$COOKIE_JAR" -H 'Content-Type: application/json' -H 'X-EMS-CSRF: 1' \
  --data "{\"username\":\"$EMS_ADMIN_USERNAME\",\"password\":\"$EMS_ADMIN_PASSWORD\"}" \
  "http://127.0.0.1:${EMS_HTTP_PORT}/api/auth/login" >/dev/null
AFTER="$(curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:${EMS_HTTP_PORT}/api/network-map/state?companyId=${COMPANY_ID}")"
AFTER_SETTINGS="$(curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:${EMS_HTTP_PORT}/api/network-map/settings?companyId=${COMPANY_ID}")"
AFTER_SNAPSHOTS="$(curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:${EMS_HTTP_PORT}/api/network-map/snapshots?companyId=${COMPANY_ID}")"
node -e '
 const state=JSON.parse(process.argv[1]),settings=JSON.parse(process.argv[2]),snapshots=JSON.parse(process.argv[3]);
 if(!state.topology.nodes.some(n=>n.hostname==="FixtureSwitch")||!settings.hasPassword||snapshots.items.length!==1)process.exit(1);
' "$AFTER" "$AFTER_SETTINGS" "$AFTER_SNAPSHOTS" || fail "Network Map state did not persist after application restart."
curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:${EMS_HTTP_PORT}/api/network-map/snapshots/${SNAPSHOT_ID}/download?companyId=${COMPANY_ID}" >/dev/null || fail "Snapshot file did not persist after restart."
pass "settings, topology and snapshot persisted after application restart"

compose ps
printf 'Network Map full Docker Compose smoke completed successfully.\n'
