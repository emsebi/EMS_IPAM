#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY="${EMS_REPOSITORY:-emsebi/EMS_IPAM}"
REPOSITORY_REF="${EMS_REPOSITORY_REF:-main}"
INSTALL_DIR="${EMS_INSTALL_DIR:-/opt/ems-ipam}"
STATE_DIR="${EMS_STATE_DIR:-/var/lib/ems-ipam}"
TTY_DEVICE="/dev/tty"
TEMP_DIR=""
SOURCE_DIR=""
SCRIPT_DIR=""
ACTION="${1:-}"
compose=()

log(){ printf '\n[EMS IPAM] %s\n' "$*"; }
warn(){ printf '\n[EMS IPAM] WARNING: %s\n' "$*" >&2; }
fail(){ printf '\n[EMS IPAM] ERROR: %s\n' "$*" >&2; exit 1; }
cleanup(){ [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]] && rm -rf -- "$TEMP_DIR" || true; }
trap cleanup EXIT

if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

read_default(){
  local __var="$1" __prompt="$2" __default="$3" __value=""
  read -r -p "$__prompt [$__default]: " __value <"$TTY_DEVICE" || fail "Unable to read terminal input."
  printf -v "$__var" '%s' "${__value:-$__default}"
}

read_secret_twice(){
  local __var="$1" __prompt="$2" a="" b=""
  while true; do
    read -r -s -p "$__prompt: " a <"$TTY_DEVICE" || fail "Unable to read password."
    printf '\n'
    [[ -n "$a" ]] || { printf 'Password cannot be empty.\n' >&2; continue; }
    [[ "$a" != *"'"* ]] || { printf "Do not use apostrophe (') in the password.\n" >&2; continue; }
    read -r -s -p "Confirm password: " b <"$TTY_DEVICE" || fail "Unable to read password confirmation."
    printf '\n'
    [[ "$a" == "$b" ]] || { printf 'Passwords do not match.\n' >&2; continue; }
    printf -v "$__var" '%s' "$a"
    return
  done
}

confirm(){
  local prompt="$1" default="${2:-no}" answer="" suffix='[y/N]'
  [[ "$default" == yes ]] && suffix='[Y/n]'
  read -r -p "$prompt $suffix: " answer <"$TTY_DEVICE" || return 1
  answer="${answer:-$([[ "$default" == yes ]] && printf y || printf n)}"
  [[ "${answer,,}" =~ ^(y|yes)$ ]]
}

need_root(){ (( EUID == 0 )) || fail "Run this installer with sudo/root."; }

