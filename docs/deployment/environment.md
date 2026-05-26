# Resonate Environment Variables

Application environment variables live here when they affect app code, local
runtime behavior, or contract-adjacent tooling. Infrastructure-only variables
belong in `resonate-iac`.

When adding a new environment variable:

1. Document it in the table below.
2. Add it to the relevant Terraform or service configuration in `resonate-iac`
   when it is used by deployed infrastructure.
3. Keep secrets in secret managers or GitHub environment secrets, never in
   source.

## Core App Variables

| Variable | Scope | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | Frontend | Defaults to `http://localhost:3001` in local app workflows |
| `NEXT_PUBLIC_X402_RPC_URL` | Frontend | Optional browser RPC URL for x402 wallet network switching when using a non-default x402 chain |
| `NEXT_PUBLIC_CHAIN_ID` | Frontend | `31337` for local Anvil, `11155111` for Sepolia fork mode, `84532` for Base Sepolia staging |
| `NEXT_PUBLIC_RPC_URL` | Frontend | Optional RPC override. Use for local/fork AA flows; deployed builds otherwise fall back to the chain default RPC. |
| `NEXT_PUBLIC_EXPLORER_URL` | Frontend | Optional block explorer base URL used for address and transaction links. Leave unset for local Anvil. |
| `NEXT_PUBLIC_SHOWS_EXPLORER_BASE_URL` | Frontend | Optional block explorer address base URL used by Shows campaign contract links. Defaults to Sepolia Etherscan for local seeded demos. |
| `NEXT_PUBLIC_AA_BUNDLER` | Frontend | Optional public bundler override; when unset the browser falls back to `/api/bundler` unless a public Pimlico key is provided |
| `NEXT_PUBLIC_AA_PAYMASTER_ENABLED` | Frontend | Optional flag (`true` / `1` / `yes`) to attach a ZeroDev paymaster client to browser UserOps. Leave unset when wallet gas sponsorship is not configured so transactions self-pay from the smart account ETH balance |
| `NEXT_PUBLIC_PIMLICO_API_KEY` | Frontend | Optional public Pimlico key. Leave unset when using server-side bundler config via `/api/bundler` |
| `NEXT_PUBLIC_ZERODEV_PROJECT_ID` | Frontend | Optional ZeroDev project ID. When set, passkey login uses the hosted ZeroDev passkey server instead of the self-hosted backend passkey store |
| `NEXT_PUBLIC_PASSKEY_SERVER_URL` | Frontend server runtime | Optional hosted passkey server URL. If it ends with a ZeroDev project UUID, the frontend derives `NEXT_PUBLIC_ZERODEV_PROJECT_ID` from it for backward-compatible passkey login |
| `NEXT_PUBLIC_PASSKEY_RP_ID` | Frontend | Optional WebAuthn relying-party ID override. Leave unset for normal hostname-based passkeys; set only to recover or intentionally share passkeys across subdomains |
| `RPC_URL` | Backend | RPC endpoint used by contract-aware backend flows |
| `GCP_PROJECT_ID` | Backend | Recommended explicit GCP project for Pub/Sub-backed ingestion; when unset in Cloud Run the backend can also derive the project from Application Default Credentials |
| `ANALYTICS_WAREHOUSE_PROJECT_ID` | Backend | Optional analytics warehouse project/target id for export metadata. Falls back to `GCP_PROJECT_ID`, then `local` for local development. |
| `ANALYTICS_WAREHOUSE_DATASET_PREFIX` | Backend | Optional dataset/table prefix for analytics export layer metadata. Defaults to `analytics_local` for local development. |
| `ANALYTICS_WAREHOUSE_TARGET` | Backend | Warehouse loader target provider. Defaults to `local_json`, which writes idempotent JSONL layer files outside process memory. Set `bigquery_insert_all` to stream rows to BigQuery through Google ADC. |
| `ANALYTICS_WAREHOUSE_LOCAL_DIR` | Backend | Output directory for the `local_json` analytics warehouse target. Defaults to `.analytics/warehouse` in the backend process working directory. |
| `ANALYTICS_WAREHOUSE_SUPPORTED_EVENT_VERSIONS` | Backend | Comma-separated analytics event versions that may be promoted into clean/fact/view layers. Defaults to `1`; unsupported versions are loaded raw and quarantined. |
| `ANALYTICS_REPORT_SOURCE` | Backend | Artist analytics read source. Defaults to local `warehouse_export`; set `bigquery` to read dashboard facts/views from BigQuery through Google ADC. |
| `ANALYTICS_BIGQUERY_PROJECT_ID` | Backend | Optional BigQuery reporting project override. Falls back to `ANALYTICS_WAREHOUSE_PROJECT_ID`, `GCP_PROJECT_ID`, then warehouse config. |
| `ANALYTICS_BIGQUERY_DATASET` | Backend | Optional BigQuery reporting dataset override. Falls back to `ANALYTICS_WAREHOUSE_DATASET_PREFIX`. |
| `ANALYTICS_BIGQUERY_FACTS_TABLE` | Backend | Optional facts table id for artist reporting. Defaults to `analytics_facts`. |
| `ANALYTICS_BIGQUERY_VIEWS_TABLE` | Backend | Optional views table id for artist reporting. Defaults to `analytics_views`. |
| `ANALYTICS_BIGQUERY_CACHE_TTL_SECONDS` | Backend | Optional in-process cache TTL for identical artist/time-window BigQuery report reads. Defaults to `60`. |
| `ANALYTICS_BIGQUERY_MAXIMUM_BYTES_BILLED` | Backend | Optional BigQuery query cost guard for artist report reads. Defaults to `500000000` bytes. |
| `ANALYTICS_BIGQUERY_QUERY_TIMEOUT_MS` | Backend | Optional timeout for each BigQuery reporting query. Defaults to `10000`. |
| `ANALYTICS_BIGQUERY_ROW_LIMIT` | Backend | Optional row limit per facts/views query to bound response size. Defaults to `10000`. |
| `ANALYTICS_BIGQUERY_API_BASE_URL` | Backend | Optional BigQuery API base URL override for tests or private endpoints. Defaults to the public BigQuery API. |
| `ANALYTICS_ACTOR_ID_SALT` | Backend | Optional salt for deriving pseudonymous analytics actor IDs from authenticated user IDs before emitting product and playback analytics events. Falls back to `JWT_SECRET`, then a local-dev salt. Set per environment and rotate only with a planned analytics identity migration. |
| `AGENT_TASTE_SIGNAL_SOURCE` | Backend | Optional agent taste signal provider. Defaults to disabled; set `bigquery` to blend precomputed BigQuery user-track scores into AI DJ recommendation ranking. |
| `AGENT_TASTE_BIGQUERY_PROJECT_ID` | Backend | Optional BigQuery project override for agent taste scores. Falls back to analytics BigQuery/warehouse project config. |
| `AGENT_TASTE_BIGQUERY_DATASET` | Backend | Optional BigQuery dataset override for agent taste scores. Falls back to analytics BigQuery/warehouse dataset config. |
| `AGENT_TASTE_BIGQUERY_CLEAN_TABLE` | Data/ML tooling | Optional clean analytics events table used by `workers/analytics-dataflow/run-agent-taste-materialization.sh`. Defaults to `events_clean`. |
| `AGENT_TASTE_BIGQUERY_TRAINING_TABLE` | Data/ML tooling | Optional training signal table used by Agent Taste verification queries. Defaults to `user_track_signal_training`. |
| `AGENT_TASTE_BIGQUERY_SCORES_TABLE` | Backend | Optional BigQuery table id containing `user_id`, `track_id`, and normalized `recommendation_score` rows. Defaults to `user_track_recommendation_scores`. |
| `AGENT_TASTE_MATERIALIZATION_PROJECT_ID` | Data/ML tooling | Optional BigQuery project override for the Agent Taste materialization runner. Falls back to agent taste, analytics BigQuery, warehouse, and GCP project config. |
| `AGENT_TASTE_MATERIALIZATION_VERSION` | Data/ML tooling | Optional version label written to materialized Agent Taste score rows. Defaults to the current baseline version in the runner. |
| `AGENT_TASTE_BIGQUERY_MAXIMUM_BYTES_BILLED` | Backend | Optional BigQuery query cost guard for agent taste score reads. Defaults to `100000000` bytes. |
| `AGENT_TASTE_BIGQUERY_QUERY_TIMEOUT_MS` | Backend | Optional timeout for agent taste score queries. Defaults to `5000`. |
| `AGENT_TASTE_BIGQUERY_ROW_LIMIT` | Backend | Optional maximum taste score rows returned per selector call. Defaults to `100`. |
| `AGENT_TASTE_BIGQUERY_API_BASE_URL` | Backend | Optional BigQuery API base URL override for tests or private endpoints. Defaults to the analytics BigQuery API base URL, then the public BigQuery API. |
| `ANALYTICS_EVENT_PUBLISHING_ENABLED` | Backend | Enables publishing validated analytics event envelopes to Pub/Sub after ledger persistence. Defaults to disabled. |
| `ANALYTICS_EVENT_PUBLISHING_STRICT` | Backend | When true, Pub/Sub publish failures fail analytics ingestion. Defaults to false so user flows keep working while failures are logged. |
| `ANALYTICS_EVENT_PUBSUB_PROJECT_ID` | Backend | Optional Pub/Sub project override for analytics event publishing. Falls back to `GCP_PROJECT_ID`, `GOOGLE_CLOUD_PROJECT`, or `GCLOUD_PROJECT`. |
| `ANALYTICS_EVENT_PUBSUB_TOPIC` | Backend | Pub/Sub topic name for analytics event envelopes, typically provisioned by `resonate-iac` as `resonate-<env>-analytics-events`. |
| `ANALYTICS_RETENTION_PERSONAL_DAYS` | Backend | Optional personal raw analytics event retention window. Defaults to `395` days. |
| `ANALYTICS_RETENTION_SENSITIVE_DAYS` | Backend | Optional sensitive raw analytics event retention window. Defaults to `90` days. |
| `ANALYTICS_RETENTION_PSEUDONYMOUS_DAYS` | Backend | Optional pseudonymous raw analytics event retention window. Defaults to `730` days. |
| `DEMUCS_CLOUD_RUN_JOB_PROJECT` | Backend | Optional project for on-demand Demucs Cloud Run Job execution. Defaults to `GCP_PROJECT_ID` when unset |
| `DEMUCS_CLOUD_RUN_JOB_REGION` | Backend | Cloud Run region for on-demand Demucs jobs |
| `DEMUCS_CLOUD_RUN_JOB_NAME` | Backend | Cloud Run Job name to execute after publishing each `stem-separate` message |
| `GCP_BILLING_QUOTA_PROJECT` | CI | Optional quota/billing project for Cloud Build submission; deploy CI defaults it to `GCP_PROJECT_ID` |
| `GCP_CLOUD_BUILD_SOURCE_STAGING_DIR` | CI | Optional Cloud Storage prefix for `gcloud builds submit` source archives; deploy CI defaults it from `GCP_PROJECT_ID` |
| `GCP_CLOUD_BUILD_POLLING_INTERVAL_SECONDS` | CI | Optional Cloud Build polling interval for image publishing. Defaults to `10` seconds to avoid Cloud Build get-request quota spikes when multiple images publish in parallel |
| `ANALYTICS_DATAFLOW_ARTIFACT_REGISTRY_REPOSITORY` | CI | Optional Artifact Registry repository for the analytics Dataflow Flex Template image. Defaults to `resonate-<environment>` |
| `ANALYTICS_DATAFLOW_TEMPLATE_BUCKET` | CI | Optional GCS bucket for analytics Dataflow template, staging, and temp artifacts. Defaults to `<GCP_PROJECT_ID>-analytics-dataflow` |
| `ANALYTICS_DATAFLOW_TEMPLATE_PREFIX` | CI | Optional GCS prefix for analytics Dataflow `template.json`. Defaults to `templates/<environment>/analytics-dataflow` |
| `ANALYTICS_DATAFLOW_TEMPLATE_GCS_PATH` | CI | Optional full `gs://.../template.json` override for the analytics Dataflow Flex Template publish workflow |
| `AA_BUNDLER` | Backend / frontend server runtime | Server-side bundler URL used by account-abstraction flows and the `/api/bundler` proxy |
| `PIMLICO_API_KEY` | Frontend server runtime | Optional server-side Pimlico key used by `/api/bundler` without exposing it to the browser |
| `FRONTEND_URL` | Backend | Public frontend origin used for generated metadata links, self-hosted WebAuthn fallback, and CORS allowlisting |
| `CORS_ORIGIN` | Backend | Optional comma-separated browser origins allowed to call the backend. Defaults include local dev and also derives from `FRONTEND_URL` / `WEBAUTHN_ORIGIN` |
| `CORS_ORIGINS` | Backend | Optional plural alias for `CORS_ORIGIN` |
| `WEBAUTHN_RP_ID` | Backend | Optional relying-party ID for self-hosted passkey credentials. Usually the frontend hostname, without protocol |
| `WEBAUTHN_ORIGIN` | Backend | Optional relying-party origin for self-hosted passkey verification. Usually the frontend HTTPS origin |
| `SEPOLIA_RPC_URL` | Contracts / backend | Required for Sepolia deploys and forked workflows |
| `BASE_SEPOLIA_RPC_URL` | Contracts / backend | Required for Base Sepolia protocol deploys and single-chain x402 staging |
| `CONTRACT_DEPLOYER_PRIVATE_KEY` | Contracts secret | Preferred GitHub Actions deployer key for `.github/workflows/contracts-deploy.yml`. Use protected GitHub environments; do not store in source. Existing local scripts still read `PRIVATE_KEY` |
| `ALLOW_DEFAULT_ANVIL_PRIVATE_KEY` | Contracts | Explicit override that lets Forge scripts use the default Anvil key on a non-local RPC. Leave unset in shared remote environments. |
| `ETHERSCAN_API_KEY` | Contracts secret | Optional Etherscan API v2 key used for Base Sepolia contract verification. Store in secret manager/GitHub environment secrets when used in CI |
| `BASESCAN_API_KEY` | Contracts secret | Backward-compatible alias for `ETHERSCAN_API_KEY` in Base Sepolia verification scripts |
| `BASESCAN_API_URL` | Contracts | Optional verification API override. Defaults to `https://api.etherscan.io/v2/api`, which requires a key/plan with Base Sepolia API access |
| `VERIFY_CONTRACTS` | Contracts | Optional Base Sepolia deploy verification switch. Defaults to `auto`: verify when an explorer API key is set, skip otherwise. Set `false` to force-disable verification |
| `BROADCAST_FILE` | Contracts | Optional broadcast JSON path for Base Sepolia verification retry commands; defaults to the latest Base Sepolia deployment |
| `VERIFY_RETRIES` / `VERIFY_DELAY_SECONDS` | Contracts | Optional BaseScan retry tuning for `make verify-base-sepolia`; defaults to `8` retries and `15` seconds |
| `SOURCIFY_API_URL` | Contracts | Optional Sourcify server override for `make verify-base-sepolia-sourcify`; defaults to `https://sourcify.dev/server` |
| `SOURCIFY_RETRIES` / `SOURCIFY_DELAY_SECONDS` | Contracts | Optional Sourcify retry tuning for `make verify-base-sepolia-sourcify`; defaults to `12` retries and `5` seconds |
| `STEM_NFT_ADDRESS` / `MARKETPLACE_ADDRESS` / `TRANSFER_VALIDATOR_ADDRESS` | Contracts | Required/optional references for the partial `deploy-content-protection` GitHub workflow operation; set `MARKETPLACE_ADDRESS` when the existing marketplace must receive registrar permission |
| `CONTENT_PROTECTION_PROXY` | Contracts | Required for the `upgrade-content-protection` GitHub workflow operation |
| `CONTENT_PROTECTION_ADDRESS` | Contracts / backend | Existing ContentProtection proxy address; required for stake-policy update workflows and backend contract-aware flows |
| `STAKE_ASSET_ADDRESS` / `STAKE_ASSET_AMOUNT` / `STAKE_ASSET_SYMBOL` | Contracts | Optional stake-policy update workflow inputs; `STAKE_ASSET_ADDRESS` can fall back to `PAYMENT_USDC_ADDRESS` |
| `SHOW_CAMPAIGN_ESCROW_OWNER` | Contracts | Optional owner/multisig for deploying `ShowCampaignEscrow`; defaults to the deployer |
| `SHOW_CAMPAIGN_ESCROW_ADDRESS` | Backend / frontend | Deployed Shows escrow address used by pledge execution and event reconciliation once Shows moves beyond backend receipts |
| `NEXT_PUBLIC_SHOW_CAMPAIGN_ESCROW_ADDRESS` | Frontend | Public default Shows escrow address promoted from `contracts/deployments/show-campaign-escrow.<network>.remote.env`; individual campaigns still come from backend `contractAddress` / `contractCampaignId` records |
| `SHOWS_DEFAULT_PAYMENT_TOKEN_ADDRESS` | Backend | Optional default ERC-20 payment token for artist-created show campaigns; normal artists cannot choose arbitrary payment token addresses |
| `SHOWS_ALLOWED_PAYMENT_TOKEN_ADDRESSES` | Backend | Optional comma-separated allowlist of ERC-20 payment tokens accepted by Shows campaign drafts and pledge intents |
| `TRUST_STAKE_WEI_NEW` | Backend | Optional override for the new-creator content-protection stake requirement |
| `TRUST_STAKE_WEI_ESTABLISHED` | Backend | Optional override for the established-tier content-protection stake requirement |
| `TRUST_STAKE_WEI_TRUSTED` | Backend | Optional override for the trusted-tier content-protection stake requirement |
| `TRUST_STAKE_USD_NEW` | Backend | Optional canonical USD stake requirement for new creators; quoted into the selected stake asset |
| `TRUST_STAKE_USD_ESTABLISHED` | Backend | Optional canonical USD stake requirement for established creators; quoted into the selected stake asset |
| `TRUST_STAKE_USD_TRUSTED` | Backend | Optional canonical USD stake requirement for trusted creators; quoted into the selected stake asset |
| `TRUST_STAKE_USD_MIN` | Backend | Optional protocol minimum canonical USD stake requirement per release track. Defaults to `5`, keeping USDC upload staking at 5 USDC per release track |
| `AGENT_KEY_ENCRYPTION_KEY` | Backend | Generate with `./backend/scripts/generate-agent-encryption-key.sh` for local KMS mode |
| `X402_ENABLED` | Backend | Enables the x402 payment and storefront purchase surfaces |
| `X402_PAYOUT_ADDRESS` | Backend | Required when x402 is enabled; receives USDC payments |
| `X402_NETWORK` | Backend | CAIP-2 network id for x402 (`eip155:84532` Base Sepolia or `eip155:8453` Base mainnet) |
| `X402_RPC_URL` | Backend | Optional RPC used to verify in-app smart-account x402 payments; falls back to the configured Base/Base Sepolia/local RPC |
| `X402_FACILITATOR_URL` | Backend | x402 verify/settle endpoint; set explicitly for Base mainnet |
| `X402_CONTRACT_SETTLEMENT_ENABLED` | Backend | Optional opt-in flag for listed-stem x402 redemptions to execute marketplace contract settlement before download |
| `X402_SETTLEMENT_PRIVATE_KEY` | Backend secret | Required only when `X402_CONTRACT_SETTLEMENT_ENABLED=true`; private key for the payout/settlement wallet. Store in secret manager/GitHub environment secrets, never source |
| `X402_LOCAL_MODE` | Backend | Local-only x402 behavior: `local_facilitator`, `mock_facilitator`, or `quote_only`. Generated by `make payments-dev-up` for local Anvil |
| `PAYMENT_ASSETS_JSON` | Backend | JSON array of chain-scoped payment assets. Local Anvil values are generated from `contracts/deployments/local-payments.json` |
| `PAYMENT_DEFAULT_ASSET` | Backend | Default app payment asset id for the active chain, such as `local:usdc` |
| `PAYMENT_ORACLE_MODE` | Backend | Payment quote oracle mode. Local Anvil uses `fixed_test_price`; deployed environments should use configured feeds or explicit testnet mocks |
| `PAYMENT_ASSET_PRICES_JSON` | Backend | Optional USD quote inputs keyed by asset id, symbol, or `SYMBOL/USD`. Values may be a decimal price or `{ "priceUsd": "3000", "updatedAt": "...", "maxAgeSeconds": 3600 }`; used for fixed local prices and Chainlink-compatible quote snapshots |
| `PAYMENT_QUOTE_TTL_SECONDS` | Backend | Optional lifetime for backend payment quotes returned by `/payments/quote`. Defaults to `60` |
| `PAYMENT_QUOTE_MAX_STALENESS_SECONDS` | Backend | Optional maximum age for timestamped backend oracle price entries. Defaults to `3600` |
| `PAYMENT_FUNDING_OPTIONS_JSON` | Backend | JSON array of environment-aware funding actions exposed by the payment UX |
| `SHOWS_DEFAULT_CHAIN_ID` | Backend | Optional chain ID default for newly created Shows signals/campaign drafts. Falls back to `PAYMENT_CHAIN_ID`, `AA_CHAIN_ID`, `CHAIN_ID`, then Base Sepolia local/staging default. |
| `SHOWS_DEFAULT_PAYMENT_ASSET_SYMBOL` | Backend | Optional display symbol default for newly created Shows signals/campaign drafts. Defaults to `USDC`. |
| `PAYMENT_BASE_SEPOLIA_ETH_FAUCET_URL` | Backend | Optional Base Sepolia test ETH faucet URL. When set and no full funding JSON is provided, `/payments/funding-options` exposes a testnet ETH faucet action |
| `PAYMENT_BASE_SEPOLIA_ETH_FAUCET_PROVIDER` | Backend | Optional display name for the configured Base Sepolia ETH faucet |
| `PAYMENT_BASE_SEPOLIA_USDC_FAUCET_URL` | Backend | Optional Base Sepolia Circle USDC faucet URL. When set and no full funding JSON is provided, `/payments/funding-options` exposes a testnet USDC faucet action |
| `PAYMENT_BASE_SEPOLIA_USDC_FAUCET_PROVIDER` | Backend | Optional display name for the configured Base Sepolia USDC faucet; defaults to `Circle` |
| `PAYMENT_DEV_FAUCET_ENABLED` | Backend | Enables local-only payment funding endpoints. Must be `true` only on local Anvil |
| `PAYMENT_DEV_ARTIFACT_PATH` | Backend | Optional path to the generated local payment artifact. Defaults to `contracts/deployments/local-payments.json` |
| `PAYMENT_DEV_FUNDER_ADDRESS` | Backend | Local Anvil unlocked account used to send mock-token mint transactions for `POST /payments/dev/fund` |
| `PAYMENT_USDC_ADDRESS` | Contracts | Optional deployed USDC token address configured into the protocol payment asset registry during contract deployment |
| `PAYMENT_WETH_ADDRESS` | Contracts | Optional deployed WETH token address configured into the protocol payment asset registry during contract deployment |
| `PAYMENT_ENABLE_WETH` | Contracts | Enables WETH in the deployed payment asset registry when `PAYMENT_WETH_ADDRESS` is set. Defaults to `false` |
| `STAKE_USDC_AMOUNT` | Contracts | Optional USDC-denominated content-protection stake amount per release track, in USDC base units, configured when `PAYMENT_USDC_ADDRESS` is set. Defaults to `5000000` (5 USDC) |
| `STAKE_ASSET_ADDRESS` | Contracts | Optional ERC-20 address for `make sync-content-protection-stablecoin-stake`; falls back to `PAYMENT_USDC_ADDRESS` |
| `STAKE_ASSET_AMOUNT` | Contracts | Optional ERC-20 stake amount for `make sync-content-protection-stablecoin-stake`; falls back to `STAKE_USDC_AMOUNT`, then `5000000` |
| `STAKE_ASSET_SYMBOL` | Contracts | Optional display label for `make sync-content-protection-stablecoin-stake`; defaults to `USDC` |
| `PAYMENT_ETH_USD_FEED` | Contracts | Optional Chainlink-compatible ETH/USD feed address wrapped by the deployed oracle adapter |
| `PAYMENT_USDC_USD_FEED` | Contracts | Optional Chainlink-compatible USDC/USD feed address wrapped by the deployed oracle adapter |
| `PAYMENT_ORACLE_MAX_STALENESS` | Contracts | Maximum accepted feed age in seconds for deployed oracle adapters. Defaults to `86400` |
| `NEXT_PUBLIC_PAYMENT_ASSETS_JSON` | Frontend | Public mirror of local/deployed payment asset metadata for client-side display |
| `NEXT_PUBLIC_PAYMENT_DEFAULT_ASSET` | Frontend | Public default payment asset id for client-side display |
| `HUMAN_VERIFICATION_PROVIDER` | Backend | `mock`, `passport`, or `worldcoin`; defaults to `mock` locally |
| `HUMAN_VERIFICATION_REQUIRED_REPORTS` | Backend | Report count threshold that triggers proof-of-humanity gating |
| `CURATOR_REPUTATION_DECAY_DAYS` | Backend | Days per inactivity decay window for curator effective score |
| `CURATOR_REPUTATION_DECAY_POINTS` | Backend | Reputation points removed per decay window |
| `GITCOIN_PASSPORT_API_KEY` | Backend | API key for Passport score lookups |
| `GITCOIN_PASSPORT_SCORER_ID` | Backend | Passport scorer used for curator verification |
| `GITCOIN_PASSPORT_THRESHOLD` | Backend | Minimum Passport score treated as verified |
| `WORLD_ID_APP_ID` | Backend | World ID app identifier for verify calls |
| `WORLD_ID_ACTION` | Backend | World ID action string used by the verification payload |
| `WORLD_ID_API_URL` | Backend | Optional override for the World ID verification base URL |
| `WORLD_ID_VERIFICATION_LEVEL` | Backend | Optional verification level such as `orb` |
| `INTERNAL_SERVICE_KEY` | Backend + internal workers | Shared secret for backend-originated privileged requests and Demucs callback authentication; required in production for internal worker callbacks |
| `STEM_WATCHDOG_TIMEOUT_MS` | Backend | Optional timeout before active stem-processing tracks are failed as stale; defaults to `900000` locally |
| `STEM_WATCHDOG_INTERVAL_MS` | Backend | Optional watchdog sweep interval for stale stem-processing tracks; defaults to `60000` locally |
| `ENABLE_CONTRACT_INDEXER` | Backend | Enables background contract event indexing when set to `true`; deployed environments should only enable it when contract addresses are configured |
| `INDEXER_POLL_INTERVAL_MS` | Backend | Optional contract indexer poll interval in milliseconds; defaults to `5000` |
| `INDEXER_BLOCKS_PER_BATCH` | Backend | Optional maximum block range fetched per indexer batch; defaults to `1000` |
| `INDEXER_MAX_BATCHES_PER_CYCLE` | Backend | Optional maximum indexer batches processed per poll cycle; defaults to `20` |
| `INDEXER_PROGRESS_LOG_LEVEL` | Backend | Optional progress log level for per-batch indexing messages: `silent`, `debug`, or `log`; defaults to `silent` |
| `SIGNUP_FAUCET_ENABLED` | Backend | Enables native ETH funding for newly registered wallets. Defaults to `false`; set `true` only in staging/testnet environments |
| `SIGNUP_FAUCET_AMOUNT_ETH` | Backend | Native ETH amount sent to new signup wallets when the faucet is enabled; defaults to `0.1` |
| `SIGNUP_FAUCET_CHAIN_ID` | Backend | Optional faucet chain guard. When omitted, signup funding uses the active chain verified by the backend auth RPC |
| `SIGNUP_FAUCET_RPC_URL` | Backend | Optional faucet RPC override; otherwise resolves from the active chain (`BASE_SEPOLIA_RPC_URL`, `BASE_RPC_URL`, `SEPOLIA_RPC_URL`, `LOCAL_RPC_URL`) before falling back to `RPC_URL` |
| `SIGNUP_FAUCET_FUNDER_PRIVATE_KEY` | Backend secret | Optional faucet funding key; falls back to the deployer `PRIVATE_KEY`. Store in secret manager/GitHub environment secrets, never source |
| `SIGNUP_SEPOLIA_FAUCET_*` | Backend | Backward-compatible legacy aliases for the signup faucet variables above. Prefer `SIGNUP_FAUCET_*` for new environments; legacy chain ID is only a fallback when no active signup chain is available |
| `LANGFUSE_ENABLED` | Backend | Optional agent observability switch. Set to `true` only when Langfuse credentials and host are configured |
| `LANGFUSE_BASE_URL` | Backend | Langfuse base URL for trace ingestion. Required only when `LANGFUSE_ENABLED=true` |
| `LANGFUSE_HOST` | Backend | Backward-compatible alias for `LANGFUSE_BASE_URL` |
| `LANGFUSE_PUBLIC_KEY` | Backend secret | Langfuse public key for Basic Auth ingestion. Required only when tracing is enabled |
| `LANGFUSE_SECRET_KEY` | Backend secret | Langfuse secret key for Basic Auth ingestion. Store in secret manager/GitHub environment secrets, never source |
| `LANGFUSE_ENVIRONMENT` | Backend | Optional lowercase trace environment label; falls back to `NODE_ENV` when unset |
| `AGENT_RUNTIME_WORKER_URL` | Backend | Optional base URL for the standalone agent runtime worker. When unset, `AgentRuntimeService` runs in-process |
| `AGENT_RUNTIME_WORKER_TIMEOUT_MS` | Backend | Optional timeout for backend-to-worker runtime calls; defaults to `5000` |
| `AGENT_RUNTIME_WORKER_REQUIRED` | Backend | Optional fail-closed switch. Set `true` to disable in-process fallback when the worker is configured but unavailable |
| `AGENT_RECOMMENDATION_STRATEGY` | Backend | Optional AI DJ recommendation ranking strategy. Defaults to `deterministic`; set `model-assisted` to enable structured Gemini ranking when credentials are available. Unsupported values fall back to deterministic ranking |
| `AGENT_RECOMMENDATION_MODEL` | Backend | Optional model name for `model-assisted` recommendation ranking. Falls back to `VERTEX_AI_MODEL`, then the backend default model |
| `AGENT_RECOMMENDATION_MIN_CONFIDENCE` | Backend | Optional minimum model confidence for accepted model-assisted recommendation decisions. Defaults to `0.55`; lower-confidence selections are rejected by post-model guards |
| `RESONATE_DESKTOP_WEB_URL` | Desktop shell | Absolute web app URL loaded by the desktop shell. Defaults to `http://localhost:3001` for local development. Package commands bake this value into ignored `desktop/generated/runtime-config.json` so QA builds can be double-clicked |
| `RESONATE_DESKTOP_START_WEB` | Desktop shell | Set to `false` when `npm run desktop:dev` should connect to an already-running web app instead of starting `web/` |
| `RESONATE_DESKTOP_ALLOWED_ORIGINS` | Desktop shell | Optional comma-separated extra origins allowed to remain in-app. External origins open in the system browser |
| `RESONATE_DESKTOP_DEVTOOLS` | Desktop shell | Optional local debugging flag; set to `true` to open Chromium DevTools on launch |
| `DESKTOP_WEB_URL` | GitHub repository variable | Deployed web URL used by the `Desktop Release Artifacts` workflow when baking desktop packages from tags or manual runs. Manual workflow input `desktop_web_url` takes precedence |
| `DESKTOP_ALLOWED_ORIGINS` | GitHub repository variable | Optional comma-separated extra origins passed to `RESONATE_DESKTOP_ALLOWED_ORIGINS` during desktop artifact builds |
| `ERC8004_ENABLED` | Backend | Enables ERC-8004 identity registration and reputation metadata writes. Defaults to disabled |
| `ERC8004_IDENTITY_REGISTRY_ADDRESS` | Backend | Optional ERC-8004 Identity Registry override. When omitted, the backend selects the official mainnet or testnet registry for supported chain IDs |
| `ERC8004_CHAIN_ID` | Backend | Optional ERC-8004 chain override; falls back to `AA_CHAIN_ID`, then `CHAIN_ID`, then local Anvil |
| `ERC8004_RPC_URL` | Backend | Optional RPC override for ERC-8004 receipt reads; falls back to `RPC_URL` / `LOCAL_RPC_URL` |
| `ERC8004_PUBLIC_BASE_URL` | Backend | Optional public base URL included in the ERC-8004 registration file service endpoints |
| `ERC8004_REPUTATION_SCHEDULER_ENABLED` | Backend | Enables periodic reputation attestation refreshes for active minted agents. Defaults to `false` and also requires `ERC8004_ENABLED=true` |
| `ERC8004_REPUTATION_SCHEDULER_INTERVAL_MS` | Backend | Optional scheduler interval; defaults to `21600000` (6 hours) when the scheduler is enabled |
| `ERC8004_REPUTATION_FRESHNESS_MS` | Backend | Optional freshness window before an agent is eligible for another reputation attestation; defaults to `86400000` (24 hours) |
| `ERC8004_REPUTATION_SCHEDULER_BATCH_SIZE` | Backend | Optional maximum active minted agents refreshed per scheduler sweep; defaults to `25` |

