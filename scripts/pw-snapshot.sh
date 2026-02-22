#!/usr/bin/env bash
set -euo pipefail

mkdir -p qa-artifacts

timestamp="$(date -u +"%Y-%m-%dT%H-%M-%SZ")"
output_path="${1:-qa-artifacts/pw-snapshot-${timestamp}.yml}"

bun run pw -- snapshot --filename="${output_path}"