install_prerequisites(){
  log "Checking prerequisites"
  local missing=()
  for c in curl tar awk grep sed ss python3 openssl; do command -v "$c" >/dev/null 2>&1 || missing+=("$c"); done

  if (( ${#missing[@]} > 0 )); then
    command -v apt-get >/dev/null 2>&1 || fail "Automatic prerequisite installation currently supports Ubuntu/Debian only."
    log "Installing base packages: ${missing[*]}"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y ca-certificates curl tar gzip coreutils iproute2 gawk grep sed python3 openssl
  fi

  if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    log "Installing Docker Engine and Docker Compose"
    curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
    sh /tmp/get-docker.sh
    rm -f /tmp/get-docker.sh
  fi

  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable --now docker >/dev/null 2>&1 || true
  fi
  docker info >/dev/null 2>&1 || fail "Docker is installed but the daemon is not running."
  docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is not available."

  if ! docker inspect portainer >/dev/null 2>&1; then
    log "Installing Portainer CE"
    docker volume create portainer_data >/dev/null
    docker run -d \
      -p 8000:8000 \
      -p 9443:9443 \
      --name portainer \
      --restart=always \
      -v /var/run/docker.sock:/var/run/docker.sock \
      -v portainer_data:/data \
      portainer/portainer-ce:latest >/dev/null
  else
    local running
    running="$(docker inspect -f '{{.State.Running}}' portainer 2>/dev/null || printf false)"
    [[ "$running" == true ]] || docker start portainer >/dev/null
  fi
  log "Prerequisites are ready"
}

is_valid_source(){
  local root="$1"
  [[ -f "$root/compose.yml" && -f "$root/docker-app/Dockerfile" && -f "$root/docker-app/package.json" && -f "$root/docker-app/server/main.mjs" && -f "$root/scripts/build-module-registry.py" ]]
}

download_source(){
  TEMP_DIR="$(mktemp -d /tmp/ems-ipam-setup.XXXXXX)"
  SOURCE_DIR="$TEMP_DIR/source"
  mkdir -p "$SOURCE_DIR"

  if [[ -n "${EMS_INSTALL_SOURCE_DIR:-}" ]]; then
    [[ -d "$EMS_INSTALL_SOURCE_DIR" ]] || fail "EMS_INSTALL_SOURCE_DIR does not exist."
    cp -a "$EMS_INSTALL_SOURCE_DIR/." "$SOURCE_DIR/"
  elif [[ -n "$SCRIPT_DIR" ]] && is_valid_source "$SCRIPT_DIR"; then
    log "Using project files next to install.sh"
    cp -a "$SCRIPT_DIR/." "$SOURCE_DIR/"
  else
    log "Downloading project from GitHub: ${REPOSITORY}@${REPOSITORY_REF}"
    local archive="$TEMP_DIR/source.tar.gz"
    curl -fsSL --retry 3 --connect-timeout 15 \
      -o "$archive" \
      "https://github.com/${REPOSITORY}/archive/refs/heads/${REPOSITORY_REF}.tar.gz" \
      || fail "Could not download project from GitHub."
    tar -tzf "$archive" >/dev/null 2>&1 || fail "Downloaded GitHub archive is invalid."
    tar -xzf "$archive" --strip-components=1 -C "$SOURCE_DIR"
  fi

  is_valid_source "$SOURCE_DIR" || fail "Downloaded source is incomplete. Required core files are missing."

  # Legacy module folders from older releases are intentionally ignored unless
  # they contain the new module.env + compose.module.yml contract.
  if [[ -d "$SOURCE_DIR/modules" ]]; then
    while IFS= read -r d; do
      [[ -f "$d/module.env" ]] || warn "Ignoring legacy/incomplete module folder: ${d#$SOURCE_DIR/}"
    done < <(find "$SOURCE_DIR/modules" -mindepth 1 -maxdepth 1 -type d ! -name '_*' -print 2>/dev/null | sort)
  fi
}

module_dirs(){
  local root="$1"
  [[ -d "$root/modules" ]] || return 0
  find "$root/modules" -mindepth 1 -maxdepth 1 -type d ! -name '_*' -exec test -f '{}/module.env' ';' -print 2>/dev/null | sort
}

module_value(){
  local file="$1" key="$2"
  sed -n "s/^${key}=//p" "$file" | tail -n1 | sed -e "s/^['\"]//" -e "s/['\"]$//"
}

build_module_registry(){
  mkdir -p "$INSTALL_DIR/runtime"
  python3 "$INSTALL_DIR/scripts/build-module-registry.py" "$INSTALL_DIR" "$INSTALL_DIR/.env" "$INSTALL_DIR/runtime/modules.json"
}

load_installation(){
  [[ -f "$INSTALL_DIR/.env" && -f "$INSTALL_DIR/compose.yml" ]] || fail "EMS IPAM is not installed correctly in $INSTALL_DIR."
  set -a
  # shellcheck disable=SC1090
  source "$INSTALL_DIR/.env"
  set +a
  compose=(docker compose --project-name ems-ipam --env-file "$INSTALL_DIR/.env" -f "$INSTALL_DIR/compose.yml")
  local d meta compose_file id flag enabled
  while IFS= read -r d; do
    meta="$d/module.env"
    id="$(module_value "$meta" EMS_MODULE_ID)"
    compose_file="$(module_value "$meta" EMS_MODULE_COMPOSE)"
    compose_file="${compose_file:-compose.module.yml}"
    [[ -n "$id" && -f "$d/$compose_file" ]] || { warn "Skipping invalid module folder: ${d#$INSTALL_DIR/}"; continue; }
    compose+=(-f "$d/$compose_file")
    flag="$(module_value "$meta" EMS_MODULE_ENV_FLAG)"
    flag="${flag:-EMS_MODULE_${id^^}_ENABLED}"
    flag="${flag//-/_}"
    enabled="${!flag:-false}"
    [[ "${enabled,,}" == true ]] && compose+=(--profile "$id")
  done < <(module_dirs "$INSTALL_DIR")
  build_module_registry
}

find_previous_env(){
  local candidate
  for candidate in "$STATE_DIR/.env" "$INSTALL_DIR/.env" /opt/ems-ipam-old/.env /opt/ems-ipam.previous*/.env /opt/ems-ipam.failed*/.env; do
    [[ -f "$candidate" ]] && { printf '%s\n' "$candidate"; return 0; }
  done
  return 1
}

prepare_env_for_install(){
  local target="$1" old_env=""
  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"

  if docker volume inspect ems_ipam_database >/dev/null 2>&1; then
    old_env="$(find_previous_env 2>/dev/null || true)"
    if [[ -n "$old_env" ]]; then
      log "Existing EMS IPAM database volume found; reusing saved database credentials"
      cp "$old_env" "$target"
      chmod 600 "$target"
      return 0
    fi
    fail "An existing EMS IPAM database volume was found, but its saved credentials were not found. Use Update if this is an existing installation, or use option 4 only if you intentionally want to delete the database."
  fi

  local POSTGRES_PASSWORD EMS_ADMIN_USERNAME EMS_ADMIN_PASSWORD EMS_HTTP_PORT COOKIE_SECURE
  POSTGRES_PASSWORD="$(openssl rand -hex 24)"
  read_default EMS_ADMIN_USERNAME "Admin username" "admin"
  read_secret_twice EMS_ADMIN_PASSWORD "Admin password"
  read_default EMS_HTTP_PORT "Web port" "8080"
  [[ "$EMS_HTTP_PORT" =~ ^[0-9]+$ ]] && (( EMS_HTTP_PORT >= 1 && EMS_HTTP_PORT <= 65535 )) || fail "Web port must be between 1 and 65535."
  read_default COOKIE_SECURE "COOKIE_SECURE (false for HTTP, true for HTTPS)" "false"
  [[ "${COOKIE_SECURE,,}" =~ ^(true|false)$ ]] || fail "COOKIE_SECURE must be true or false."

  umask 077
  cat > "$target" <<ENVEOF
POSTGRES_PASSWORD='$POSTGRES_PASSWORD'
EMS_ADMIN_USERNAME='$EMS_ADMIN_USERNAME'
EMS_ADMIN_PASSWORD='$EMS_ADMIN_PASSWORD'
EMS_HTTP_PORT='$EMS_HTTP_PORT'
COOKIE_SECURE='$COOKIE_SECURE'
EMS_BACKUP_PATH='$INSTALL_DIR/backups'
ENVEOF
}

save_state(){
  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  [[ -f "$INSTALL_DIR/.env" ]] && install -m 600 "$INSTALL_DIR/.env" "$STATE_DIR/.env"
  if [[ -d "$INSTALL_DIR/backups" ]]; then
    mkdir -p "$STATE_DIR/backups"
    cp -a "$INSTALL_DIR/backups/." "$STATE_DIR/backups/" 2>/dev/null || true
  fi
}

start_and_check(){
  load_installation
  log "Pulling database image"
  "${compose[@]}" pull db
  log "Building EMS IPAM"
  "${compose[@]}" build --pull
  log "Starting EMS IPAM"
  "${compose[@]}" up -d --remove-orphans

  log "Waiting for application health check"
  local attempt ip
  for attempt in $(seq 1 60); do
    if curl -fsS --max-time 2 "http://127.0.0.1:${EMS_HTTP_PORT}/health" >/dev/null 2>&1; then
      ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
      save_state
      printf '\nEMS IPAM started successfully.\n'
      printf 'Panel: http://%s:%s\n' "${ip:-SERVER-IP}" "$EMS_HTTP_PORT"
      printf 'Portainer: https://%s:9443\n' "${ip:-SERVER-IP}"
      printf 'Install directory: %s\n' "$INSTALL_DIR"
      return 0
    fi
    sleep 2
  done

  printf '\nApplication health check failed. Current status:\n' >&2
  "${compose[@]}" ps >&2 || true
  printf '\nRecent logs:\n' >&2
  "${compose[@]}" logs --tail 150 app db >&2 || true
  return 1
}

install_app(){
  install_prerequisites

  if [[ -e "$INSTALL_DIR" ]]; then
    if [[ -f "$INSTALL_DIR/.env" && -f "$INSTALL_DIR/compose.yml" ]]; then
      fail "A valid installation already exists in $INSTALL_DIR. Choose option 2 (Update)."
    fi
    local failed_dir="${INSTALL_DIR}.failed.$(date +%Y%m%d-%H%M%S)"
    warn "Incomplete old installation found. Moving it to $failed_dir"
    mv "$INSTALL_DIR" "$failed_dir"
  fi

  download_source
  mkdir -p "$SOURCE_DIR/backups" "$SOURCE_DIR/runtime"
  printf '[]\n' > "$SOURCE_DIR/runtime/modules.json"
  prepare_env_for_install "$SOURCE_DIR/.env"

  mkdir -p "$(dirname "$INSTALL_DIR")"
  mv "$SOURCE_DIR" "$INSTALL_DIR"
  SOURCE_DIR=""
  chmod 600 "$INSTALL_DIR/.env"
  chmod 700 "$INSTALL_DIR/backups"
  chown -R 1000:1000 "$INSTALL_DIR/backups" 2>/dev/null || true

  if ! start_and_check; then
    fail "Installation did not become healthy. The logs above show the failing service."
  fi
}

backup_database(){
  load_installation
  mkdir -p "$INSTALL_DIR/backups"
  "${compose[@]}" up -d db
  local file="$INSTALL_DIR/backups/ems-ipam-$(date -u +%Y%m%dT%H%M%SZ).dump"
  "${compose[@]}" exec -T db pg_dump -U ems_ipam -d ems_ipam -Fc > "$file"
  chmod 600 "$file"
  save_state
  printf 'Database backup: %s\n' "$file"
}

update_app(){
  install_prerequisites
  load_installation
  backup_database
  download_source

  cp "$INSTALL_DIR/.env" "$SOURCE_DIR/.env"
  mkdir -p "$SOURCE_DIR/backups" "$SOURCE_DIR/runtime"
  cp -a "$INSTALL_DIR/backups/." "$SOURCE_DIR/backups/" 2>/dev/null || true
  printf '[]\n' > "$SOURCE_DIR/runtime/modules.json"

  local old_dir="${INSTALL_DIR}.previous.$(date +%Y%m%d-%H%M%S)"
  "${compose[@]}" down --remove-orphans
  mv "$INSTALL_DIR" "$old_dir"
  mv "$SOURCE_DIR" "$INSTALL_DIR"
  SOURCE_DIR=""
  chmod 600 "$INSTALL_DIR/.env"

  if start_and_check; then
    rm -rf "$old_dir"
    log "Update completed successfully"
  else
    warn "Update failed; restoring previous application files"
    rm -rf "$INSTALL_DIR"
    mv "$old_dir" "$INSTALL_DIR"
    load_installation
    "${compose[@]}" up -d --remove-orphans || true
    fail "Update failed and the previous version was restored."
  fi
}

uninstall_keep_db(){
  install_prerequisites
  if [[ -f "$INSTALL_DIR/.env" && -f "$INSTALL_DIR/compose.yml" ]]; then
    load_installation
    backup_database || warn "Automatic backup failed; continuing only after confirmation."
    save_state
    "${compose[@]}" down --remove-orphans
  else
    warn "No complete installation directory was found."
  fi

  if confirm "Remove EMS IPAM application files but KEEP the database volume and saved recovery settings?" no; then
    rm -rf "$INSTALL_DIR"
    docker image rm ems-ipam:0.7.1 >/dev/null 2>&1 || true
    printf '\nApplication removed. Database volume ems_ipam_database was kept.\nRecovery settings: %s\n' "$STATE_DIR"
  else
    printf 'Cancelled.\n'
  fi
}

uninstall_all(){
  install_prerequisites
  printf '\nWARNING: This will permanently remove the EMS IPAM database and backups.\n'
  local token=""
  read -r -p "Type DELETE to continue: " token <"$TTY_DEVICE" || exit 1
  [[ "$token" == DELETE ]] || { printf 'Cancelled.\n'; return 0; }

  if [[ -f "$INSTALL_DIR/.env" && -f "$INSTALL_DIR/compose.yml" ]]; then
    load_installation
    "${compose[@]}" down --volumes --remove-orphans || true
  else
    docker rm -f ems-ipam-app-1 ems-ipam-db-1 >/dev/null 2>&1 || true
    docker volume rm ems_ipam_database >/dev/null 2>&1 || true
    docker network rm ems_ipam_internal >/dev/null 2>&1 || true
  fi
  rm -rf "$INSTALL_DIR" "$STATE_DIR"
  docker image rm ems-ipam:0.7.1 >/dev/null 2>&1 || true
  printf '\nEMS IPAM application, database and saved backups/settings were removed.\n'
}

show_menu(){
  printf '\n========================================\n'
  printf ' EMS IPAM Setup\n'
  printf '========================================\n'
  printf '1) Install\n'
  printf '2) Update\n'
  printf '3) Uninstall application (keep database)\n'
  printf '4) Uninstall application + database\n'
  printf '========================================\n'
  read -r -p 'Select [1-4]: ' ACTION <"$TTY_DEVICE" || fail "Unable to read menu selection."
}

need_root
[[ -r "$TTY_DEVICE" ]] || fail "Interactive terminal is required."
[[ -n "$ACTION" ]] || show_menu

case "${ACTION,,}" in
  1|install) install_app ;;
  2|update) update_app ;;
  3|uninstall|remove) uninstall_keep_db ;;
  4|purge|delete) uninstall_all ;;
  *) fail "Invalid option. Choose 1, 2, 3 or 4." ;;
esac