## Lyria Auth Modes

- Preferred for Cloud Run / GCE 30-second generation: set `LYRIA_PROJECT_ID`
  and `LYRIA_LOCATION` and let Application Default Credentials from the
  attached service account authenticate Vertex AI `lyria-002` requests.
- Longer-form Lyria 3 generation currently still uses the Google AI Studio /
  Gemini API path, so keep `GOOGLE_AI_API_KEY` configured when you want 1-3
  minute generations.
- Local / non-Vertex fallback: set `GOOGLE_AI_API_KEY` to use the Google AI
  Studio Gemini API path when ADC/Vertex is not available.

## Pub/Sub Auth Modes

- Local development: set `PUBSUB_EMULATOR_HOST` via `make dev-up`.
- Cloud Run / GCE: attach a service account and let Application Default
  Credentials resolve automatically.
- Other non-local environments: use Application Default Credentials via
  `GOOGLE_APPLICATION_CREDENTIALS` if metadata-server auth is not available.
- On-demand Demucs environments also need Cloud Run Job execution permission for
  the backend service account. `resonate-iac` grants this when
  `demucs_deployment_mode = "job"`.

If these variables are deployed through infrastructure, define them in
`resonate-iac` alongside the backend service environment configuration.

## Local x402 Profiles

Base Sepolia:

