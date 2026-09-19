#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY="${EMS_REPOSITORY:-emsebi/EMS_IPAM}"
REPOSITORY_REF="${EMS_REPOSITORY_REF:-main}"
INSTALL_DIR="${EMS_INSTALL_DIR:-/opt/ems-ipam}"
SOURCE_OVERRIDE="${EMS_INSTALL_SOURCE_DIR:-}"
TTY_DEVICE="/dev/tty"
TEMP_DIR=""
SOURCE_DIR=""
compose=()

log(){ printf '\n[EMS IPAM] %s\n' "$*"; }
fail(){ printf '\nError: %s\n' "$*" >&2; exit 1; }
cleanup(){ [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]] && rm -rf -- "$TEMP_DIR" || true; }
trap cleanup EXIT
need(){ command -v "$1" >/dev/null 2>&1 || fail "Required command '$1' is not installed."; }

read_default(){ local __v="$1" __p="$2" __d="$3" x=""; read -r -p "$__p [$__d]: " x <"$TTY_DEVICE" || fail "Unable to read input."; printf -v "$__v" '%s' "${x:-$__d}"; }
read_yes_no(){ local __v="$1" __p="$2" __d="$3" x="" suffix='[Y/n]'; [[ "$__d" == false ]] && suffix='[y/N]'; while true; do read -r -p "$__p $suffix: " x <"$TTY_DEVICE" || fail "Unable to read input."; x="${x:-$([[ "$__d" == true ]] && printf y || printf n)}"; case "${x,,}" in y|yes|1|true) printf -v "$__v" true; return;; n|no|0|false) printf -v "$__v" false; return;; esac; done; }
read_secret_twice(){ local __v="$1" __p="$2" a="" b=""; while true; do read -r -s -p "$__p: " a <"$TTY_DEVICE" || fail "Unable to read password."; printf '\n'; [[ -n "$a" ]] || { printf 'Password cannot be empty.\n' >&2; continue; }; [[ "$a" != *"'"* ]] || { printf "Do not use apostrophe in password.\n" >&2; continue; }; read -r -s -p "Confirm password: " b <"$TTY_DEVICE"; printf '\n'; [[ "$a" == "$b" ]] || { printf 'Passwords do not match.\n' >&2; continue; }; printf -v "$__v" '%s' "$a"; return; done; }

set_env_value(){ local key="$1" value="$2" file="$INSTALL_DIR/.env" tmp; tmp="$(mktemp)"; awk -v k="$key" -v v="$value" 'BEGIN{d=0} $0 ~ "^" k "=" {print k "=\047" v "\047"; d=1; next} {print} END{if(!d) print k "=\047" v "\047"}' "$file" >"$tmp"; install -m 600 "$tmp" "$file"; rm -f "$tmp"; }

module_dirs(){ find "$1/modules" -mindepth 1 -maxdepth 1 -type d ! -name '_*' -print 2>/dev/null | sort; }
module_value(){ local file="$1" key="$2"; sed -n "s/^${key}=//p" "$file" | tail -n1 | sed -e "s/^['\"]//" -e "s/['\"]$//"; }
validate_modules(){ local root="$1" d f id compose_file; while IFS= read -r d; do f="$d/module.env"; [[ -f "$f" ]] || fail "Missing module.env in $d"; id="$(module_value "$f" EMS_MODULE_ID)"; [[ "$id" =~ ^[a-z0-9][a-z0-9-]*$ ]] || fail "Invalid module id: $id"; compose_file="$(module_value "$f" EMS_MODULE_COMPOSE)"; compose_file="${compose_file:-compose.module.yml}"; [[ -f "$d/$compose_file" ]] || fail "Missing $compose_file for module $id"; done < <(module_dirs "$root"); }

download_source(){
  TEMP_DIR="$(mktemp -d /tmp/ems-ipam-setup.XXXXXX)"; SOURCE_DIR="$TEMP_DIR/source"; mkdir -p "$SOURCE_DIR"
  if [[ -n "$SOURCE_OVERRIDE" ]]; then [[ -d "$SOURCE_OVERRIDE" ]] || fail "Source directory not found."; cp -a "$SOURCE_OVERRIDE/." "$SOURCE_DIR/"; else
    local u="https://github.com/${REPOSITORY}/archive/refs/heads/${REPOSITORY_REF}.tar.gz" a="$TEMP_DIR/source.tar.gz"
    curl -fsSL --retry 3 --connect-timeout 15 -o "$a" "$u" || fail "Project download failed."
    tar -xzf "$a" --strip-components=1 -C "$SOURCE_DIR"
  fi
  for f in compose.yml docker-app/Dockerfile docker-app/package.json docker-app/server/main.mjs scripts/build-module-registry.py; do [[ -e "$SOURCE_DIR/$f" ]] || fail "Required file missing: $f"; done
  validate_modules "$SOURCE_DIR"
}

