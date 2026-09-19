#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR="${EMS_INSTALL_DIR:-/opt/ems-ipam}"
ACTION="${1:-enable}"
ENV_FILE="$INSTALL_DIR/.env"
[[ -f "$ENV_FILE" ]] || { echo "EMS IPAM is not installed in $INSTALL_DIR" >&2; exit 1; }
set_value() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  awk -v key="$key" -v value="$value" 'BEGIN{done=0} $0 ~ "^" key "=" {print key "=\047" value "\047"; done=1; next} {print} END{if(!done) print key "=\047" value "\047"}' "$ENV_FILE" > "$tmp"
  install -m 600 "$tmp" "$ENV_FILE"
  rm -f "$tmp"
}
case "$ACTION" in
  enable|install|update) set_value EMS_RADIUS_ENABLED true ;;
  disable) set_value EMS_RADIUS_ENABLED false ;;
  *) echo "Usage: $0 [enable|disable|update]" >&2; exit 2 ;;
esac
cd "$INSTALL_DIR"
set -a; . "$ENV_FILE"; set +a
BASE=(docker compose --project-name ems-ipam --env-file "$ENV_FILE" -f compose.yml)
if [[ "$ACTION" == "disable" ]]; then
  "${BASE[@]}" --profile radius stop radius || true
else
  "${BASE[@]}" --profile radius build radius
  "${BASE[@]}" --profile radius up -d radius
fi
"${BASE[@]}" up -d --no-deps --force-recreate app
