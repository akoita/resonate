SEPOLIA_RPC_URL ?= https://sepolia.drpc.org
RESONATE_IAC_REPO ?= https://github.com/akoita/resonate-iac

define moved_to_resonate_iac
	@echo "This target moved to $(RESONATE_IAC_REPO)."
	@echo "Start or deploy infrastructure from resonate-iac, then return to this repo for app-local commands."
	@exit 1
endef

dev-up:
	$(moved_to_resonate_iac)

dev-up-build:
	$(moved_to_resonate_iac)

dev-down:
	$(moved_to_resonate_iac)

# ============================================
# Docker Production Builds
# ============================================

# Build backend + web Docker images
docker-build:
	docker build -t resonate-backend ./backend
	docker build -t resonate-web ./web

# Build for cloud deployment (passes NEXT_PUBLIC_* compile-time vars to frontend)
# Usage: make docker-build-cloud NEXT_PUBLIC_API_URL=https://... NEXT_PUBLIC_ZERODEV_PROJECT_ID=...
docker-build-cloud:
	docker build -t resonate-backend ./backend
	docker build -t resonate-web \
		--build-arg NEXT_PUBLIC_API_URL=$(NEXT_PUBLIC_API_URL) \
		--build-arg NEXT_PUBLIC_ZERODEV_PROJECT_ID=$(NEXT_PUBLIC_ZERODEV_PROJECT_ID) \
		--build-arg NEXT_PUBLIC_CHAIN_ID=11155111 \
		--build-arg NEXT_PUBLIC_STEM_NFT_ADDRESS=$(NEXT_PUBLIC_STEM_NFT_ADDRESS) \
		--build-arg NEXT_PUBLIC_MARKETPLACE_ADDRESS=$(NEXT_PUBLIC_MARKETPLACE_ADDRESS) \
		./web

deploy-backend:
	$(moved_to_resonate_iac)

deploy-frontend:
	$(moved_to_resonate_iac)

deploy-demucs:
	$(moved_to_resonate_iac)

deploy-all: deploy-backend deploy-frontend deploy-demucs

# Start production-like stack (backend + web + postgres + redis)
docker-up:
	$(moved_to_resonate_iac)

# Stop production stack
docker-down:
	$(moved_to_resonate_iac)

# ============================================
# Sepolia Contract Deployment
# ============================================

deploy-sepolia:
	./contracts/scripts/deploy-sepolia.sh

infra-init:
	$(moved_to_resonate_iac)

infra-plan:
	$(moved_to_resonate_iac)

infra-apply:
	$(moved_to_resonate_iac)

infra-destroy:
	$(moved_to_resonate_iac)



backend-dev: dev-clean
	@# Ensure PubSub emulator env is set for the NestJS process
	@if ! grep -q '^PUBSUB_EMULATOR_HOST' backend/.env 2>/dev/null; then \
		echo 'PUBSUB_EMULATOR_HOST=localhost:8085' >> backend/.env; \
		echo 'GCP_PROJECT_ID=resonate-local' >> backend/.env; \
		echo 'STEM_PROCESSING_MODE=pubsub' >> backend/.env; \
		echo "✅ Added PubSub emulator config to backend/.env"; \
	fi
	cd backend && npm run prisma:generate && npm run prisma:migrate && npm run start:dev

web-dev: dev-clean
	cd web && NEXT_PUBLIC_API_URL=http://localhost:3000 npm run dev

db-reset:
	cd backend && npx prisma migrate reset --force

dev-clean:
	@echo "Cleaning up dev ports 3000, 3001..."
	-lsof -i :3000 -t | xargs -r kill -9
	-lsof -i :3001 -t | xargs -r kill -9
	@echo "Done."

# ============================================
# Local Account Abstraction Development
# ============================================

# Start Anvil chain and Alto bundler
local-aa-up:
	$(moved_to_resonate_iac)

# Stop local AA infrastructure
local-aa-down:
	$(moved_to_resonate_iac)

# Deploy AA contracts to local Anvil
local-aa-deploy:
	cd contracts && forge script script/DeployLocalAA.s.sol --rpc-url http://localhost:8545 --broadcast
	@echo ""
	@echo "Updating configuration files..."
	./contracts/scripts/update-aa-config.sh

