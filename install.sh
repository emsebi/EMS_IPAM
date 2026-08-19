#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY="${EMS_REPOSITORY:-emsebi/EMS_IPAM}"
REPOSITORY_REF="${EMS_REPOSITORY_REF:-main}"
INSTALL_DIR="${EMS_INSTALL_DIR:-/opt/ems-ipam}"
SOURCE_OVERRIDE="${EMS_INSTALL_SOURCE_DIR:-}"
TTY_DEVICE="/dev/tty"
TEMP_DIR=""
SOURCE_DIR=""

log() { printf '\n[%s] %s\n' "EMS IPAM" "$*"; }
fail() { printf '\nError: %s\n' "$*" >&2; exit 1; }

cleanup() {
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then rm -rf -- "$TEMP_DIR"; fi
}
trap cleanup EXIT

need_command() { command -v "$1" >/dev/null 2>&1 || fail "Required command '$1' is not installed."; }

read_default() {
  local variable_name="$1" prompt_text="$2" default_value="$3" entered=""
  read -r -p "$prompt_text [$default_value]: " entered <"$TTY_DEVICE" || fail "Unable to read terminal input."
  printf -v "$variable_name" '%s' "${entered:-$default_value}"
}

read_secret_twice() {
  local variable_name="$1" prompt_text="$2" minimum_length="$3" first="" second=""
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
  case "${1,,}" in
    true|yes|y|1) printf 'true' ;;
    false|no|n|0) printf 'false' ;;
    *) return 1 ;;
  esac
}

port_is_busy() {
  local port="$1"
  if ss -H -ltn 2>/dev/null | awk -v suffix=":$port" '$4 ~ suffix "$" { found=1 } END { exit(found ? 0 : 1) }'; then return 0; fi
  if docker ps --format '{{.Ports}}' 2>/dev/null | grep -Eq "(^|[,[:space:]])[^,]*:${port}->"; then return 0; fi
  return 1
}

download_source() {
  TEMP_DIR="$(mktemp -d /tmp/ems-ipam-setup.XXXXXX)"
  SOURCE_DIR="$TEMP_DIR/source"
  mkdir -p "$SOURCE_DIR"
  if [[ -n "$SOURCE_OVERRIDE" ]]; then
    [[ -d "$SOURCE_OVERRIDE" ]] || fail "Source override directory was not found."
    cp -a "$SOURCE_OVERRIDE/." "$SOURCE_DIR/"
  else
    local archive_url="https://github.com/${REPOSITORY}/archive/refs/heads/${REPOSITORY_REF}.tar.gz"
    ARCHIVE_PATH="$TEMP_DIR/source.tar.gz"
    if ! curl -fsSL --retry 3 --connect-timeout 15 --output "$ARCHIVE_PATH" "$archive_url"; then
      fail "Project download failed: $archive_url"
    fi
    if ! tar -tzf "$ARCHIVE_PATH" >/dev/null 2>&1; then fail "Downloaded project archive is invalid or incomplete."; fi
    tar -xzf "$ARCHIVE_PATH" --strip-components=1 -C "$SOURCE_DIR"
  fi
  for required_path in compose.yml docker-app/Dockerfile docker-app/package.json docker-app/server/main.mjs; do
    [[ -e "$SOURCE_DIR/$required_path" ]] || fail "Required file '$required_path' is missing from the repository."
  done
}

load_installation() {
  [[ -f "$INSTALL_DIR/.env" && -f "$INSTALL_DIR/compose.yml" ]] || fail "EMS IPAM is not installed in '$INSTALL_DIR'."
  set -a
  source "$INSTALL_DIR/.env"
  set +a
  compose=(docker compose --project-name ems-ipam --env-file "$INSTALL_DIR/.env" -f "$INSTALL_DIR/compose.yml")
}