ensure_module_flags(){ local root="$1" envfile="$2" d f id flag default val; while IFS= read -r d; do f="$d/module.env"; id="$(module_value "$f" EMS_MODULE_ID)"; flag="$(module_value "$f" EMS_MODULE_ENV_FLAG)"; flag="${flag:-EMS_MODULE_${id^^}_ENABLED}"; flag="${flag//-/_}"; default="$(module_value "$f" EMS_MODULE_DEFAULT)"; val=false; [[ "${default^^}" =~ ^(ON|TRUE|YES|1)$ ]] && val=true; grep -q "^${flag}=" "$envfile" || printf "%s='%s'\n" "$flag" "$val" >>"$envfile"; done < <(module_dirs "$root"); }

select_modules(){ local root="$1" envfile="$2" d f id name flag default defbool selected; while IFS= read -r d; do f="$d/module.env"; id="$(module_value "$f" EMS_MODULE_ID)"; name="$(module_value "$f" EMS_MODULE_NAME)"; flag="$(module_value "$f" EMS_MODULE_ENV_FLAG)"; flag="${flag:-EMS_MODULE_${id^^}_ENABLED}"; flag="${flag//-/_}"; default="$(module_value "$f" EMS_MODULE_DEFAULT)"; defbool=false; [[ "${default^^}" =~ ^(ON|TRUE|YES|1)$ ]] && defbool=true; read_yes_no selected "Enable module: ${name:-$id}" "$defbool"; printf "%s='%s'\n" "$flag" "$selected" >>"$envfile"; done < <(module_dirs "$root"); }

load_installation(){
  [[ -f "$INSTALL_DIR/.env" && -f "$INSTALL_DIR/compose.yml" ]] || fail "EMS IPAM is not installed in $INSTALL_DIR"
  set -a; source "$INSTALL_DIR/.env"; set +a
  compose=(docker compose --project-name ems-ipam --env-file "$INSTALL_DIR/.env" -f "$INSTALL_DIR/compose.yml")
  local d f id cf flag enabled
  while IFS= read -r d; do f="$d/module.env"; id="$(module_value "$f" EMS_MODULE_ID)"; cf="$(module_value "$f" EMS_MODULE_COMPOSE)"; cf="${cf:-compose.module.yml}"; compose+=(-f "$d/$cf"); flag="$(module_value "$f" EMS_MODULE_ENV_FLAG)"; flag="${flag:-EMS_MODULE_${id^^}_ENABLED}"; flag="${flag//-/_}"; enabled="${!flag:-false}"; [[ "${enabled,,}" == true ]] && compose+=(--profile "$id"); done < <(module_dirs "$INSTALL_DIR")
  python3 "$INSTALL_DIR/scripts/build-module-registry.py" "$INSTALL_DIR" "$INSTALL_DIR/.env" "$INSTALL_DIR/runtime/modules.json"
}

start_and_check(){
  load_installation
  log "Pulling database image"; "${compose[@]}" pull db
  log "Building services"; "${compose[@]}" build --pull
  log "Starting services"; "${compose[@]}" up -d --remove-orphans
  log "Checking application health"
  for _ in $(seq 1 60); do if curl -fsS --max-time 2 "http://127.0.0.1:${EMS_HTTP_PORT}/health" >/dev/null 2>&1; then local ip; ip="$(hostname -I 2>/dev/null | awk '{print $1}')"; printf '\nOperation completed successfully.\nPanel URL: http://%s:%s\nInstallation directory: %s\n' "${ip:-SERVER-IP}" "$EMS_HTTP_PORT" "$INSTALL_DIR"; return 0; fi; sleep 2; done
  "${compose[@]}" ps >&2 || true; "${compose[@]}" logs --tail 120 app db >&2 || true; return 1
}

install_app(){
  [[ ! -e "$INSTALL_DIR" ]] || fail "Installation directory already exists: $INSTALL_DIR"
  read_secret_twice POSTGRES_PASSWORD "POSTGRES_PASSWORD"
  read_default EMS_ADMIN_USERNAME "EMS_ADMIN_USERNAME" admin
  read_secret_twice EMS_ADMIN_PASSWORD "EMS_ADMIN_PASSWORD"
  read_default EMS_HTTP_PORT "EMS_HTTP_PORT" 8080
  [[ "$EMS_HTTP_PORT" =~ ^[0-9]+$ ]] && (( EMS_HTTP_PORT>=1 && EMS_HTTP_PORT<=65535 )) || fail "Invalid port."
  read_default COOKIE_SECURE "COOKIE_SECURE (true/false)" false
  download_source; mkdir -p "$SOURCE_DIR/backups" "$SOURCE_DIR/runtime"; printf '[]\n' >"$SOURCE_DIR/runtime/modules.json"
  umask 077; { printf "POSTGRES_PASSWORD='%s'\nEMS_ADMIN_USERNAME='%s'\nEMS_ADMIN_PASSWORD='%s'\nEMS_HTTP_PORT='%s'\nCOOKIE_SECURE='%s'\nEMS_BACKUP_PATH='%s'\n" "$POSTGRES_PASSWORD" "$EMS_ADMIN_USERNAME" "$EMS_ADMIN_PASSWORD" "$EMS_HTTP_PORT" "$COOKIE_SECURE" "$INSTALL_DIR/backups"; select_modules "$SOURCE_DIR" /dev/stdout; } >"$SOURCE_DIR/.env"
  mkdir -p "$(dirname "$INSTALL_DIR")"; mv "$SOURCE_DIR" "$INSTALL_DIR"; chmod 600 "$INSTALL_DIR/.env"; chmod 700 "$INSTALL_DIR/backups"; chown -R 1000:1000 "$INSTALL_DIR/backups"
  start_and_check || fail "The application did not become healthy. Logs are shown above."
}