```env
NEXT_PUBLIC_CHAIN_ID=84532
NEXT_PUBLIC_RPC_URL=https://sepolia.base.org
RPC_URL=https://sepolia.base.org
X402_ENABLED=true
X402_NETWORK=eip155:84532
X402_FACILITATOR_URL=https://x402.org/facilitator
X402_PAYOUT_ADDRESS=<base-sepolia-wallet>
# Optional, listed-stem ownership settlement:
X402_CONTRACT_SETTLEMENT_ENABLED=true
X402_SETTLEMENT_PRIVATE_KEY=<base-sepolia-payout-wallet-private-key>
```

For deployed staging, keep the protocol chain and x402 chain aligned on Base
Sepolia: deploy the protocol contracts with `make deploy-base-sepolia`, copy the
resulting contract addresses into the `resonate-iac` environment config, and set
the backend and frontend chain variables to `84532`. This avoids the confusing
state where users see a Sepolia smart account in the app but x402 settlement
requires USDC at a different Base Sepolia address.

Base mainnet with AgentCash:

```env
X402_ENABLED=true
X402_NETWORK=eip155:8453
X402_FACILITATOR_URL=https://facilitator.payai.network
X402_PAYOUT_ADDRESS=<base-mainnet-wallet>
```

The backend refuses to boot with `X402_NETWORK=eip155:8453` unless
`X402_FACILITATOR_URL` is set explicitly, which prevents accidentally pairing
the Base mainnet flow with the default testnet facilitator.

