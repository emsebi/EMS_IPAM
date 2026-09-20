#!/usr/bin/env bash
set -Eeuo pipefail

log(){ printf '\n[EMS IPAM] %s\n' "$*"; }
fail(){ printf '\nError: %s\n' "$*" >&2; exit 1; }
have(){ command -v "$1" >/dev/null 2>&1; }
[[ "$(id -u)" -eq 0 ]] || fail "Run with sudo/root."
have apt-get || fail "Automatic prerequisite installation currently supports Debian/Ubuntu."
export DEBIAN_FRONTEND=noninteractive
log "Installing base packages"
apt-get update -y
apt-get install -y ca-certificates curl tar gzip openssl
if ! have docker; then
  log "Installing Docker Engine"
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh
  rm -f /tmp/get-docker.sh
fi
have systemctl && systemctl enable --now docker >/dev/null 2>&1 || true
docker info >/dev/null 2>&1 || fail "Docker daemon is not available."
if ! docker compose version >/dev/null 2>&1; then
  log "Installing Docker Compose plugin"
  apt-get install -y docker-compose-plugin
fi
if ! docker ps -a --format '{{.Names}} {{.Image}}' | grep -qi portainer; then
  log "Installing Portainer CE"
  docker volume create portainer_data >/dev/null
  docker run -d --name portainer --restart=always -p 8000:8000 -p 9443:9443 -v /var/run/docker.sock:/var/run/docker.sock -v portainer_data:/data portainer/portainer-ce:latest >/dev/null
else
  name="$(docker ps -a --format '{{.Names}} {{.Image}}' | awk 'tolower($0) ~ /portainer/ {print $1; exit}')"
  [[ -z "$name" || "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || true)" == "true" ]] || docker start "$name" >/dev/null
fi
log "Prerequisites are ready"
docker --version
docker compose version
