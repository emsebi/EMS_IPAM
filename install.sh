#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY="${EMS_REPOSITORY:-emsebi/EMS_IPAM}"
REPOSITORY_REF="${EMS_REPOSITORY_REF:-main}"
INSTALL_DIR="${EMS_INSTALL_DIR:-/opt/ems-ipam}"
SOURCE_OVERRIDE="${EMS_INSTALL_SOURCE_DIR:-}"
TTY_DEVICE="/dev/tty"
TEMP_DIR=""

log() {
  printf '\n[%s] %s\n' "EMS IPAM" "$*"
}

fail() {
  printf '\nError: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
    rm -rf -- "$TEMP_DIR"
  fi
}
trap cleanup EXIT

need_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command '$1' is not installed."
}

read_default() {
  local variable_name="$1"
  local prompt_text="$2"
  local default_value="$3"
  local entered=""
  read -r -p "$prompt_text [$default_value]: " entered <"$TTY_DEVICE" || fail "Unable to read terminal input."
  printf -v "$variable_name" '%s' "${entered:-$default_value}"
}

read_secret_twice() {
  local variable_name="$1"
  local prompt_text="$2"
  local minimum_length="$3"
  local first=""
  local second=""
  while true; do
    read -r -s -p "$prompt_text: " first <"$TTY_DEVICE" || fail "Unable to read the password."
    printf '\n'
    if (( ${#first} < minimum_length )); then
      printf 'Password must contain at least %s characters.\n' "$minimum_length" >&2
      continue
    fi
    if [[ "$first" == *"'"* ]]; then
      printf "Do not use an apostrophe (') in the password.\n" >&2
      continue
    fi
    read -r -s -p "Confirm password: " second <"$TTY_DEVICE" || fail "Unable to read the password confirmation."
    printf '\n'
    if [[ "$first" != "$second" ]]; then
      printf 'Passwords do not match. Try again.\n' >&2
      continue
    fi
    printf -v "$variable_name" '%s' "$first"
    return
  done
}

normalize_boolean() {
  local value="${1,,}"
  case "$value" in
    true|yes|y|1) printf 'true' ;;
    false|no|n|0) printf 'false' ;;
    *) return 1 ;;
  esac
}

port_is_busy() {
  local port="$1"
  if ss -H -ltn 2>/dev/null | awk -v suffix=":$port" '$4 ~ suffix "$" { found=1 } END { exit(found ? 0 : 1) }'; then
    return 0
  fi
  if docker ps --format '{{.Ports}}' 2>/dev/null | grep -Eq "(^|[,[:space:]])[^,]*:${port}->"; then
    return 0
  fi
  return 1
}

if (( EUID != 0 )); then
  fail "Run this installer with sudo."
fi

[[ -r "$TTY_DEVICE" ]] || fail "This installer must run in an interactive terminal."

for command_name in docker curl tar ss awk grep; do
  need_command "$command_name"
done

docker info >/dev/null 2>&1 || fail "Docker is not running or is not accessible."
docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is not installed."

if [[ -e "$INSTALL_DIR" ]]; then
  fail "Installation directory '$INSTALL_DIR' already exists. Nothing was overwritten."
fi

log "Installation settings"
read_secret_twice POSTGRES_PASSWORD "POSTGRES_PASSWORD (minimum 16 characters)" 16

while true; do
  read_default EMS_ADMIN_USERNAME "EMS_ADMIN_USERNAME" "admin"
  if [[ "$EMS_ADMIN_USERNAME" =~ ^[A-Za-z0-9_.-]{3,80}$ ]]; then
    break
  fi
  printf 'Username must be 3-80 characters and use only letters, numbers, dot, underscore or hyphen.\n' >&2
done

read_secret_twice EMS_ADMIN_PASSWORD "EMS_ADMIN_PASSWORD (minimum 12 characters)" 12