Contract-backed x402 settlement is intentionally disabled by default. Enable it
only after the marketplace contract supports `buyFor`, the x402 asset matches
the listing `paymentToken`, and the settlement private key controls the same
wallet configured as `X402_PAYOUT_ADDRESS`.

## Funding and On-ramp UX

The wallet funding panel is driven by `GET /api/payments/funding-options`.
Funding options are metadata only; they must not change settlement logic.

Local Anvil uses the generated `contracts/deployments/local-payments.json`
artifact. `make payments-dev-up` / `contracts/scripts/update-local-payment-config.sh`
writes local-only endpoint actions for ETH, mock USDC, and WETH when WETH is
enabled. Those actions call `POST /api/payments/dev/fund`, which is guarded by
`PAYMENT_DEV_FAUCET_ENABLED=true` and must never be enabled in production.

Base Sepolia can use explicit JSON:

```env
PAYMENT_FUNDING_OPTIONS_JSON=[
  {
    "id": "base-sepolia-eth-faucet",
    "assetId": "base-sepolia:eth",
    "chainId": 84532,
    "kind": "testnet_faucet",
    "label": "Get Base Sepolia ETH",
    "description": "Use a configured testnet faucet to fund gas.",
    "provider": "Configured faucet",
    "url": "https://example.invalid/base-sepolia-eth",
    "requiresWallet": true
  },
  {
    "id": "base-sepolia-usdc-faucet",
    "assetId": "base-sepolia:usdc",
    "chainId": 84532,
    "kind": "testnet_faucet",
    "label": "Get Circle USDC",
    "description": "Use the configured Circle USDC testnet faucet.",
    "provider": "Circle",
    "url": "https://example.invalid/base-sepolia-usdc",
    "requiresWallet": true
  }
]
```