# Deploy protocol contracts (StemNFT, Marketplace, TransferValidator, ContentProtection, RevenueEscrow)
# On a Sepolia fork, the on-chain StemNFT predates Phase 2 (missing setContentProtection),
# so we deploy all contracts fresh and update config with the new local addresses.
# On local-only (chain 31337), all contracts are deployed fresh via forge.
deploy-contracts:
	@echo "Deploying Resonate Protocol contracts..."
	cd contracts && forge script script/DeployProtocol.s.sol --rpc-url http://localhost:8545 --broadcast
	@echo ""
	@echo "Updating configuration files..."
	./contracts/scripts/update-protocol-config.sh
	@echo "Clearing Next.js cache (env vars are baked at build time)..."
	@rm -rf web/.next
	@echo "✓ Done — restart frontend to use contract addresses"

# Full local contract/config setup once infrastructure is already running
contracts-deploy-local:
	$(MAKE) local-aa-deploy
	@sleep 1
	$(MAKE) deploy-contracts

# Update .env files with deployed AA contract addresses
local-aa-config:
	./contracts/scripts/update-aa-config.sh

# Start web frontend in local AA mode
web-dev-local:
	@rm -rf web/.next
	cd web && NEXT_PUBLIC_API_URL=http://localhost:3000 NEXT_PUBLIC_CHAIN_ID=31337 npm run dev

# View local AA logs
local-aa-logs:
	$(moved_to_resonate_iac)

# ============================================
# Forked Sepolia AA Development (ZeroDev)
# ============================================
# Uses anvil --fork-url to fork Sepolia where ZeroDev contracts
# are already deployed. Uses SEPOLIA_RPC_URL or falls back to dRPC.

# Start Anvil forking Sepolia (ZeroDev contracts available)
anvil-fork:
	$(moved_to_resonate_iac)

# Configure forked Sepolia env against an already-running local fork/bundler
local-aa-fork:
	./contracts/scripts/update-aa-config.sh --mode fork
	@echo ""
	@echo "Forked Sepolia env updated. Start the fork/bundler stack from $(RESONATE_IAC_REPO) if it is not already running."

# Start web frontend in forked Sepolia mode
web-dev-fork:
	@rm -rf web/.next
	cd web && NEXT_PUBLIC_API_URL=http://localhost:3000 NEXT_PUBLIC_ZERODEV_PROJECT_ID= NEXT_PUBLIC_CHAIN_ID=11155111 NEXT_PUBLIC_RPC_URL=http://localhost:8545 npm run dev

# ============================================
# PubSub Emulator Helpers
# ============================================

# Manually create PubSub topics/subscriptions (recovery when emulator state is lost)
pubsub-init:
	@echo "Creating PubSub topics and subscriptions on emulator..."
	@curl -sf -X PUT http://localhost:8085/v1/projects/resonate-local/topics/stem-separate > /dev/null 2>&1 || true
	@curl -sf -X PUT http://localhost:8085/v1/projects/resonate-local/topics/stem-results > /dev/null 2>&1 || true
	@curl -sf -X PUT http://localhost:8085/v1/projects/resonate-local/subscriptions/stem-separate-worker \
		-H 'Content-Type: application/json' \
		-d '{"topic":"projects/resonate-local/topics/stem-separate","ackDeadlineSeconds":600}' > /dev/null 2>&1 || true
	@curl -sf -X PUT http://localhost:8085/v1/projects/resonate-local/subscriptions/stem-results-backend \
		-H 'Content-Type: application/json' \
		-d '{"topic":"projects/resonate-local/topics/stem-results","ackDeadlineSeconds":600}' > /dev/null 2>&1 || true
	@echo "✅ PubSub topics: stem-separate, stem-results"
	@echo "✅ PubSub subscriptions: stem-separate-worker, stem-results-backend"

# ============================================
# Demucs AI Stem Separation Worker
# ============================================

# View Demucs worker logs
worker-logs:
	$(moved_to_resonate_iac)

# Start Demucs worker with GPU acceleration (requires NVIDIA GPU + Container Toolkit)
worker-gpu:
	$(moved_to_resonate_iac)

# Rebuild Demucs worker with GPU support (useful after Dockerfile changes)
worker-rebuild:
	$(moved_to_resonate_iac)

# Check Demucs worker health
worker-health:
	@curl -s http://localhost:8000/health | python3 -m json.tool || echo "Worker not responding"

# Skip model pre-caching for faster builds (model downloads on first use)
worker-quick-build:
	$(moved_to_resonate_iac)
