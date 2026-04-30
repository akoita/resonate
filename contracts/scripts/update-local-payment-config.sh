#!/usr/bin/env bash
# update-local-payment-config.sh - write local payment artifact and env config.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BROADCAST_FILE="$PROJECT_ROOT/contracts/broadcast/DeployLocalPayments.s.sol/31337/run-latest.json"
DEPLOYMENTS_DIR="$PROJECT_ROOT/contracts/deployments"
ARTIFACT_FILE="$DEPLOYMENTS_DIR/local-payments.json"
BACKEND_ENV="$PROJECT_ROOT/backend/.env"
WEB_ENV_LOCAL="$PROJECT_ROOT/web/.env.local"
RPC_URL="${RPC_URL:-http://localhost:8545}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required. Install with: sudo apt install jq"
  exit 1
fi

if [[ ! -f "$BROADCAST_FILE" ]]; then
  echo "Error: No local payment deployment broadcast found at:"
  echo "  $BROADCAST_FILE"
  echo ""
  echo "Run 'make deploy-local-payments' first."
  exit 1
fi

CHAIN_ID_HEX=$(curl -sf "$RPC_URL" -X POST \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
  | jq -r '.result' 2>/dev/null || echo "")

if [[ -n "$CHAIN_ID_HEX" && "$CHAIN_ID_HEX" != "null" ]]; then
  CHAIN_ID=$(printf "%d" "$CHAIN_ID_HEX" 2>/dev/null || echo "31337")
else
  CHAIN_ID="31337"
  echo -e "${YELLOW}Warning: Could not detect chain ID from $RPC_URL, defaulting to 31337${NC}"
fi

if [[ "$CHAIN_ID" != "31337" ]]; then
  echo "Error: update-local-payment-config only writes local Anvil artifacts. Detected chain $CHAIN_ID."
  exit 1
fi

contract_addresses() {
  local contract_name="$1"
  jq -r --arg name "$contract_name" \
    '.transactions[] | select(.transactionType == "CREATE" and .contractName == $name) | .contractAddress' \
    "$BROADCAST_FILE"
}

MOCK_USDC="$(contract_addresses MockUSDC | tail -1)"
ETH_ORACLE="$(contract_addresses MockPriceOracle | head -1)"
USDC_ORACLE="$(contract_addresses MockPriceOracle | tail -1)"
REGISTRY="$(contract_addresses PaymentAssetRegistry | tail -1)"
ETH_ORACLE_ADAPTER="$(contract_addresses ChainlinkPriceOracleAdapter | head -1)"
USDC_ORACLE_ADAPTER="$(contract_addresses ChainlinkPriceOracleAdapter | tail -1)"
WETH="$(contract_addresses WrappedNativeMock | tail -1)"

if [[ -z "$MOCK_USDC" || "$MOCK_USDC" == "null" || -z "$ETH_ORACLE" || "$ETH_ORACLE" == "null" || -z "$REGISTRY" || "$REGISTRY" == "null" ]]; then
  echo "Error: local payment deployment is missing MockUSDC, MockPriceOracle, or PaymentAssetRegistry."
  exit 1
fi

mkdir -p "$DEPLOYMENTS_DIR"

ASSETS_JSON=$(jq -cn \
  --arg usdc "$MOCK_USDC" \
  --arg weth "$WETH" \
  '[
    {
      assetId: "local:eth",
      chainId: 31337,
      symbol: "ETH",
      name: "Local Ether",
      kind: "native",
      tokenAddress: "0x0000000000000000000000000000000000000000",
      decimals: 18,
      enabled: true,
      settlement: ["marketplace", "stake", "dispute", "escrow"],
      pricingStrategy: "fixed_test_price"
    },
    {
      assetId: "local:usdc",
      chainId: 31337,
      symbol: "USDC",
      name: "Mock USD Coin",
      kind: "stablecoin",
      tokenAddress: $usdc,
      decimals: 6,
      enabled: true,
      settlement: ["marketplace", "stake", "dispute", "escrow", "x402"],
      pricingStrategy: "fixed_test_price"
    }
  ] + (if ($weth | length) > 0 and $weth != "null" then [{
      assetId: "local:weth",
      chainId: 31337,
      symbol: "WETH",
      name: "Wrapped Local Ether",
      kind: "wrapped_native",
      tokenAddress: $weth,
      decimals: 18,
      enabled: true,
      settlement: ["marketplace"],
      pricingStrategy: "fixed_test_price"
    }] else [] end)')