If `PAYMENT_FUNDING_OPTIONS_JSON` is omitted, the backend can synthesize Base
Sepolia transfer actions and faucet actions from:

```env
PAYMENT_BASE_SEPOLIA_ETH_FAUCET_URL=<configured-test-eth-faucet-url>
PAYMENT_BASE_SEPOLIA_USDC_FAUCET_URL=<configured-circle-usdc-faucet-url>
```

Production on-ramp and off-ramp providers are disabled by default. Enable them
only by adding provider-gated entries to `PAYMENT_FUNDING_OPTIONS_JSON`, scoped
to the eligible asset, chain, region, and provider:

```json
[
  {
    "id": "production-usdc-onramp",
    "assetId": "base:usdc",
    "chainId": 8453,
    "kind": "onramp",
    "label": "Buy USDC",
    "description": "Provider-gated fiat-to-USDC funding.",
    "provider": "Configured on-ramp",
    "region": "eligible regions only",
    "url": "https://provider.example/onramp",
    "requiresWallet": true
  },
  {
    "id": "production-usdc-offramp",
    "assetId": "base:usdc",
    "chainId": 8453,
    "kind": "offramp",
    "label": "Cash out USDC",
    "description": "Optional cash-out for eligible production users.",
    "provider": "Configured off-ramp",
    "region": "eligible regions only",
    "url": "https://provider.example/offramp",
    "requiresWallet": true
  }
]
```

