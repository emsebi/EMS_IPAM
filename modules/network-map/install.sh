#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY="${EMS_REPOSITORY:-emsebi/EMS_IPAM}"
REPOSITORY_REF="${EMS_REPOSITORY_REF:-main}"
INSTALL_DIR="${EMS_INSTALL_DIR:-/opt/ems-ipam}"
SOURCE_OVERRIDE="${EMS_MODULE_SOURCE_DIR:-}"
TEMP_DIR=""
PREVIOUS_DIR=""

log() { printf '\n[%s] %s\n' "EMS Network Map" "$*"; }
fail() { printf '\nError: %s\n' "$*" >&2; exit 1; }

cleanup() {
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then rm -rf -- "$TEMP_DIR"; fi
}
trap cleanup EXIT

need_command() { command -v "$1" >/dev/null 2>&1 || fail "Required command '$1' is not installed."; }

set_env_value() {
  local key="$1" value="$2" file="$INSTALL_DIR/.env" temp_file
  temp_file="$(mktemp /tmp/ems-network-map-env.XXXXXX)"
  awk -v key="$key" -v value="$value" 'BEGIN{done=0} $0 ~ "^" key "=" {print key "=\047" value "\047"; done=1; next} {print} END{if(!done) print key "=\047" value "\047"}' "$file" > "$temp_file"
  install -m 600 "$temp_file" "$file"
  rm -f -- "$temp_file"
}

compose_base() {
  compose=(docker compose --project-name ems-ipam --env-file "$INSTALL_DIR/.env" -f "$INSTALL_DIR/compose.yml" --profile network-map)
}

download_module() {
  TEMP_DIR="$(mktemp -d /tmp/ems-network-map.XXXXXX)"
  local source_root="$TEMP_DIR/source"
  mkdir -p "$source_root"
  if [[ -n "$SOURCE_OVERRIDE" ]]; then
    [[ -d "$SOURCE_OVERRIDE" ]] || fail "Module source directory was not found."
    cp -a "$SOURCE_OVERRIDE/." "$source_root/"
    MODULE_SOURCE="$source_root"
  else
    local archive="$TEMP_DIR/source.tar.gz"
    local url="https://github.com/${REPOSITORY}/archive/refs/heads/${REPOSITORY_REF}.tar.gz"
    log "Downloading the latest Network Map module"
    curl -fsSL --retry 3 --connect-timeout 15 --output "$archive" "$url" || fail "Project download failed."
    tar -tzf "$archive" >/dev/null 2>&1 || fail "Downloaded project archive is invalid or incomplete."
    tar -xzf "$archive" --strip-components=1 -C "$source_root"
    MODULE_SOURCE="$source_root/modules/network-map"
  fi
  for required in Dockerfile package.json VERSION server/main.mjs server/schema.sql public/index.html; do
    [[ -f "$MODULE_SOURCE/$required" ]] || fail "Required module file '$required' is missing."
  done
}

wait_for_health() {
  set -a
  source "$INSTALL_DIR/.env"
  set +a
  local port="${EMS_HTTP_PORT:-8080}"
  for ((attempt=1; attempt<=45; attempt+=1)); do
    if curl -fsS --max-time 3 "http://127.0.0.1:${port}/network-map/health" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

rollback_module() {
  local reason="$1"
  if [[ -n "$PREVIOUS_DIR" && -d "$PREVIOUS_DIR" ]]; then
    rm -rf -- "$INSTALL_DIR/modules/network-map"
    mv "$PREVIOUS_DIR" "$INSTALL_DIR/modules/network-map"
    PREVIOUS_DIR=""
    compose_base
    "${compose[@]}" build network-map >/dev/null 2>&1 || true
    "${compose[@]}" up -d network-map app >/dev/null 2>&1 || true
  fi
  fail "$reason The previous module files were restored."
}

enable_or_update() {
  download_module
  mkdir -p "$INSTALL_DIR/modules"
  if [[ -d "$INSTALL_DIR/modules/network-map" ]]; then
    PREVIOUS_DIR="$INSTALL_DIR/modules/.network-map.previous.$$"
    mv "$INSTALL_DIR/modules/network-map" "$PREVIOUS_DIR"
  fi
  cp -a "$MODULE_SOURCE" "$INSTALL_DIR/modules/network-map"
  chmod +x "$INSTALL_DIR/modules/network-map/install.sh"
  set_env_value EMS_NETWORK_MAP_ENABLED true
  compose_base
  log "Building only the Network Map image"
  if ! "${compose[@]}" build --pull network-map; then rollback_module "Module build failed."; fi
  "${compose[@]}" up -d network-map
  # The proxy is recreated from its existing image; the EMS IPAM image is not rebuilt.
  "${compose[@]}" up -d --no-deps --force-recreate app
  if ! wait_for_health; then
    "${compose[@]}" logs --tail 100 network-map >&2 || true
    rollback_module "Network Map did not become healthy."
  fi
  if [[ -n "$PREVIOUS_DIR" && -d "$PREVIOUS_DIR" ]]; then rm -rf -- "$PREVIOUS_DIR"; fi
  PREVIOUS_DIR=""
  printf '\nNetwork Map was updated without rebuilding EMS IPAM.\n'
  printf 'URL: http://SERVER-IP:%s/network-map/\n' "${EMS_HTTP_PORT:-8080}"
}

disable_module() {
  set_env_value EMS_NETWORK_MAP_ENABLED false
  compose_base
  "${compose[@]}" stop network-map >/dev/null 2>&1 || true
  "${compose[@]}" up -d --no-deps --force-recreate app
  printf '\nNetwork Map was disabled. Its database records and files were kept.\n'
}

show_status() {
  compose_base
  "${compose[@]}" ps app network-map db
}

(( EUID == 0 )) || fail "Run this module installer with sudo."
[[ -f "$INSTALL_DIR/.env" && -f "$INSTALL_DIR/compose.yml" ]] || fail "Install or update EMS IPAM first."
grep -q '^[[:space:]]*network-map:' "$INSTALL_DIR/compose.yml" || fail "The installed core is too old. Run the main installer and choose Update once."
for command_name in docker curl tar awk install; do need_command "$command_name"; done
docker info >/dev/null 2>&1 || fail "Docker is not running or is not accessible."
docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is not installed."

ACTION="${1:-update}"
case "${ACTION,,}" in
  update|install|enable) enable_or_update ;;
  disable) disable_module ;;
  status) show_status ;;
  *) fail "Use: update, enable, disable or status." ;;
esac
