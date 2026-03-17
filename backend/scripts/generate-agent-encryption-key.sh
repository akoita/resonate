#!/usr/bin/env bash
#
# Generate a 32-byte (256-bit) AES encryption key for agent private key encryption.
#
# Usage:
#   ./backend/scripts/generate-agent-encryption-key.sh
#   ./backend/scripts/generate-agent-encryption-key.sh --env    # output as env var line
#   ./backend/scripts/generate-agent-encryption-key.sh --append  # append to backend/.env
#
# This key is used by CryptoService (KMS_PROVIDER=local) to encrypt
# agent ECDSA private keys before storing in the database.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_DOTENV="$SCRIPT_DIR/../.env"

KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

case "${1:-}" in
  --env)
    echo "AGENT_KEY_ENCRYPTION_KEY=${KEY}"
    ;;
  --append)
    DOTENV="${2:-$DEFAULT_DOTENV}"
    if grep -q "AGENT_KEY_ENCRYPTION_KEY" "$DOTENV" 2>/dev/null; then
      echo "⚠️  AGENT_KEY_ENCRYPTION_KEY already exists in $DOTENV"
      echo "   Current value will NOT be overwritten."
      echo "   To replace, remove the existing line first."
      exit 1
    fi
    echo "" >> "$DOTENV"
    echo "# Agent session key encryption (AES-256-GCM)" >> "$DOTENV"
    echo "AGENT_KEY_ENCRYPTION_KEY=${KEY}" >> "$DOTENV"
    echo "✅ Key appended to $DOTENV"
    ;;
  --help|-h)
    echo "Usage: $0 [--env | --append [path/to/.env]]"
    echo ""
    echo "Options:"
    echo "  (none)    Print raw 64-character hex key"
    echo "  --env     Print as environment variable assignment"
    echo "  --append  Append to backend/.env (or specified path)"
    echo "  --help    Show this help"
    ;;
  *)
    echo "$KEY"
    ;;
esac