Use `"disabledReason": "Provider not enabled in this environment"` for visible
but unavailable provider entries. Otherwise, omit unavailable providers entirely.

## Enabling Proof-of-Humanity Providers

The curator verification card enables providers dynamically from backend config.
If a provider is missing required credentials, it is shown as disabled in the UI.

### Local Development Defaults

Local development defaults to `mock` mode:

```env
HUMAN_VERIFICATION_PROVIDER=mock
HUMAN_VERIFICATION_MOCK_PROOF=resonate-human
```

This is why Gitcoin Passport and World ID appear disabled in an unconfigured
local environment.

### Enable Gitcoin Passport

1. Create or identify the Passport scorer you want to query.
2. Obtain the Passport API key for backend score lookups.
3. Set these backend env vars:

```env
HUMAN_VERIFICATION_PROVIDER=passport
GITCOIN_PASSPORT_API_KEY=...
GITCOIN_PASSPORT_SCORER_ID=...
GITCOIN_PASSPORT_THRESHOLD=20
```

4. Restart the backend.
5. Refresh the curator verification UI. Gitcoin Passport should now be selectable.

Notes:

- Passport verification is backend-driven. The frontend does not ask the user to
  paste a proof payload.
- The backend checks whether both `GITCOIN_PASSPORT_API_KEY` and
  `GITCOIN_PASSPORT_SCORER_ID` are present before exposing the provider.

