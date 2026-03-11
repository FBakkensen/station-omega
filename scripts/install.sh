#!/bin/bash
# Resolve project root from this script's location (works even if CLAUDE_PROJECT_DIR is unset)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-"$(cd "$(dirname "$0")/.." && pwd)"}"
cd "$PROJECT_DIR"
bun install
cd web && bun install
