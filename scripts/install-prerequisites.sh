#!/usr/bin/env bash
set -Eeuo pipefail

fail(){ printf '\n[EMS IPAM] ERROR: %s\n' "$*" >&2; exit 1; }
log(){ printf '\n[EMS IPAM] %s\n' "$*"; }

(( EUID == 0 )) || fail "Run with sudo/root."
command -v apt-get >/dev/null 2>&1 || fail "This prerequisite installer currently supports Ubuntu/Debian only."

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl tar gzip coreutils iproute2 gawk grep sed python3 openssl

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  log "Installing Docker Engine and Docker Compose"
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh
  rm -f /tmp/get-docker.sh
fi

systemctl enable --now docker >/dev/null 2>&1 || true
docker info >/dev/null 2>&1 || fail "Docker daemon is not running."
docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is missing."

if ! docker inspect portainer >/dev/null 2>&1; then
  log "Installing Portainer CE"
  docker volume create portainer_data >/dev/null
  docker run -d -p 8000:8000 -p 9443:9443 --name portainer --restart=always -v /var/run/docker.sock:/var/run/docker.sock -v portainer_data:/data portainer/portainer-ce:latest >/dev/null
else
  [[ "$(docker inspect -f '{{.State.Running}}' portainer 2>/dev/null || printf false)" == true ]] || docker start portainer >/dev/null
fi

log "Docker, Docker Compose and Portainer are ready."
