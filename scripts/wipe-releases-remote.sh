#!/usr/bin/env bash
# Wipe all releases from the dev environment.
#
# Usage:
#   ./scripts/wipe-releases-remote.sh                  # uses .env.deploy.dev
#   API_URL=http://localhost:3001 TOKEN=... ./scripts/wipe-releases-remote.sh   # custom
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Source deploy env if available
if [[ -f "$ROOT_DIR/.env.deploy.dev" ]]; then
  set -a; source "$ROOT_DIR/.env.deploy.dev" 2>/dev/null; set +a
fi

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

# Also clean GCS
BUCKET="${GCS_STEMS_BUCKET:-resonate-stems-dev}"
echo ""
echo "🪣 Cleaning GCS: gs://$BUCKET/stems/..."
gsutil -m rm -r "gs://$BUCKET/stems/" 2>/dev/null && echo "   Done." || echo "   Bucket already clean or gsutil unavailable."

echo ""
echo "🎉 Wipe complete!"
