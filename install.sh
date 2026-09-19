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
fail(){ printf '\n[EMS IPAM] ERROR: %s\n' "$*" >&2; exit 1; }
cleanup(){ [[ -n "$TMP_ROOT" && -d "$TMP_ROOT" ]] && rm -rf "$TMP_ROOT" || true; }
trap cleanup EXIT

require_root(){ [[ "${EUID:-$(id -u)}" -eq 0 ]] || fail "Run this installer with sudo/root."; }
have(){ command -v "$1" >/dev/null 2>&1; }

read_default(){
  local __var="$1" prompt="$2" default="$3" value=""
  read -r -p "$prompt [$default]: " value <"$TTY_DEVICE" || fail "Unable to read from terminal."
  printf -v "$__var" '%s' "${value:-$default}"
}

read_secret_twice(){
  local __var="$1" prompt="$2" a="" b=""
  while true; do
    read -r -s -p "$prompt: " a <"$TTY_DEVICE" || fail "Unable to read password."
    printf '\n'
    [[ ${#a} -ge 6 ]] || { printf 'Password must contain at least 6 characters.\n' >&2; continue; }
    read -r -s -p "Confirm password: " b <"$TTY_DEVICE" || fail "Unable to read password confirmation."
    printf '\n'
    [[ "$a" == "$b" ]] || { printf 'Passwords do not match.\n' >&2; continue; }
    printf -v "$__var" '%s' "$a"; return
  done
}

confirm(){
  local prompt="$1" answer=""
  read -r -p "$prompt [y/N]: " answer <"$TTY_DEVICE" || return 1
  [[ "${answer,,}" == "y" || "${answer,,}" == "yes" ]]
}

port_busy(){
  local port="$1"
  if have ss && ss -H -ltn 2>/dev/null | awk -v p=":$port" '$4 ~ p"$" {f=1} END{exit f?0:1}'; then return 0; fi
  docker ps --format '{{.Ports}}' 2>/dev/null | grep -Eq "(^|[,[:space:]])[^,]*:${port}->" && return 0
  return 1
}

install_prerequisites(){
  log "Checking prerequisites"
  if ! have curl || ! have tar || ! have openssl || ! have base64; then
    have apt-get || fail "Automatic prerequisites currently support Debian/Ubuntu. Install curl, tar, openssl and coreutils manually."
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y ca-certificates curl tar openssl coreutils
  fi

  if ! have docker; then
    log "Docker Engine was not found; installing Docker"
    have apt-get || fail "Automatic Docker installation currently supports Debian/Ubuntu."
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y ca-certificates curl
    curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
    sh /tmp/get-docker.sh
    rm -f /tmp/get-docker.sh
  fi

  if have systemctl; then systemctl enable --now docker >/dev/null 2>&1 || true; fi
  docker info >/dev/null 2>&1 || fail "Docker is installed but the Docker daemon is not available."

  if ! docker compose version >/dev/null 2>&1; then
    log "Docker Compose plugin was not found; installing it"
    if have apt-get; then
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -y
      apt-get install -y docker-compose-plugin || fail "Docker Compose plugin installation failed."
    else
      fail "Docker Compose plugin is required."
    fi
  fi

  ensure_portainer
  log "Prerequisites are ready"
}

ensure_portainer(){
  if docker ps -a --format '{{.Names}} {{.Image}}' | grep -qi 'portainer'; then
    local names
    names="$(docker ps -a --format '{{.Names}} {{.Image}}' | awk 'tolower($0) ~ /portainer/ {print $1}' | head -1)"
    if [[ -n "$names" ]] && [[ "$(docker inspect -f '{{.State.Running}}' "$names" 2>/dev/null || true)" != "true" ]]; then
      docker start "$names" >/dev/null 2>&1 || true
    fi
    return 0
  fi
  if port_busy 9443; then
    warn "Port 9443 is already in use, so Portainer was not installed automatically. EMS IPAM does not depend on Portainer to run."
    return 0
  fi
  log "Portainer was not found; installing Portainer CE"
  docker volume create portainer_data >/dev/null
  docker run -d --name portainer --restart=always \
    -p 8000:8000 -p 9443:9443 \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v portainer_data:/data \
    portainer/portainer-ce:latest >/dev/null
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
    curl -fsSL --retry 3 --connect-timeout 20 \
      "https://github.com/${REPOSITORY}/archive/refs/heads/${REPOSITORY_REF}.tar.gz" \
      -o "$archive" || fail "Unable to download project from GitHub."
    tar -tzf "$archive" >/dev/null 2>&1 || fail "Downloaded GitHub archive is invalid."
    tar -xzf "$archive" --strip-components=1 -C "$SOURCE_DIR"
  fi
  for f in compose.yml core/Dockerfile core/package.json core/server/main.mjs core/migrations/001_core.sql; do
    [[ -f "$SOURCE_DIR/$f" ]] || fail "Repository is missing required file: $f"
  done
}

compose_cmd(){
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

write_env(){
  local admin_user="$1" admin_pass="$2" http_port="$3"
  mkdir -p "$STATE_DIR/backups" "$STATE_DIR/runtime"
  chmod 700 "$STATE_DIR"
  local pg_pass secret pass_b64
  pg_pass="$(openssl rand -hex 24)"
  secret="$(openssl rand -hex 32)"
  pass_b64="$(printf '%s' "$admin_pass" | base64 | tr -d '\n')"
  umask 077
  cat > "$ENV_FILE" <<ENV
EMS_HTTP_PORT=$http_port
EMS_ADMIN_USERNAME=$admin_user
EMS_ADMIN_PASSWORD_B64=$pass_b64
POSTGRES_DB=ems_ipam
POSTGRES_USER=ems_ipam
POSTGRES_PASSWORD=$pg_pass
EMS_SESSION_SECRET=$secret
EMS_STATE_DIR=$STATE_DIR
EMS_BACKUP_RETENTION_DAYS=30
TZ=Asia/Tehran
COOKIE_SECURE=false
ENV
  chmod 600 "$ENV_FILE"
}

wait_health(){
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  log "Waiting for EMS IPAM health check"
  local i
  for i in $(seq 1 60); do
    if curl -fsS --max-time 3 "http://127.0.0.1:${EMS_HTTP_PORT}/health" >/dev/null 2>&1; then
      local ip
      ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
      printf '\n[EMS IPAM] READY\nPanel: http://%s:%s\nPortainer: https://%s:9443\n\n' "${ip:-SERVER-IP}" "$EMS_HTTP_PORT" "${ip:-SERVER-IP}"
      return 0
    fi
    sleep 2
  done
  compose_cmd ps >&2 || true
  compose_cmd logs --tail 160 app db >&2 || true
  return 1
}

backup_before_update(){
  [[ -f "$ENV_FILE" ]] || return 0
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  mkdir -p "$STATE_DIR/backups"
  if ! docker ps --format '{{.Names}}' | grep -qx 'ems-ipam-db-1'; then return 0; fi
  local file="$STATE_DIR/backups/pre-update-$(date +%Y%m%d-%H%M%S).sql.gz"
  log "Creating pre-update database backup"
  docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" ems-ipam-db-1 \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges | gzip -c > "$file" || {
      rm -f "$file"; fail "Pre-update database backup failed.";
    }
  chmod 600 "$file"
}

install_app(){
  install_prerequisites
  if [[ -f "$INSTALL_DIR/.ems-ipam-install" && -f "$ENV_FILE" ]]; then
    fail "EMS IPAM is already installed. Run this installer again and choose option 2 (Update)."
  fi

  download_source

  local has_volume=false has_state=false admin_user admin_pass http_port
  docker volume inspect ems_ipam_db_data >/dev/null 2>&1 && has_volume=true || true
  [[ -f "$ENV_FILE" ]] && has_state=true || true

  if [[ "$has_volume" == "true" && "$has_state" == "true" && ! -d "$INSTALL_DIR" ]]; then
    log "Existing database/state found from an application-only uninstall; reinstalling the panel and keeping data"
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    http_port="${EMS_HTTP_PORT:-8080}"
    port_busy "$http_port" && fail "Saved web port $http_port is already in use. Stop the conflicting service or change EMS_HTTP_PORT in $ENV_FILE."
  elif [[ "$has_volume" == "true" || "$has_state" == "true" || -d "$INSTALL_DIR" ]]; then
    fail "Incomplete old EMS IPAM state was detected. Use option 4 for a clean removal. No existing database was modified."
  else
    read_default admin_user "Admin username" "admin"
    [[ "$admin_user" =~ ^[A-Za-z0-9_.-]{3,64}$ ]] || fail "Admin username must be 3-64 characters using letters, numbers, dot, underscore or hyphen."
    read_secret_twice admin_pass "Admin password"
    read_default http_port "Web port" "8080"
    [[ "$http_port" =~ ^[0-9]+$ ]] && (( http_port >= 1 && http_port <= 65535 )) || fail "Web port must be between 1 and 65535."
    port_busy "$http_port" && fail "Port $http_port is already in use. Choose another port."
    log "Preparing persistent application state"
    write_env "$admin_user" "$admin_pass" "$http_port"
  fi

  local staged="${INSTALL_DIR}.new.$$"
  rm -rf "$staged"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  cp -a "$SOURCE_DIR" "$staged"
  touch "$staged/.ems-ipam-install"
  mv "$staged" "$INSTALL_DIR"

  log "Building and starting Core services"
  compose_cmd pull --ignore-buildable 2>/dev/null || compose_cmd pull db
  compose_cmd build --pull
  compose_cmd up -d --remove-orphans
  if ! wait_health; then
    fail "EMS IPAM did not become healthy. Logs are shown above. Installation files were kept for troubleshooting."
  fi
}

update_app(){
  install_prerequisites
  [[ -f "$INSTALL_DIR/.ems-ipam-install" && -f "$ENV_FILE" ]] || fail "No valid EMS IPAM installation was found. Choose option 1 for a new installation."
  backup_before_update
  download_source
  local previous="${INSTALL_DIR}.previous.$(date +%Y%m%d-%H%M%S)"
  local staged="${INSTALL_DIR}.new.$$"
  rm -rf "$staged"
  cp -a "$SOURCE_DIR" "$staged"
  touch "$staged/.ems-ipam-install"

  log "Updating application files"
  mv "$INSTALL_DIR" "$previous"
  mv "$staged" "$INSTALL_DIR"

  if compose_cmd pull --ignore-buildable 2>/dev/null || true; compose_cmd build --pull && compose_cmd up -d --remove-orphans && wait_health; then
    rm -rf "$previous"
    log "Update completed successfully"
    return 0
  fi

  warn "Update failed; rolling back application files"
  compose_cmd down --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$INSTALL_DIR"
  mv "$previous" "$INSTALL_DIR"
  compose_cmd build app >/dev/null 2>&1 || true
  compose_cmd up -d --remove-orphans >/dev/null 2>&1 || true
  wait_health || true
  fail "Update failed and the previous application files were restored."
}

uninstall_keep_db(){
  install_prerequisites
  [[ -f "$ENV_FILE" ]] || fail "No EMS IPAM state file was found."
  if [[ -f "$INSTALL_DIR/compose.yml" ]]; then
    log "Stopping EMS IPAM while keeping database and state"
    compose_cmd down --remove-orphans || true
  fi
  rm -rf "$INSTALL_DIR"
  log "Application removed. Database volume and $STATE_DIR were kept."
}

uninstall_all(){
  install_prerequisites
  printf '\nThis will permanently delete EMS IPAM application data, database volume, settings and backups.\n'
  confirm "Continue with complete removal?" || { log "Cancelled"; return 0; }
  if [[ -f "$ENV_FILE" && -f "$INSTALL_DIR/compose.yml" ]]; then compose_cmd down -v --remove-orphans || true; fi
  docker volume rm -f ems_ipam_db_data >/dev/null 2>&1 || true
  docker network rm ems_ipam_internal >/dev/null 2>&1 || true
  rm -rf "$INSTALL_DIR" "$STATE_DIR" /opt/ems-ipam.failed.* /opt/ems-ipam.previous.*
  log "EMS IPAM application and database were removed. Portainer and Docker were not removed."
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

require_root
case "${1:-}" in
  prereqs) install_prerequisites ;;
  install) install_app ;;
  update) update_app ;;
  uninstall-keep-db) uninstall_keep_db ;;
  uninstall-all) uninstall_all ;;
  "") menu ;;
  *) fail "Unknown command: $1" ;;
esac