while true; do
  read_default EMS_HTTP_PORT "EMS_HTTP_PORT" "8080"
  if [[ "$EMS_HTTP_PORT" =~ ^[0-9]+$ ]]; then
    EMS_HTTP_PORT=$((10#$EMS_HTTP_PORT))
    if (( EMS_HTTP_PORT >= 1 && EMS_HTTP_PORT <= 65535 )); then
      break
    fi
  fi
  printf 'Port must be a number between 1 and 65535.\n' >&2
done

while true; do
  read_default cookie_input "COOKIE_SECURE (true for HTTPS, false for HTTP)" "false"
  if COOKIE_SECURE="$(normalize_boolean "$cookie_input")"; then
    break
  fi
  printf 'Enter true or false.\n' >&2
done

if port_is_busy "$EMS_HTTP_PORT"; then
  fail "Port $EMS_HTTP_PORT is already in use. No containers were created. Run the installer again and choose another port."
fi

log "Downloading project files"
TEMP_DIR="$(mktemp -d /tmp/ems-ipam-install.XXXXXX)"
SOURCE_DIR="$TEMP_DIR/source"
mkdir -p "$SOURCE_DIR"

if [[ -n "$SOURCE_OVERRIDE" ]]; then
  [[ -d "$SOURCE_OVERRIDE" ]] || fail "Source override directory was not found."
  cp -a "$SOURCE_OVERRIDE/." "$SOURCE_DIR/"
else
  ARCHIVE_URL="https://github.com/${REPOSITORY}/archive/refs/heads/${REPOSITORY_REF}.tar.gz"
  ARCHIVE_PATH="$TEMP_DIR/source.tar.gz"
  if ! curl -fsSL --retry 3 --connect-timeout 15 --output "$ARCHIVE_PATH" "$ARCHIVE_URL"; then
    fail "Project download failed: $ARCHIVE_URL"
  fi
  if ! tar -tzf "$ARCHIVE_PATH" >/dev/null 2>&1; then
    fail "Downloaded project archive is invalid or incomplete."
  fi
  tar -xzf "$ARCHIVE_PATH" --strip-components=1 -C "$SOURCE_DIR"
fi

for required_path in compose.yml docker-app/Dockerfile docker-app/package.json docker-app/server/main.mjs; do
  [[ -e "$SOURCE_DIR/$required_path" ]] || fail "Required file '$required_path' is missing from the repository."
done

umask 077
{
  printf "POSTGRES_PASSWORD='%s'\n" "$POSTGRES_PASSWORD"
  printf "EMS_ADMIN_USERNAME='%s'\n" "$EMS_ADMIN_USERNAME"
  printf "EMS_ADMIN_PASSWORD='%s'\n" "$EMS_ADMIN_PASSWORD"
  printf "EMS_HTTP_PORT='%s'\n" "$EMS_HTTP_PORT"
  printf "COOKIE_SECURE='%s'\n" "$COOKIE_SECURE"
} > "$SOURCE_DIR/.env"

mkdir -p "$(dirname "$INSTALL_DIR")"
mv "$SOURCE_DIR" "$INSTALL_DIR"
chmod 600 "$INSTALL_DIR/.env"

compose=(docker compose --project-name ems-ipam --env-file "$INSTALL_DIR/.env" -f "$INSTALL_DIR/compose.yml")

log "Pulling database image"
"${compose[@]}" pull db

log "Building EMS IPAM image"
"${compose[@]}" build --pull app

log "Starting services"
"${compose[@]}" up -d

log "Checking service health"
for (( attempt=1; attempt<=60; attempt+=1 )); do
  if curl -fsS --max-time 2 "http://127.0.0.1:${EMS_HTTP_PORT}/health" >/dev/null 2>&1; then
    SERVER_IP="$(hostname -I 2>/dev/null || true)"
    SERVER_IP="${SERVER_IP%% *}"
    printf '\nInstallation completed successfully.\n'
    printf 'Panel URL: http://%s:%s\n' "${SERVER_IP:-SERVER-IP}" "$EMS_HTTP_PORT"
    printf 'Installation directory: %s\n' "$INSTALL_DIR"
    exit 0
  fi
  sleep 2
done

"${compose[@]}" ps >&2 || true
"${compose[@]}" logs --tail 80 app db >&2 || true
fail "The service did not become healthy in time. Container logs are shown above."
