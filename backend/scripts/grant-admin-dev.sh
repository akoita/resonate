#!/usr/bin/env bash
#
# Grant local-dev admin access to a wallet address by updating backend/.env.
#
# Usage:
#   ./backend/scripts/grant-admin-dev.sh 0x1234...
#   ./backend/scripts/grant-admin-dev.sh 0x1234... --env-file /tmp/backend.env
#
# This helper is intentionally local-dev only:
# - it edits a local dotenv file instead of adding a product/API feature
# - it refuses to run against production-style env files
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_DOTENV="$SCRIPT_DIR/../.env"
DOTENV="$DEFAULT_DOTENV"
ADDRESS=""

usage() {
  cat <<EOF
Usage: $0 <wallet-address> [--env-file path/to/.env]

Examples:
  $0 0x81af4ed89d245b4fd9b84cf748668ff4ffe866fa
  $0 0x81af4ed89d245b4fd9b84cf748668ff4ffe866fa --env-file /tmp/backend.env

Notes:
  - This is a local-dev helper only.
  - After updating ADMIN_ADDRESSES, restart the backend and reconnect the wallet.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      if [[ $# -lt 2 ]]; then
        echo "❌ Missing path after --env-file" >&2
        usage
        exit 1
      fi
      DOTENV="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      if [[ -n "$ADDRESS" ]]; then
        echo "❌ Unexpected extra argument: $1" >&2
        usage
        exit 1
      fi
      ADDRESS="$1"
      shift
      ;;
  esac
done

if [[ -z "$ADDRESS" ]]; then
  echo "❌ Wallet address is required." >&2
  usage
  exit 1
fi

if [[ ! "$ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "❌ Invalid wallet address: $ADDRESS" >&2
  exit 1
fi

mkdir -p "$(dirname "$DOTENV")"
touch "$DOTENV"

get_env_value() {
  local key="$1"
  local file="$2"
  (grep -E "^${key}=" "$file" 2>/dev/null || true) | tail -n 1 | cut -d= -f2-
}

node_env="$(get_env_value "NODE_ENV" "$DOTENV")"
app_env="$(get_env_value "APP_ENV" "$DOTENV")"
deploy_env="$(get_env_value "ENV" "$DOTENV")"

if [[ "${NODE_ENV:-}" == "production" || "${APP_ENV:-}" == "production" || "${ENV:-}" == "production" ]]; then
  echo "❌ Refusing to run with current shell production env variables." >&2
  echo "   This helper is for local development only." >&2
  exit 1
fi

if [[ "${node_env:-}" == "production" || "${app_env:-}" == "production" || "${deploy_env:-}" == "production" ]]; then
  echo "❌ Refusing to edit $DOTENV because it appears to be a production env file." >&2
  echo "   This helper is for local development only." >&2
  exit 1
fi

normalized_address="$(printf '%s' "$ADDRESS" | tr '[:upper:]' '[:lower:]')"
existing="$(get_env_value "ADMIN_ADDRESSES" "$DOTENV")"

declare -a merged=()
if [[ -n "${existing:-}" ]]; then
  IFS=',' read -r -a existing_values <<< "$existing"
  for value in "${existing_values[@]}"; do
    trimmed="$(printf '%s' "$value" | xargs)"
    if [[ -n "$trimmed" ]]; then
      merged+=("$(printf '%s' "$trimmed" | tr '[:upper:]' '[:lower:]')")
    fi
  done
fi
merged+=("$normalized_address")

deduped_csv="$(
  printf '%s\n' "${merged[@]}" \
    | awk 'NF && !seen[$0]++' \
    | paste -sd, -
)"

tmp_file="$(mktemp)"
if grep -q '^ADMIN_ADDRESSES=' "$DOTENV" 2>/dev/null; then
  sed "s|^ADMIN_ADDRESSES=.*|ADMIN_ADDRESSES=${deduped_csv}|" "$DOTENV" > "$tmp_file"
else
  cat "$DOTENV" > "$tmp_file"
  if [[ -s "$tmp_file" ]]; then
    printf '\n' >> "$tmp_file"
  fi
  printf 'ADMIN_ADDRESSES=%s\n' "$deduped_csv" >> "$tmp_file"
fi
mv "$tmp_file" "$DOTENV"

echo "✅ Added $normalized_address to ADMIN_ADDRESSES in $DOTENV"
echo "   Restart the backend, then disconnect and reconnect the wallet to receive an admin JWT."
