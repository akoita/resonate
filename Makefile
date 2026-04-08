SEPOLIA_RPC_URL ?= https://sepolia.drpc.org
RESONATE_IAC_REPO ?= https://github.com/akoita/resonate-iac
LOCAL_INFRA_COMPOSE_FILE ?= docker/docker-compose.local.yml
AA_INFRA_COMPOSE_FILE ?= docker/docker-compose.aa.yml
DEMUCS_IMAGE_NAME ?= resonate-demucs:cpu
DEMUCS_GPU_IMAGE_NAME ?= resonate-demucs:gpu
DEMUCS_CONTAINER_NAME ?= resonate-demucs-local
DEMUCS_OUTPUT_DIR ?= $(CURDIR)/backend/uploads/stems

define moved_to_resonate_iac
	@echo "This target moved to $(RESONATE_IAC_REPO)."
	@echo "Start or deploy infrastructure from resonate-iac, then return to this repo for app-local commands."
	@exit 1
endef

dev-up:
	docker compose -f $(LOCAL_INFRA_COMPOSE_FILE) up -d
	@echo "Waiting for Postgres on localhost:5432..."
	@until nc -z localhost 5432 >/dev/null 2>&1; do sleep 1; done
	@echo "Waiting for PubSub emulator on localhost:8085..."
	@until nc -z localhost 8085 >/dev/null 2>&1; do sleep 1; done
	@$(MAKE) pubsub-init
	@echo "✅ Local infra is ready: Postgres, Redis, PubSub emulator"

dev-up-build:
	docker compose -f $(LOCAL_INFRA_COMPOSE_FILE) up -d --build
	@echo "Waiting for Postgres on localhost:5432..."
	@until nc -z localhost 5432 >/dev/null 2>&1; do sleep 1; done
	@echo "Waiting for PubSub emulator on localhost:8085..."
	@until nc -z localhost 8085 >/dev/null 2>&1; do sleep 1; done
	@$(MAKE) pubsub-init
	@echo "✅ Local infra is ready: Postgres, Redis, PubSub emulator"

dev-down:
	-$(MAKE) worker-down
	docker compose -f $(LOCAL_INFRA_COMPOSE_FILE) down

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
	@if ! nc -z localhost 5432 >/dev/null 2>&1; then \
		echo "❌ Postgres is not reachable on localhost:5432"; \
		echo "Run 'make dev-up' in this repo to start local Postgres, Redis, and PubSub, then retry make backend-dev."; \
		echo "backend/.env currently points DATABASE_URL at localhost:5432."; \
		exit 1; \
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

local-aa-up:
	docker compose -f $(AA_INFRA_COMPOSE_FILE) --profile local-aa up -d
	@echo "Waiting for local Anvil on localhost:8545..."
	@until nc -z localhost 8545 >/dev/null 2>&1; do sleep 1; done
	@echo "Waiting for local Alto bundler on localhost:4337..."
	@until nc -z localhost 4337 >/dev/null 2>&1; do sleep 1; done
	@echo "✅ Local AA infra is ready: Anvil (31337), Alto bundler"

local-aa-down:
	docker compose -f $(AA_INFRA_COMPOSE_FILE) --profile local-aa --profile fork-aa down

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

# Full local contract/config setup in plain local 31337 mode
contracts-deploy-local: local-aa-up
	$(MAKE) local-aa-deploy
	@sleep 1
	$(MAKE) deploy-contracts

# Update .env files with deployed AA contract addresses
local-aa-config:
	./contracts/scripts/update-aa-config.sh

