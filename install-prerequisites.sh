#!/usr/bin/env bash
set -Eeuo pipefail

PORTAINER_ENABLED="true"
TTY_DEVICE="/dev/tty"

log() { printf '\n[%s] %s\n' "EMS prerequisites" "$*"; }
fail() { printf '\nError: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage:
  sudo bash install-prerequisites.sh [--with-portainer|--without-portainer]

Installs Docker Engine and the Docker Compose plugin from Docker's official
repository on supported Ubuntu or Debian systems. Portainer CE is installed by
default and can be skipped with --without-portainer.
EOF
}

while (( $# )); do
  case "$1" in
    --with-portainer) PORTAINER_ENABLED="true" ;;
    --without-portainer) PORTAINER_ENABLED="false" ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
  shift
done

[[ "${EUID}" -eq 0 ]] || fail "Run this script with sudo or as root."
[[ -r /etc/os-release ]] || fail "Unable to identify this Linux distribution."

# shellcheck disable=SC1091
source /etc/os-release
case "${ID:-}" in
  ubuntu)
    DOCKER_DIST="ubuntu"
    DOCKER_SUITE="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
    ;;
  debian)
    DOCKER_DIST="debian"
    DOCKER_SUITE="${VERSION_CODENAME:-}"
    ;;
  *)
    fail "This installer supports Ubuntu and Debian. Install Docker manually on '${PRETTY_NAME:-this system}'."
    ;;
esac

[[ -n "$DOCKER_SUITE" ]] || fail "The distribution codename is missing from /etc/os-release."

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "Docker Engine and Docker Compose are already installed; existing containers are unchanged."
    systemctl enable --now docker >/dev/null 2>&1 || true
    return
  fi

  log "Installing Docker Engine and Docker Compose from Docker's official repository"
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl

  if command -v docker >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-plugin || \
      fail "Docker exists, but the Compose plugin could not be installed. Review the current Docker installation first."
    systemctl enable --now docker
    return
  fi

  local conflicts=()
  local package
  for package in docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc; do
    if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q "install ok installed"; then
      conflicts+=("$package")
    fi
  done
  if (( ${#conflicts[@]} )); then
    fail "Conflicting packages are installed: ${conflicts[*]}. Remove or migrate them deliberately before installing Docker CE."
  fi

  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${DOCKER_DIST}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc

  local architecture
  architecture="$(dpkg --print-architecture)"
  {
    printf 'Types: deb\n'
    printf 'URIs: https://download.docker.com/linux/%s\n' "$DOCKER_DIST"
    printf 'Suites: %s\n' "$DOCKER_SUITE"
    printf 'Components: stable\n'
    printf 'Architectures: %s\n' "$architecture"
    printf 'Signed-By: /etc/apt/keyrings/docker.asc\n'
  } > /etc/apt/sources.list.d/docker.sources

  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
}

install_portainer() {
  [[ "$PORTAINER_ENABLED" == "true" ]] || {
    log "Portainer was skipped. It is optional and does not affect EMS IPAM."
    return
  }

  if docker container inspect portainer >/dev/null 2>&1; then
    if [[ "$(docker inspect -f '{{.State.Running}}' portainer 2>/dev/null)" != "true" ]]; then
      log "Starting the existing Portainer container"
      docker start portainer >/dev/null
    else
      log "Portainer is already running; its data and settings are unchanged."
    fi
    return
  fi

  if command -v ss >/dev/null 2>&1 && ss -H -ltn | awk '$4 ~ /:9443$/ {busy=1} END {exit(busy ? 0 : 1)}'; then
    fail "TCP port 9443 is already in use. Docker is ready, but Portainer was not installed."
  fi

  log "Installing Portainer CE LTS on HTTPS port 9443"
  docker volume inspect portainer_data >/dev/null 2>&1 || docker volume create portainer_data >/dev/null
  docker run -d \
    --name portainer \
    --restart=always \
    -p 9443:9443 \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v portainer_data:/data \
    portainer/portainer-ce:lts >/dev/null
}

install_docker
docker version >/dev/null 2>&1 || fail "Docker was installed, but the daemon is not responding."
docker compose version >/dev/null 2>&1 || fail "The Docker Compose plugin is not available."
install_portainer

SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
log "Prerequisites are ready"
docker --version
docker compose version
if [[ "$PORTAINER_ENABLED" == "true" ]] && docker container inspect portainer >/dev/null 2>&1; then
  printf 'Portainer: https://%s:9443\n' "${SERVER_IP:-SERVER-IP}"
  printf 'The first visit uses a self-signed certificate and asks you to create the Portainer administrator.\n'
fi
printf '\nNext step:\n'
printf 'curl -fsSL https://raw.githubusercontent.com/emsebi/EMS_IPAM/main/install.sh | sudo bash\n'
