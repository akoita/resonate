#!/usr/bin/env bash
# Wipe all releases from the dev environment.
#
# Usage:
#   ./backend/scripts/wipe-releases-remote.sh
#   API_URL=http://localhost:3001 TOKEN=... ./backend/scripts/wipe-releases-remote.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load local env files when present so NEXT_PUBLIC_API_URL and GCS_STEMS_BUCKET resolve.
for env_file in "$PROJECT_ROOT/backend/.env" "$PROJECT_ROOT/web/.env.local"; do
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file" 2>/dev/null || true
    set +a
  fi
done

API_URL="${NEXT_PUBLIC_API_URL:-${API_URL:-http://localhost:3001}}"

echo "🔑 Getting auth token..."
# You need to provide a JWT token. If you have one cached, set TOKEN env var.
if [[ -z "${TOKEN:-}" ]]; then
  echo "❌ No TOKEN provided."
  echo ""
  echo "Get a token from the browser DevTools:"
  echo "  1. Open the app in browser"
  echo "  2. Open DevTools > Application > Local Storage"
  echo "  3. Copy the 'token' value"
  echo "  4. Run: TOKEN=<your-token> $0"
  exit 1
fi

echo "🎯 Target: $API_URL"
echo ""

# Get current count first
echo "📊 Current state:"
RELEASES=$(curl -s "$API_URL/catalog/releases" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else d.get('total',len(d.get('items',[]))))" 2>/dev/null || echo "?")
echo "   Releases: $RELEASES"
echo ""

read -p "⚠️  Delete ALL releases from $API_URL? [y/N] " -r
if [[ ! "$REPLY" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "🗑️  Wiping..."
RESULT=$(curl -s -X DELETE "$API_URL/admin/wipe-releases" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

echo "$RESULT" | python3 -m json.tool 2>/dev/null || echo "$RESULT"

echo ""
if [[ -n "${GCS_STEMS_BUCKET:-${BUCKET:-}}" ]]; then
  BUCKET_NAME="${GCS_STEMS_BUCKET:-${BUCKET:-}}"
  echo "🪣 Cleaning GCS: gs://$BUCKET_NAME/stems/..."
  gsutil -m rm -r "gs://$BUCKET_NAME/stems/" 2>/dev/null && echo "   Done." || echo "   Bucket already clean or gsutil unavailable."
else
  echo "🪣 Skipping GCS cleanup. Set GCS_STEMS_BUCKET to remove remote stem objects."
fi

echo ""
echo "🎉 Wipe complete!"
