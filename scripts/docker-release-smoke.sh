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
TEST_ROOT="$(mktemp -d /tmp/ems-ipam-docker-test.XXXXXX)"
TEST_ID="$(basename "$TEST_ROOT" | tr -cd 'A-Za-z0-9')"
PROJECT_NAME="ems-ipam-test-${TEST_ID,,}"
export POSTGRES_DB="ems_ipam_test"
export POSTGRES_USER="ems_ipam_test"
export POSTGRES_PASSWORD="DockerTest-Only-9"
export EMS_ADMIN_USERNAME="docker-test-admin"
export EMS_ADMIN_PASSWORD="DockerTest-Admin-9"
export EMS_HTTP_PORT="${EMS_TEST_PORT:-18080}"
export EMS_STATE_DIR="$TEST_ROOT/state"
export EMS_BACKUP_PATH="$TEST_ROOT/state/backups"
export EMS_DB_VOLUME_NAME="${PROJECT_NAME}-db"
export EMS_NETWORK_NAME="${PROJECT_NAME}-network"
export COOKIE_SECURE=false
mkdir -p "$EMS_STATE_DIR/backups"
chmod 777 "$EMS_STATE_DIR/backups"

compose(){ docker compose --project-name "$PROJECT_NAME" -f "$PROJECT_ROOT/compose.yml" "$@"; }
cleanup(){
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  [[ "$TEST_ROOT" == /tmp/ems-ipam-docker-test.* ]] && rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

curl -fsS "http://127.0.0.1:${EMS_HTTP_PORT}/health" >/dev/null 2>&1 && fail "Test port ${EMS_HTTP_PORT} is already in use."

compose config >/dev/null
pass "compose config"
compose build --pull app
compose up -d --wait

HEALTH="$(curl -fsS "http://127.0.0.1:${EMS_HTTP_PORT}/health")"
[[ "$HEALTH" == *'"version":"1.7.0-rc.1"'* && "$HEALTH" == *'"radio"'* ]] || fail "Health response does not report v1.7.0-rc.1 and Radio."
pass "fresh install health"
CLIENT_VERSION="$(compose exec -T app pg_dump --version)"
[[ "$CLIENT_VERSION" == *' 16.'* ]] || fail "App backup client must use PostgreSQL 16: $CLIENT_VERSION"
pass "PostgreSQL backup client version"

COOKIE_JAR="$TEST_ROOT/cookies.txt"
LOGIN="$(curl -fsS -c "$COOKIE_JAR" -H 'Content-Type: application/json' -H 'X-EMS-CSRF: 1' \
  --data "{\"username\":\"$EMS_ADMIN_USERNAME\",\"password\":\"$EMS_ADMIN_PASSWORD\"}" \
  "http://127.0.0.1:${EMS_HTTP_PORT}/api/auth/login")"
[[ "$LOGIN" == *'"ok":true'* ]] || fail "Admin login failed."
pass "admin login"

COMPANY_NAME="Docker Test ${TEST_ID}"
CREATE="$(curl -fsS -b "$COOKIE_JAR" -H 'Content-Type: application/json' -H 'X-EMS-CSRF: 1' \
  --data "{\"name\":\"$COMPANY_NAME\",\"kind\":\"company\",\"contacts\":[],\"connections\":[]}" \
  "http://127.0.0.1:${EMS_HTTP_PORT}/api/companies")"
[[ "$CREATE" == *'"ok":true'* ]] || fail "Company create API failed."
pass "authenticated write API"

BACKUP="$(curl -fsS -b "$COOKIE_JAR" -H 'X-EMS-CSRF: 1' -X POST \
  "http://127.0.0.1:${EMS_HTTP_PORT}/api/backups")"
[[ "$BACKUP" == *'"ok":true'* ]] || fail "Backup API failed."
BACKUP_FILE="$(find "$EMS_STATE_DIR/backups" -type f -size +0c -name '*.tar.gz' -print -quit)"
[[ -n "$BACKUP_FILE" ]] || fail "Backup file is missing or empty."
gzip -t "$BACKUP_FILE"
tar -tzf "$BACKUP_FILE" | grep -qx 'database.dump' || fail "Database dump missing from backup."
pass "database backup"
compose exec -T db createdb -U "$POSTGRES_USER" ems_ipam_restore_test
tar -xOzf "$BACKUP_FILE" database.dump | compose exec -T db pg_restore -U "$POSTGRES_USER" -d ems_ipam_restore_test --no-owner --no-privileges --exit-on-error
RESTORED_COUNT="$(compose exec -T db psql -U "$POSTGRES_USER" -d ems_ipam_restore_test -Atc "SELECT count(*) FROM companies WHERE name='$COMPANY_NAME'")"
[[ "$RESTORED_COUNT" == "1" ]] || fail "Backup restore did not recover the test company."
pass "backup restores into a separate test database"

compose down --remove-orphans
compose up -d --wait
curl -fsS -c "$COOKIE_JAR" -H 'Content-Type: application/json' -H 'X-EMS-CSRF: 1' \
  --data "{\"username\":\"$EMS_ADMIN_USERNAME\",\"password\":\"$EMS_ADMIN_PASSWORD\"}" \
  "http://127.0.0.1:${EMS_HTTP_PORT}/api/auth/login" >/dev/null
BOOTSTRAP="$(curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:${EMS_HTTP_PORT}/api/bootstrap")"
[[ "$BOOTSTRAP" == *"$COMPANY_NAME"* ]] || fail "Database data did not survive container recreation."
pass "persistent database after restart"

compose ps
printf 'Docker release smoke test completed successfully.\n'
