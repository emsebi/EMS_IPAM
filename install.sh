#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY="${EMS_REPOSITORY:-emsebi/EMS_IPAM}"
REPOSITORY_REF="${EMS_REPOSITORY_REF:-main}"
INSTALL_DIR="${EMS_INSTALL_DIR:-/opt/ems-ipam}"
STATE_DIR="${EMS_STATE_DIR:-/var/lib/ems-ipam}"
ENV_FILE="$STATE_DIR/.env"
PROJECT_NAME="ems-ipam"
TTY_DEVICE="/dev/tty"
TMP_ROOT=""
SOURCE_DIR=""

log(){ printf '\n[EMS IPAM] %s\n' "$*"; }
warn(){ printf '\n[EMS IPAM] WARNING: %s\n' "$*" >&2; }
fail(){ printf '\nError: %s\n' "$*" >&2; exit 1; }
cleanup(){ [[ -n "$TMP_ROOT" && -d "$TMP_ROOT" ]] && rm -rf "$TMP_ROOT" || true; }
trap cleanup EXIT
have(){ command -v "$1" >/dev/null 2>&1; }

read_default(){
  local __var="$1" prompt="$2" default="$3" value=""
  read -r -p "$prompt [$default]: " value <"$TTY_DEVICE" || fail "Unable to read terminal input."
  printf -v "$__var" '%s' "${value:-$default}"
}