FUNDING_JSON=$(jq -cn \
  --arg weth "$WETH" \
  '[
    {
      id: "local-eth-fund",
      assetId: "local:eth",
      kind: "local_faucet",
      label: "Fund local ETH",
      description: "Instantly set the local Anvil ETH balance for this wallet.",
      provider: "Anvil",
      endpoint: "/payments/dev/fund",
      requiresWallet: true,
      localOnly: true
    },
    {
      id: "local-usdc-mint",
      assetId: "local:usdc",
      kind: "local_faucet",
      label: "Mint local USDC",
      description: "Mint mock USDC to this wallet for local settlement tests.",
      provider: "MockUSDC",
      endpoint: "/payments/dev/fund",
      requiresWallet: true,
      localOnly: true
    }
  ] + (if ($weth | length) > 0 and $weth != "null" then [{
      id: "local-weth-wrap",
      assetId: "local:weth",
      kind: "local_faucet",
      label: "Wrap local WETH",
      description: "Deposit local Anvil ETH into WrappedNativeMock and transfer WETH to this wallet.",
      provider: "WrappedNativeMock",
      endpoint: "/payments/dev/fund",
      requiresWallet: true,
      localOnly: true
    }] else [] end)')

jq -n \
  --argjson chainId "$CHAIN_ID" \
  --arg network "local" \
  --arg rpcUrl "$RPC_URL" \
  --arg registry "$REGISTRY" \
  --arg ethOracle "$ETH_ORACLE" \
  --arg usdcOracle "$USDC_ORACLE" \
  --arg ethOracleAdapter "$ETH_ORACLE_ADAPTER" \
  --arg usdcOracleAdapter "$USDC_ORACLE_ADAPTER" \
  --argjson assets "$ASSETS_JSON" \
  --argjson funding "$FUNDING_JSON" \
  '{
    network: $network,
    chainId: $chainId,
    rpcUrl: $rpcUrl,
    contracts: {
      PaymentAssetRegistry: $registry,
      MockEthUsdOracle: $ethOracle,
      MockUsdcUsdOracle: $usdcOracle,
      EthUsdOracleAdapter: $ethOracleAdapter,
      UsdcUsdOracleAdapter: $usdcOracleAdapter
    },
    prices: {
      "ETH/USD": "3000",
      "USDC/USD": "1"
    },
    assets: $assets,
    funding: {
      enabled: true,
      options: $funding
    },
    x402: {
      localMode: "local_facilitator",
      fallbackModes: ["mock_facilitator", "quote_only"]
    }
  }' > "$ARTIFACT_FILE"

update_env_var() {
  local var_name="$1"
  local var_value="$2"
  local env_file="$3"

  mkdir -p "$(dirname "$env_file")"
  touch "$env_file"

  if grep -q "^${var_name}=" "$env_file" 2>/dev/null; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s|^${var_name}=.*|${var_name}=${var_value}|" "$env_file"
    else
      sed -i "s|^${var_name}=.*|${var_name}=${var_value}|" "$env_file"
    fi
  else
    echo "${var_name}=${var_value}" >> "$env_file"
  fi
}

ASSETS_ENV=$(jq -c '.assets' "$ARTIFACT_FILE")
FUNDING_ENV=$(jq -c '.funding.options' "$ARTIFACT_FILE")

update_env_var "PAYMENT_ASSETS_JSON" "$ASSETS_ENV" "$BACKEND_ENV"
update_env_var "PAYMENT_DEFAULT_ASSET" "local:usdc" "$BACKEND_ENV"
update_env_var "PAYMENT_ORACLE_MODE" "fixed_test_price" "$BACKEND_ENV"
update_env_var "PAYMENT_FUNDING_OPTIONS_JSON" "$FUNDING_ENV" "$BACKEND_ENV"
update_env_var "PAYMENT_DEV_FAUCET_ENABLED" "true" "$BACKEND_ENV"
update_env_var "PAYMENT_DEV_ARTIFACT_PATH" "contracts/deployments/local-payments.json" "$BACKEND_ENV"
update_env_var "PAYMENT_DEV_FUNDER_ADDRESS" "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" "$BACKEND_ENV"
update_env_var "X402_LOCAL_MODE" "local_facilitator" "$BACKEND_ENV"

update_env_var "NEXT_PUBLIC_PAYMENT_ASSETS_JSON" "$ASSETS_ENV" "$WEB_ENV_LOCAL"
update_env_var "NEXT_PUBLIC_PAYMENT_DEFAULT_ASSET" "local:usdc" "$WEB_ENV_LOCAL"
update_env_var "NEXT_PUBLIC_CHAIN_ID" "31337" "$WEB_ENV_LOCAL"
update_env_var "NEXT_PUBLIC_RPC_URL" "$RPC_URL" "$WEB_ENV_LOCAL"

echo -e "${GREEN}✓ Local payment artifact written:${NC} $ARTIFACT_FILE"
echo -e "${GREEN}✓ backend/.env and web/.env.local updated with local payment config${NC}"
echo ""
echo "Assets:"
jq -r '.assets[] | "  \(.assetId) \(.symbol) \(.tokenAddress)"' "$ARTIFACT_FILE"
