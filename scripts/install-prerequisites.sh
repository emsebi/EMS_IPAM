#!/usr/bin/env bash
set -Eeuo pipefail
curl -fsSL https://raw.githubusercontent.com/emsebi/EMS_IPAM/main/install.sh | sudo bash -s -- prereqs