read_secret_twice(){
  local __var="$1" prompt="$2" min="${3:-1}" a="" b=""
  while true; do
    read -r -s -p "$prompt: " a <"$TTY_DEVICE" || fail "Unable to read password."
    printf '\n'
    (( ${#a} >= min )) || { printf 'Password must contain at least %s characters.\n' "$min" >&2; continue; }
    [[ "$a" != *$'\n'* && "$a" != *$'\r'* ]] || { printf 'Password contains invalid characters.\n' >&2; continue; }
    read -r -s -p "Confirm password: " b <"$TTY_DEVICE" || fail "Unable to read password confirmation."
    printf '\n'
    [[ "$a" == "$b" ]] || { printf 'Passwords do not match. Try again.\n' >&2; continue; }
    printf -v "$__var" '%s' "$a"
    return
  done
}

confirm(){
  local prompt="$1" ans=""
  read -r -p "$prompt [y/N]: " ans <"$TTY_DEVICE" || return 1
  [[ "${ans,,}" =~ ^(y|yes)$ ]]
}

port_busy(){
  local port="$1"
  if have ss && ss -H -ltn 2>/dev/null | awk -v p=":$port" '$4 ~ p"$" {found=1} END{exit found?0:1}'; then return 0; fi
  docker ps --format '{{.Ports}}' 2>/dev/null | grep -Eq "(^|[,[:space:]])[^,]*:${port}->" && return 0
  return 1
}

install_prerequisites(){
  [[ "$(id -u)" -eq 0 ]] || fail "Run installer with sudo/root."
  log "Checking prerequisites"
  if ! have curl || ! have tar || ! have openssl; then
    have apt-get || fail "Automatic prerequisite installation currently supports Debian/Ubuntu."
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y ca-certificates curl tar gzip openssl
  fi
  if ! have docker; then
    have apt-get || fail "Docker is missing and automatic installation requires apt-get."
    log "Docker Engine was not found; installing it"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y ca-certificates curl
    curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
    sh /tmp/get-docker.sh
    rm -f /tmp/get-docker.sh
  fi
  have systemctl && systemctl enable --now docker >/dev/null 2>&1 || true
  docker info >/dev/null 2>&1 || fail "Docker daemon is not available."
  if ! docker compose version >/dev/null 2>&1; then
    log "Docker Compose plugin was not found; installing it"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y docker-compose-plugin || fail "Docker Compose plugin installation failed."
  fi
  ensure_portainer
  log "Prerequisites are ready"
}

ensure_portainer(){
  local existing
  existing="$(docker ps -a --format '{{.Names}} {{.Image}}' | awk 'tolower($0) ~ /portainer/ {print $1; exit}')"
  if [[ -n "$existing" ]]; then
    [[ "$(docker inspect -f '{{.State.Running}}' "$existing" 2>/dev/null || true)" == "true" ]] || docker start "$existing" >/dev/null 2>&1 || true
    return
  fi
  if port_busy 9443; then
    warn "Port 9443 is in use. Portainer was not installed automatically; EMS IPAM itself can still run."
    return
  fi
  log "Portainer CE was not found; installing it"
  docker volume create portainer_data >/dev/null
  docker run -d --name portainer --restart=always -p 8000:8000 -p 9443:9443 \
    -v /var/run/docker.sock:/var/run/docker.sock -v portainer_data:/data portainer/portainer-ce:latest >/dev/null
}

download_source(){
  TMP_ROOT="$(mktemp -d /tmp/ems-ipam.XXXXXX)"
  SOURCE_DIR="$TMP_ROOT/source"
  mkdir -p "$SOURCE_DIR"
  if [[ -n "${EMS_INSTALL_SOURCE_DIR:-}" ]]; then
    [[ -d "$EMS_INSTALL_SOURCE_DIR" ]] || fail "EMS_INSTALL_SOURCE_DIR does not exist."
    cp -a "$EMS_INSTALL_SOURCE_DIR/." "$SOURCE_DIR/"
  else
    log "Downloading project from GitHub: ${REPOSITORY}@${REPOSITORY_REF}"
    local archive="$TMP_ROOT/source.tar.gz"
    curl -fsSL --retry 3 --connect-timeout 20 "https://github.com/${REPOSITORY}/archive/refs/heads/${REPOSITORY_REF}.tar.gz" --output "$archive" || fail "Unable to download project from GitHub."
    tar -tzf "$archive" >/dev/null 2>&1 || fail "Downloaded GitHub archive is invalid."
    tar -xzf "$archive" --strip-components=1 -C "$SOURCE_DIR"
  fi
  for f in compose.yml docker-app/Dockerfile docker-app/package.json docker-app/server/main.mjs docker-app/server/schema.sql; do
    [[ -f "$SOURCE_DIR/$f" ]] || fail "Repository is missing required file: $f"
  done
}

compose_core_cmd(){
  docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$INSTALL_DIR/compose.yml" "$@"
}

compose_all_cmd(){
  local cmd=(docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$INSTALL_DIR/compose.yml")
  local fragment dir
  if [[ -d "$INSTALL_DIR/modules" ]]; then
    for fragment in "$INSTALL_DIR"/modules/*/compose.module.yml; do
      [[ -f "$fragment" ]] || continue
      dir="$(dirname "$fragment")"
      [[ -f "$dir/module.json" ]] || continue
      cmd+=(-f "$fragment")
    done
  fi
  "${cmd[@]}" "$@"
}

start_optional_modules(){
  local fragments=() fragment dir
  if [[ -d "$INSTALL_DIR/modules" ]]; then
    for fragment in "$INSTALL_DIR"/modules/*/compose.module.yml; do
      [[ -f "$fragment" ]] || continue
      dir="$(dirname "$fragment")"
      [[ -f "$dir/module.json" ]] || continue
      fragments+=("$fragment")
    done
  fi
  ((${#fragments[@]})) || return 0
  log "Starting optional modules"
  if ! compose_all_cmd up -d --remove-orphans; then
    warn "One or more optional modules failed to start. Core + IPAM remain installed; review the module logs separately."
    compose_core_cmd up -d >/dev/null 2>&1 || true
  fi
}

write_env(){
  local db_pass="$1" admin_user="$2" admin_pass="$3" http_port="$4"
  mkdir -p "$STATE_DIR/backups" "$STATE_DIR/runtime"
  chmod 700 "$STATE_DIR"
  umask 077
  cat > "$ENV_FILE" <<ENV
POSTGRES_DB=ems_ipam
POSTGRES_USER=ems_ipam
POSTGRES_PASSWORD=$db_pass
EMS_ADMIN_USERNAME=$admin_user
EMS_ADMIN_PASSWORD=$admin_pass
EMS_HTTP_PORT=$http_port
EMS_STATE_DIR=$STATE_DIR
EMS_BACKUP_PATH=$STATE_DIR/backups
COOKIE_SECURE=false
TZ=Asia/Tehran
ENV
  chmod 600 "$ENV_FILE"
}

wait_health(){
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  log "Waiting for database and panel health checks"
  local i
  for i in $(seq 1 75); do
    if curl -fsS --max-time 3 "http://127.0.0.1:${EMS_HTTP_PORT}/health" >/dev/null 2>&1; then
      local ip
      ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
      printf '\n[EMS IPAM] READY\nPanel: http://%s:%s\nPortainer: https://%s:9443\nInstall dir: %s\nState dir: %s\n\n' "${ip:-SERVER-IP}" "$EMS_HTTP_PORT" "${ip:-SERVER-IP}" "$INSTALL_DIR" "$STATE_DIR"
      return 0
    fi
    sleep 2
  done
  compose_core_cmd ps >&2 || true
  compose_core_cmd logs --tail=180 app db >&2 || true
  return 1
}

backup_database(){
  [[ -f "$ENV_FILE" ]] || fail "Configuration file is missing; update was stopped before changing files."
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  mkdir -p "$STATE_DIR/backups"
  local db_container file tmp i
  db_container="$(docker ps --filter 'label=com.docker.compose.project=ems-ipam' --filter 'label=com.docker.compose.service=db' --format '{{.Names}}' | head -1)"
  if [[ -z "$db_container" ]]; then
    log "Database is not running; starting it only to create the required pre-update backup"
    compose_core_cmd up -d db >/dev/null || fail "Database could not be started. Update cancelled without changing application files."
    for i in $(seq 1 40); do
      db_container="$(docker ps --filter 'label=com.docker.compose.project=ems-ipam' --filter 'label=com.docker.compose.service=db' --format '{{.Names}}' | head -1)"
      [[ -n "$db_container" ]] && docker exec "$db_container" pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1 && break
      sleep 1
    done
  fi
  [[ -n "$db_container" ]] || fail "Database container is unavailable. Update cancelled without changing application files."
  file="$STATE_DIR/backups/pre-update-$(date +%Y%m%d-%H%M%S).sql.gz"
  tmp="${file}.tmp"
  log "Creating mandatory pre-update database backup"
  rm -f "$tmp"
  if ! docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$db_container" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges | gzip -c > "$tmp"; then
    rm -f "$tmp"
    fail "Database backup failed. Update cancelled; application files and database were not changed."
  fi
  [[ -s "$tmp" ]] || { rm -f "$tmp"; fail "Database backup is empty. Update cancelled without changing application files."; }
  mv "$tmp" "$file"
  chmod 600 "$file"
  log "Pre-update backup verified: $file"
}

install_app(){
  install_prerequisites
  if [[ -d "$INSTALL_DIR" ]]; then
    if [[ -f "$INSTALL_DIR/.ems-ipam-install" ]]; then
      fail "EMS IPAM is already installed in $INSTALL_DIR. Choose Update."
    fi
    local broken="${INSTALL_DIR}.failed.$(date +%Y%m%d-%H%M%S)"
    warn "Incomplete installation directory found; moving it to $broken"
    mv "$INSTALL_DIR" "$broken"
  fi

  download_source
  local preserved=false
  if [[ -f "$ENV_FILE" ]] && docker volume inspect ems_ipam_db_data >/dev/null 2>&1; then
    preserved=true
    log "Preserved database and configuration found; reinstalling the application without changing them"
  elif [[ -f "$ENV_FILE" ]] || docker volume inspect ems_ipam_db_data >/dev/null 2>&1; then
    fail "Only part of a previous installation remains. Choose option 4 for a clean removal, or restore both state and database before installing."
  else
    local db_pass admin_user admin_pass http_port
    log "Installation settings"
    read_secret_twice db_pass "Database password" 8
    [[ "$db_pass" =~ ^[A-Za-z0-9._@%+=:,!^-]+$ ]] || fail "Database password contains unsupported characters. Use letters, numbers, and . _ @ % + = : , ! ^ -"
    read_default admin_user "Admin username" "admin"
    [[ "$admin_user" =~ ^[A-Za-z0-9_.-]{3,64}$ ]] || fail "Admin username must be 3-64 characters using letters, numbers, dot, underscore or hyphen."
    read_secret_twice admin_pass "Admin password" 8
    [[ "$admin_pass" =~ ^[A-Za-z0-9._@%+=:,!^-]+$ ]] || fail "Admin password contains unsupported characters. Use letters, numbers, and . _ @ % + = : , ! ^ -"
    read_default http_port "Web port" "8080"
    [[ "$http_port" =~ ^[0-9]+$ ]] && ((http_port>=1 && http_port<=65535)) || fail "Web port must be between 1 and 65535."
    port_busy "$http_port" && fail "Port $http_port is already in use."
    write_env "$db_pass" "$admin_user" "$admin_pass" "$http_port"
  fi

  mkdir -p "$(dirname "$INSTALL_DIR")"
  local staged="${INSTALL_DIR}.new.$$"
  rm -rf "$staged"
  cp -a "$SOURCE_DIR" "$staged"
  touch "$staged/.ems-ipam-install"
  mv "$staged" "$INSTALL_DIR"
  log "Building and starting EMS IPAM Core + IPAM"
  compose_core_cmd pull db
  compose_core_cmd build --pull app
  compose_core_cmd up -d --remove-orphans
  wait_health || fail "EMS IPAM did not become healthy. Logs are shown above."
  start_optional_modules
}

update_app(){
  install_prerequisites
  [[ -f "$INSTALL_DIR/.ems-ipam-install" && -f "$ENV_FILE" ]] || fail "A valid EMS IPAM installation was not found. Choose Install for a new installation."
  backup_database
  download_source
  local previous="${INSTALL_DIR}.previous.$(date +%Y%m%d-%H%M%S)" staged="${INSTALL_DIR}.new.$$"
  cp -a "$SOURCE_DIR" "$staged"
  touch "$staged/.ems-ipam-install"
  mv "$INSTALL_DIR" "$previous"
  mv "$staged" "$INSTALL_DIR"
  log "Updating application files"
  if compose_core_cmd pull db && compose_core_cmd build --pull app && compose_core_cmd up -d --remove-orphans && wait_health; then
    start_optional_modules
    rm -rf "$previous"
    log "Update completed successfully"
    return
  fi
  warn "Update failed; restoring previous application files"
  compose_core_cmd down --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$INSTALL_DIR"
  mv "$previous" "$INSTALL_DIR"
  compose_core_cmd build app >/dev/null 2>&1 || true
  compose_core_cmd up -d --remove-orphans >/dev/null 2>&1 || true
  wait_health || true
  fail "Update failed and application files were rolled back. Database/state were preserved."
}

uninstall_keep_db(){
  install_prerequisites
  if [[ -f "$ENV_FILE" && -f "$INSTALL_DIR/compose.yml" ]]; then compose_all_cmd down --remove-orphans || true; fi
  rm -rf "$INSTALL_DIR"
  log "Application files were removed. Database volume, configuration and backups were kept in $STATE_DIR."
}

uninstall_all(){
  install_prerequisites
  printf '\nThis permanently deletes EMS IPAM database, settings and backups. Docker and Portainer are kept.\n'
  confirm "Continue with complete removal?" || { log "Cancelled"; return; }
  if [[ -f "$ENV_FILE" && -f "$INSTALL_DIR/compose.yml" ]]; then compose_all_cmd down -v --remove-orphans || true; fi
  docker volume rm -f ems_ipam_db_data >/dev/null 2>&1 || true
  docker network rm ems_ipam_internal >/dev/null 2>&1 || true
  rm -rf "$INSTALL_DIR" "$STATE_DIR" /opt/ems-ipam.previous.* /opt/ems-ipam.failed.* /opt/ems-ipam.new.*
  log "EMS IPAM application and database were removed."
}

menu(){
  printf '\n========================================\n EMS IPAM Setup\n========================================\n'
  printf '1) Install\n2) Update\n3) Uninstall application (keep database)\n4) Uninstall application + database\n'
  printf '========================================\n'
  local choice
  read -r -p 'Select [1-4]: ' choice <"$TTY_DEVICE" || fail "Unable to read menu selection."
  case "$choice" in
    1) install_app ;;
    2) update_app ;;
    3) uninstall_keep_db ;;
    4) uninstall_all ;;
    *) fail "Invalid selection." ;;
  esac
}

menu
