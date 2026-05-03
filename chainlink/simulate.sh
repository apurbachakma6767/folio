#!/usr/bin/env bash
# One-command CRE workflow simulation for judges
# Usage: ./simulate.sh
set -euo pipefail

cd "$(dirname "$0")"

echo "=== Folio Collar Oracle — CRE Simulation ==="
echo ""

# Check CRE CLI
if ! command -v cre &>/dev/null; then
  echo "Installing CRE CLI..."
  curl -sSL https://app.chain.link/cre/install.sh | bash
  export PATH="$HOME/.cre/bin:$PATH"
fi

# Install workflow deps
echo "Installing dependencies..."
(cd my-workflow && npm install --silent)

# Start mock server in background
echo "Starting mock server (localhost:8787)..."
npx tsx mock-server/server.ts &
MOCK_PID=$!
trap 'kill $MOCK_PID 2>/dev/null || true' EXIT

# Wait for server to be ready
for i in $(seq 1 20); do
  if curl -s -o /dev/null http://localhost:8787 2>/dev/null; then break; fi
  sleep 0.5
done

# Run simulation with mock secrets
echo ""
echo "Running CRE workflow simulation..."
echo "─────────────────────────────────"
DATA_STREAMS_API_KEY=mock-api-key \
DATA_STREAMS_HMAC_SECRET=mock-hmac-secret \
DATA_STREAMS_TIMESTAMP=auto \
cre workflow simulate ./my-workflow \
  --target staging-settings \
  --skip-type-checks \
  --non-interactive \
  --trigger-index 0

echo ""
echo "Done! Mock server stopped."
