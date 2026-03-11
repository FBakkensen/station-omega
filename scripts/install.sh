#!/bin/bash
cd "$CLAUDE_PROJECT_DIR"
bun install
cd web && bun install