### Enable World ID

1. Create a World ID app and action in the World developer dashboard.
2. Set these backend env vars:

```env
HUMAN_VERIFICATION_PROVIDER=worldcoin
WORLD_ID_APP_ID=...
WORLD_ID_ACTION=...
WORLD_ID_VERIFICATION_LEVEL=orb
```

3. Restart the backend.
4. Refresh the curator verification UI. World ID should now be selectable.

Notes:

- World ID verification expects the frontend/client to submit a proof JSON
  payload.
- The backend checks whether both `WORLD_ID_APP_ID` and `WORLD_ID_ACTION` are
  present before exposing the provider.

### Troubleshooting Disabled Providers

If a provider is shown as unavailable:

- Gitcoin Passport requires both `GITCOIN_PASSPORT_API_KEY` and
  `GITCOIN_PASSPORT_SCORER_ID`
- World ID requires both `WORLD_ID_APP_ID` and `WORLD_ID_ACTION`
- `HUMAN_VERIFICATION_PROVIDER` only sets the preferred default; it does not
  force-enable an unconfigured provider
- restart the backend after changing env vars
- if upstream requests hang, check `HUMAN_VERIFICATION_TIMEOUT_MS`

### Important Scope Note

These providers support **proof-of-humanity / anti-sybil checks for curators**.
They do **not** prove rights ownership for uploaded recordings.