start_and_check() {
  log "Pulling the database image"
  "${compose[@]}" pull db
  log "Building the EMS IPAM image"
  "${compose[@]}" build --pull app
  log "Starting services"
  "${compose[@]}" up -d
  log "Checking service health"
  for (( attempt=1; attempt<=60; attempt+=1 )); do
    if curl -fsS --max-time 2 "http://127.0.0.1:${EMS_HTTP_PORT}/health" >/dev/null 2>&1; then
      local server_ip
      server_ip="$(hostname -I 2>/dev/null || true)"
      server_ip="${server_ip%% *}"
      printf '\nOperation completed successfully.\n'
      printf 'Panel URL: http://%s:%s\n' "${server_ip:-SERVER-IP}" "$EMS_HTTP_PORT"
      printf 'Installation directory: %s\n' "$INSTALL_DIR"
      return 0
    fi
    sleep 2
  done
  "${compose[@]}" ps >&2 || true
  "${compose[@]}" logs --tail 80 app db >&2 || true
  return 1
}

install_app() {
  [[ ! -e "$INSTALL_DIR" ]] || fail "Installation directory '$INSTALL_DIR' already exists. Choose Update or remove the existing installation first."
  log "Installation settings"
  read_secret_twice POSTGRES_PASSWORD "POSTGRES_PASSWORD (minimum 16 characters)" 16
  while true; do
    read_default EMS_ADMIN_USERNAME "EMS_ADMIN_USERNAME" "admin"
    [[ "$EMS_ADMIN_USERNAME" =~ ^[A-Za-z0-9_.-]{3,80}$ ]] && break
    printf 'Username must be 3-80 characters and use only letters, numbers, dot, underscore or hyphen.\n' >&2
  done
  read_secret_twice EMS_ADMIN_PASSWORD "EMS_ADMIN_PASSWORD (minimum 12 characters)" 12
  while true; do
    read_default EMS_HTTP_PORT "EMS_HTTP_PORT" "8080"
    if [[ "$EMS_HTTP_PORT" =~ ^[0-9]+$ ]]; then
      EMS_HTTP_PORT=$((10#$EMS_HTTP_PORT))
      (( EMS_HTTP_PORT >= 1 && EMS_HTTP_PORT <= 65535 )) && break
    fi
    printf 'Port must be a number between 1 and 65535.\n' >&2
  done
  while true; do
    read_default cookie_input "COOKIE_SECURE (true for HTTPS, false for HTTP)" "false"
    if COOKIE_SECURE="$(normalize_boolean "$cookie_input")"; then break; fi
    printf 'Enter true or false.\n' >&2
  done
  if port_is_busy "$EMS_HTTP_PORT"; then
    fail "Port $EMS_HTTP_PORT is already in use. No containers were created. Run setup again and choose another port."
  fi
  EMS_SECRET_KEY="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  log "Downloading project files"
  download_source
  umask 077
  {
    printf "POSTGRES_PASSWORD='%s'\n" "$POSTGRES_PASSWORD"
    printf "EMS_ADMIN_USERNAME='%s'\n" "$EMS_ADMIN_USERNAME"
    printf "EMS_ADMIN_PASSWORD='%s'\n" "$EMS_ADMIN_PASSWORD"
    printf "EMS_SECRET_KEY='%s'\n" "$EMS_SECRET_KEY"
    printf "EMS_HTTP_PORT='%s'\n" "$EMS_HTTP_PORT"
    printf "COOKIE_SECURE='%s'\n" "$COOKIE_SECURE"
  } > "$SOURCE_DIR/.env"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  mv "$SOURCE_DIR" "$INSTALL_DIR"
  chmod 600 "$INSTALL_DIR/.env"
  load_installation
  start_and_check || fail "The service did not become healthy in time. Container logs are shown above."
}

update_app() {
  load_installation
  if [[ -z "${EMS_SECRET_KEY:-}" ]]; then
    EMS_SECRET_KEY="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
    umask 077
    printf "EMS_SECRET_KEY='%s'\n" "$EMS_SECRET_KEY" >> "$INSTALL_DIR/.env"
  fi
  log "Downloading the latest project files"
  download_source
  cp -a "$INSTALL_DIR/.env" "$SOURCE_DIR/.env"
  if [[ -d "$INSTALL_DIR/backups" ]]; then cp -a "$INSTALL_DIR/backups" "$SOURCE_DIR/backups"; fi
  local previous_dir="${INSTALL_DIR}.previous.$$"
  "${compose[@]}" down --remove-orphans
  mv "$INSTALL_DIR" "$previous_dir"
  mv "$SOURCE_DIR" "$INSTALL_DIR"
  chmod 600 "$INSTALL_DIR/.env"
  load_installation
  if start_and_check; then
    rm -rf -- "$previous_dir"
    printf 'Database volume and encryption key were preserved.\n'
  else
    "${compose[@]}" down --remove-orphans || true
    mv "$INSTALL_DIR" "${INSTALL_DIR}.failed.$$"
    mv "$previous_dir" "$INSTALL_DIR"
    load_installation
    "${compose[@]}" up -d || true
    fail "Update failed and the previous installation was restored."
  fi
}

backup_database() {
  load_installation
  local backup_dir="$INSTALL_DIR/backups" timestamp backup_file key_file
  mkdir -p "$backup_dir"
  timestamp="$(date +%Y%m%d-%H%M%S)"
  backup_file="$backup_dir/ems-ipam-$timestamp.dump"
  key_file="$backup_dir/ems-ipam-$timestamp.env"
  log "Creating PostgreSQL backup"
  "${compose[@]}" exec -T db pg_dump -U ems_ipam -d ems_ipam -Fc > "$backup_file"
  cp -a "$INSTALL_DIR/.env" "$key_file"
  chmod 600 "$backup_file" "$key_file"
  printf '\nDatabase backup created: %s\n' "$backup_file"
  printf 'Encryption settings backup created: %s\n' "$key_file"
}

uninstall_app() {
  load_installation
  log "Stopping and removing application containers"
  "${compose[@]}" down --remove-orphans
  docker image rm ems-ipam:0.2.0 ems-ipam:0.1.0 >/dev/null 2>&1 || true
  printf '\nApplication containers were removed.\n'
  printf 'Database volume, configuration, encryption key and backups were kept.\n'
  printf 'Use Update to install the application again.\n'
}

uninstall_all() {
  load_installation
  printf '\nWARNING: This permanently deletes the application, database volume, settings and local backups.\n'
  local confirmation=""
  read -r -p "Type DELETE to continue: " confirmation <"$TTY_DEVICE" || fail "Unable to read confirmation."
  [[ "$confirmation" == "DELETE" ]] || fail "Full uninstall cancelled."
  "${compose[@]}" down --volumes --remove-orphans
  docker image rm ems-ipam:0.2.0 ems-ipam:0.1.0 >/dev/null 2>&1 || true
  [[ "$INSTALL_DIR" == /opt/* && "$INSTALL_DIR" != "/opt" ]] || fail "Unsafe installation directory. Files were not removed."
  rm -rf -- "$INSTALL_DIR"
  printf '\nEMS IPAM and its database were permanently removed.\n'
}

show_menu() {
  printf '\nEMS IPAM Setup\n'
  printf '1) Install\n'
  printf '2) Update\n'
  printf '3) Backup Database\n'
  printf '4) Uninstall App (Keep Database)\n'
  printf '5) Uninstall App + Database\n'
  read -r -p "Select an option [1-5]: " ACTION <"$TTY_DEVICE" || fail "Unable to read menu selection."
}

if (( EUID != 0 )); then fail "Run this setup script with sudo."; fi
[[ -r "$TTY_DEVICE" ]] || fail "This setup script must run in an interactive terminal."
for command_name in docker curl tar ss awk grep od tr; do need_command "$command_name"; done
docker info >/dev/null 2>&1 || fail "Docker is not running or is not accessible."
docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is not installed."

ACTION="${1:-}"
[[ -n "$ACTION" ]] || show_menu
case "${ACTION,,}" in
  1|install) install_app ;;
  2|update) update_app ;;
  3|backup|backup-database) backup_database ;;
  4|uninstall|uninstall-app) uninstall_app ;;
  5|purge|uninstall-all) uninstall_all ;;
  *) fail "Invalid option. Select a number from 1 to 5." ;;
esac