backup_database(){ load_installation; mkdir -p "$INSTALL_DIR/backups"; "${compose[@]}" up -d db; local f="$INSTALL_DIR/backups/ems-ipam-$(date -u +%Y%m%dT%H%M%SZ).dump"; "${compose[@]}" exec -T db pg_dump -U ems_ipam -d ems_ipam -Fc >"$f"; chmod 600 "$f"; printf 'Backup created: %s\n' "$f"; }

update_app(){
  load_installation; backup_database; download_source; ensure_module_flags "$SOURCE_DIR" "$INSTALL_DIR/.env"; cp -a "$INSTALL_DIR/.env" "$SOURCE_DIR/.env"; mkdir -p "$SOURCE_DIR/backups" "$SOURCE_DIR/runtime"; cp -a "$INSTALL_DIR/backups/." "$SOURCE_DIR/backups/" 2>/dev/null || true
  local old="${INSTALL_DIR}.previous.$$"; "${compose[@]}" down --remove-orphans; mv "$INSTALL_DIR" "$old"; mv "$SOURCE_DIR" "$INSTALL_DIR"; chmod 600 "$INSTALL_DIR/.env"
  if start_and_check; then rm -rf "$old"; else rm -rf "$INSTALL_DIR"; mv "$old" "$INSTALL_DIR"; load_installation; "${compose[@]}" up -d || true; fail "Update failed; previous version restored."; fi
}

configure_modules(){ load_installation; local d f id name flag cur req; while IFS= read -r d; do f="$d/module.env"; id="$(module_value "$f" EMS_MODULE_ID)"; name="$(module_value "$f" EMS_MODULE_NAME)"; flag="$(module_value "$f" EMS_MODULE_ENV_FLAG)"; flag="${flag:-EMS_MODULE_${id^^}_ENABLED}"; flag="${flag//-/_}"; cur="${!flag:-false}"; read_yes_no req "Enable module: ${name:-$id}" "$cur"; set_env_value "$flag" "$req"; done < <(module_dirs "$INSTALL_DIR"); load_installation; "${compose[@]}" up -d --build --remove-orphans; }

restore_database(){ load_installation; local f="${2:-}"; [[ -n "$f" ]] || read -r -p "Backup .dump path: " f <"$TTY_DEVICE"; [[ -f "$f" ]] || fail "Backup not found."; backup_database; "${compose[@]}" stop app; "${compose[@]}" exec -T db pg_restore -U ems_ipam -d ems_ipam --clean --if-exists --no-owner --no-privileges <"$f"; "${compose[@]}" up -d; }
uninstall_app(){ load_installation; "${compose[@]}" down --remove-orphans; printf 'Containers removed; database volume and files were kept.\n'; }
uninstall_all(){ load_installation; local x; read -r -p "Type DELETE to remove app, database and backups: " x <"$TTY_DEVICE"; [[ "$x" == DELETE ]] || exit 0; "${compose[@]}" down --volumes --remove-orphans; [[ "$INSTALL_DIR" == /opt/* ]] || fail "Unsafe install path."; rm -rf "$INSTALL_DIR"; }
show_menu(){ printf '\nEMS IPAM Setup\n1) Install\n2) Update\n3) Backup Database\n4) Restore Database\n5) Enable/Disable Modules\n6) Uninstall App (keep DB)\n7) Uninstall All\n'; read -r -p 'Select [1-7]: ' ACTION <"$TTY_DEVICE"; }

(( EUID == 0 )) || fail "Run with sudo."
[[ -r "$TTY_DEVICE" ]] || fail "Interactive terminal required."
for c in docker curl tar ss awk grep sed install python3 seq; do need "$c"; done
docker info >/dev/null 2>&1 || fail "Docker is not running."; docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is missing."
ACTION="${1:-}"; [[ -n "$ACTION" ]] || show_menu
case "${ACTION,,}" in 1|install) install_app;; 2|update) update_app;; 3|backup) backup_database;; 4|restore) restore_database "$@";; 5|modules) configure_modules;; 6|uninstall) uninstall_app;; 7|purge) uninstall_all;; *) fail "Invalid option.";; esac