# Start web frontend in local AA mode
web-dev-local:
	@rm -rf web/.next
	@AA_ENTRY_POINT=$$(grep '^AA_ENTRY_POINT=' backend/.env 2>/dev/null | cut -d= -f2-); \
	AA_FACTORY=$$(grep '^AA_FACTORY=' backend/.env 2>/dev/null | cut -d= -f2-); \
	echo "Starting local web dev with chainId=31337, entryPoint=$$AA_ENTRY_POINT, factory=$$AA_FACTORY"; \
	cd web && \
	NEXT_PUBLIC_API_URL=http://localhost:3000 \
	NEXT_PUBLIC_CHAIN_ID=31337 \
	NEXT_PUBLIC_RPC_URL=http://localhost:8545 \
	NEXT_PUBLIC_AA_ENTRY_POINT=$$AA_ENTRY_POINT \
	NEXT_PUBLIC_AA_FACTORY=$$AA_FACTORY \
	npm run dev

# View local AA logs
local-aa-logs:
	docker compose -f $(AA_INFRA_COMPOSE_FILE) --profile local-aa --profile fork-aa logs -f

# ============================================
# Forked Sepolia AA Development (ZeroDev)
# ============================================
# Uses anvil --fork-url to fork Sepolia where ZeroDev contracts
# are already deployed. Uses SEPOLIA_RPC_URL or falls back to dRPC.

anvil-fork:
	docker compose -f $(AA_INFRA_COMPOSE_FILE) --profile fork-aa up -d anvil-fork
	@echo "Waiting for Sepolia fork on localhost:8545..."
	@until nc -z localhost 8545 >/dev/null 2>&1; do sleep 1; done
	@echo "✅ Forked Anvil is ready on localhost:8545"

local-aa-fork:
	docker compose -f $(AA_INFRA_COMPOSE_FILE) --profile fork-aa up -d
	@echo "Waiting for Sepolia fork on localhost:8545..."
	@until nc -z localhost 8545 >/dev/null 2>&1; do sleep 1; done
	@echo "Waiting for forked Alto bundler on localhost:4337..."
	@until nc -z localhost 4337 >/dev/null 2>&1; do sleep 1; done
	./contracts/scripts/update-aa-config.sh --mode fork
	@echo ""
	@echo "✅ Forked Sepolia AA infra is ready: Anvil fork + Alto bundler"

# Start web frontend in forked Sepolia mode
web-dev-fork:
	@rm -rf web/.next
	@AA_ENTRY_POINT=$$(grep '^AA_ENTRY_POINT=' backend/.env 2>/dev/null | cut -d= -f2-); \
	AA_FACTORY=$$(grep '^AA_FACTORY=' backend/.env 2>/dev/null | cut -d= -f2-); \
	echo "Starting forked web dev with chainId=11155111, entryPoint=$$AA_ENTRY_POINT, factory=$$AA_FACTORY"; \
	cd web && \
	NEXT_PUBLIC_API_URL=http://localhost:3000 \
	NEXT_PUBLIC_ZERODEV_PROJECT_ID= \
	NEXT_PUBLIC_CHAIN_ID=11155111 \
	NEXT_PUBLIC_RPC_URL=http://localhost:8545 \
	NEXT_PUBLIC_AA_ENTRY_POINT=$$AA_ENTRY_POINT \
	NEXT_PUBLIC_AA_FACTORY=$$AA_FACTORY \
	npm run dev

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

# Build local CPU Demucs worker image
worker-build:
	@mkdir -p "$(DEMUCS_OUTPUT_DIR)"
	docker build \
		-f workers/demucs/Dockerfile \
		-t $(DEMUCS_IMAGE_NAME) \
		workers/demucs

# Start local CPU Demucs worker container
worker-up:
	@mkdir -p "$(DEMUCS_OUTPUT_DIR)"
	@if ! docker image inspect $(DEMUCS_IMAGE_NAME) >/dev/null 2>&1; then \
		echo "Demucs image $(DEMUCS_IMAGE_NAME) not found; building it first..."; \
		$(MAKE) worker-build; \
	fi
	-$(MAKE) worker-down
	docker run --rm -d \
		--name $(DEMUCS_CONTAINER_NAME) \
		-p 8000:8000 \
		--add-host=host.docker.internal:host-gateway \
		-e PROCESSING_MODE=pubsub \
		-e STORAGE_MODE=local \
		-e OUTPUT_DIR=/outputs \
		-e GCP_PROJECT_ID=resonate-local \
		-e PUBSUB_EMULATOR_HOST=host.docker.internal:8085 \
		-e PUBSUB_SUBSCRIPTION=stem-separate-worker \
		-e PUBSUB_RESULTS_TOPIC=stem-results \
		-e TORCHAUDIO_USE_BACKEND_DISPATCHER=1 \
		-v "$(DEMUCS_OUTPUT_DIR):/outputs" \
		$(DEMUCS_IMAGE_NAME)
	@echo "✅ Demucs worker is running as $(DEMUCS_CONTAINER_NAME) on localhost:8000"

# Stop local Demucs worker container
worker-down:
	-docker rm -f $(DEMUCS_CONTAINER_NAME) >/dev/null 2>&1 || true

# View Demucs worker logs
worker-logs:
	docker logs -f $(DEMUCS_CONTAINER_NAME)

# Build local GPU Demucs worker image
worker-gpu-build:
	@mkdir -p "$(DEMUCS_OUTPUT_DIR)"
	docker build \
		-f workers/demucs/Dockerfile.gpu \
		-t $(DEMUCS_GPU_IMAGE_NAME) \
		workers/demucs

# Start Demucs worker with GPU acceleration (requires NVIDIA GPU + Container Toolkit)
worker-gpu:
	@mkdir -p "$(DEMUCS_OUTPUT_DIR)"
	@if ! docker image inspect $(DEMUCS_GPU_IMAGE_NAME) >/dev/null 2>&1; then \
		echo "Demucs GPU image $(DEMUCS_GPU_IMAGE_NAME) not found; building it first..."; \
		$(MAKE) worker-gpu-build; \
	fi
	-$(MAKE) worker-down
	docker run --rm -d \
		--name $(DEMUCS_CONTAINER_NAME) \
		--gpus all \
		-p 8000:8000 \
		--add-host=host.docker.internal:host-gateway \
		-e PROCESSING_MODE=pubsub \
		-e STORAGE_MODE=local \
		-e OUTPUT_DIR=/outputs \
		-e GCP_PROJECT_ID=resonate-local \
		-e PUBSUB_EMULATOR_HOST=host.docker.internal:8085 \
		-e PUBSUB_SUBSCRIPTION=stem-separate-worker \
		-e PUBSUB_RESULTS_TOPIC=stem-results \
		-e NVIDIA_VISIBLE_DEVICES=all \
		-e NVIDIA_DRIVER_CAPABILITIES=compute,utility \
		-e TORCHAUDIO_USE_BACKEND_DISPATCHER=1 \
		-v "$(DEMUCS_OUTPUT_DIR):/outputs" \
		$(DEMUCS_GPU_IMAGE_NAME)
	@echo "✅ GPU Demucs worker is running as $(DEMUCS_CONTAINER_NAME) on localhost:8000"

# Rebuild local CPU Demucs worker image without cache
worker-rebuild:
	@mkdir -p "$(DEMUCS_OUTPUT_DIR)"
	docker build --no-cache \
		-f workers/demucs/Dockerfile \
		-t $(DEMUCS_IMAGE_NAME) \
		workers/demucs

# Check Demucs worker health
worker-health:
	@curl -s http://localhost:8000/health | python3 -m json.tool || echo "Worker not responding"

# Skip model pre-caching for faster builds (model downloads on first use)
worker-quick-build:
	@mkdir -p "$(DEMUCS_OUTPUT_DIR)"
	docker build \
		--build-arg CACHE_MODEL=0 \
		-f workers/demucs/Dockerfile \
		-t $(DEMUCS_IMAGE_NAME) \
		workers/demucs
