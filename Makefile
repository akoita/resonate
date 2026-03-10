dev-up:
	@# Pre-check for port conflicts that silently break docker compose up
	@for port_info in "6379:Redis" "5432:Postgres" "8000:Demucs worker" "8085:PubSub emulator"; do \
		port=$$(echo $$port_info | cut -d: -f1); \
		svc=$$(echo $$port_info | cut -d: -f2); \
		pid=$$(lsof -ti :$$port 2>/dev/null | head -1); \
		if [ -n "$$pid" ]; then \
			container=$$(docker ps --filter "publish=$$port" --format '{{.Names}}' 2>/dev/null | head -1); \
			if [ -n "$$container" ] && echo "$$container" | grep -q "^resonate-"; then continue; fi; \
			echo ""; \
			echo "⚠️  Port $$port ($$svc) is already in use by: $${container:-PID $$pid}"; \
			echo "   Stop it first:  docker stop $$container  OR  kill $$pid"; \
			echo ""; \
		fi; \
	done
	docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
	@sleep 3
	@if ! docker compose ps demucs-worker 2>/dev/null | grep -q 'Up'; then \
		echo ""; \
		echo "⚠️  WARNING: demucs-worker failed to start (GPU mode)."; \
		echo "   Falling back to CPU-only mode..."; \
		docker compose up -d demucs-worker 2>&1; \
		sleep 3; \
		if docker compose ps demucs-worker 2>/dev/null | grep -q 'Up'; then \
			echo "   ✅ Worker started in CPU mode."; \
		else \
			echo "   ❌ Worker failed to start. Check: docker compose logs demucs-worker"; \
		fi; \
	fi
	@# Final health check summary
	@echo ""
	@echo "━━━ Container Status ━━━"
	@for svc in postgres redis pubsub-emulator demucs-worker; do \
		status=$$(docker compose ps $$svc --format '{{.Status}}' 2>/dev/null); \
		if echo "$$status" | grep -q 'Up'; then \
			echo "  ✅ $$svc: $$status"; \
		elif [ -z "$$status" ]; then \
			echo "  ⚪ $$svc: not created"; \
		else \
			echo "  ❌ $$svc: $$status"; \
		fi; \
	done
	@echo ""

dev-up-build:
	docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build -d
	@sleep 3
	@if ! docker compose ps demucs-worker --format '{{.Status}}' 2>/dev/null | grep -q 'Up'; then \
		echo ""; \
		echo "⚠️  WARNING: demucs-worker failed to start (GPU mode)."; \
		echo "   Falling back to CPU-only mode..."; \
		docker compose up --build -d demucs-worker; \
		echo "   ✅ Worker started in CPU mode."; \
	fi

dev-down:
	docker compose down -v

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

# ============================================
# Cloud Deployment (per-environment)
# ============================================
# Usage:  make deploy-all ENV=dev
#         make deploy-backend ENV=dev
#         make deploy-frontend ENV=dev
#
# Requires: .env.deploy.<ENV> (copy from .env.deploy.example)

ENV ?= dev
-include .env.deploy.$(ENV)
export

deploy-backend:
	@test -f .env.deploy.$(ENV) || (echo "Error: .env.deploy.$(ENV) not found. Copy .env.deploy.example" && exit 1)
	docker build -t $(REGISTRY)/backend:latest -f backend/Dockerfile backend/
	docker push $(REGISTRY)/backend:latest
	gcloud run services update resonate-$(ENV)-backend \
		--image=$(REGISTRY)/backend:latest \
		--region=$(GCP_REGION)

deploy-frontend:
	@test -f .env.deploy.$(ENV) || (echo "Error: .env.deploy.$(ENV) not found. Copy .env.deploy.example" && exit 1)
	docker build -t $(REGISTRY)/frontend:latest \
		--build-arg NEXT_PUBLIC_API_URL=$(NEXT_PUBLIC_API_URL) \
		--build-arg NEXT_PUBLIC_ZERODEV_PROJECT_ID=$(NEXT_PUBLIC_ZERODEV_PROJECT_ID) \
		--build-arg NEXT_PUBLIC_CHAIN_ID=$(NEXT_PUBLIC_CHAIN_ID) \
		--build-arg NEXT_PUBLIC_STEM_NFT_ADDRESS=$(NEXT_PUBLIC_STEM_NFT_ADDRESS) \
		--build-arg NEXT_PUBLIC_MARKETPLACE_ADDRESS=$(NEXT_PUBLIC_MARKETPLACE_ADDRESS) \
		--build-arg NEXT_PUBLIC_PIMLICO_API_KEY=$(NEXT_PUBLIC_PIMLICO_API_KEY) \
		-f web/Dockerfile web/
	docker push $(REGISTRY)/frontend:latest
	gcloud run services update resonate-$(ENV)-frontend \
		--image=$(REGISTRY)/frontend:latest \
		--region=$(GCP_REGION)

deploy-demucs:
	@test -f .env.deploy.$(ENV) || (echo "Error: .env.deploy.$(ENV) not found. Copy .env.deploy.example" && exit 1)
	docker build -t $(REGISTRY)/demucs-worker:latest -f workers/demucs/Dockerfile workers/demucs/
	docker push $(REGISTRY)/demucs-worker:latest
	gcloud run services update resonate-$(ENV)-demucs \
		--image=$(REGISTRY)/demucs-worker:latest \
		--region=$(GCP_REGION)

deploy-all: deploy-backend deploy-frontend deploy-demucs

# Start production-like stack (backend + web + postgres + redis)
docker-up:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d

# Stop production stack
docker-down:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml down

# ============================================
# Sepolia Contract Deployment
# ============================================

deploy-sepolia:
	./scripts/deploy-sepolia.sh

# ============================================
# GCP Infrastructure (Terraform)
# ============================================

infra-init:
	cd infra/terraform && terraform init

infra-plan:
	cd infra/terraform && terraform plan

infra-apply:
	cd infra/terraform && terraform apply

infra-destroy:
	cd infra/terraform && terraform destroy



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
	docker compose --profile local-aa up -d
	@echo "Waiting for services to start..."
	@sleep 3
	@echo "Anvil running at http://localhost:8545"
	@echo "Alto bundler running at http://localhost:4337"

# Stop local AA infrastructure
local-aa-down:
	docker compose --profile local-aa --profile fork-aa down

# Deploy AA contracts to local Anvil
local-aa-deploy:
	cd contracts && forge script script/DeployLocalAA.s.sol --rpc-url http://localhost:8545 --broadcast
	@echo ""
	@echo "Updating configuration files..."
	./scripts/update-aa-config.sh

# Deploy protocol contracts (StemNFT, Marketplace, TransferValidator, ContentProtection, RevenueEscrow)
# On a Sepolia fork, the on-chain StemNFT predates Phase 2 (missing setContentProtection),
# so we deploy all contracts fresh and update config with the new local addresses.
# On local-only (chain 31337), all contracts are deployed fresh via forge.
deploy-contracts:
	@echo "Deploying Resonate Protocol contracts..."
	cd contracts && forge script script/DeployProtocol.s.sol --rpc-url http://localhost:8545 --broadcast
	@echo ""
	@echo "Updating configuration files..."
	./scripts/update-protocol-config.sh
	@echo "Clearing Next.js cache (env vars are baked at build time)..."
	@rm -rf web/.next
	@echo "✓ Done — restart frontend to use contract addresses"

# Full local setup: infra + AA contracts + protocol contracts
contracts-deploy-local: local-aa-up
	@sleep 2
	$(MAKE) local-aa-deploy
	@sleep 1
	$(MAKE) deploy-contracts

# Update .env files with deployed AA contract addresses
local-aa-config:
	./scripts/update-aa-config.sh

# Start web frontend in local AA mode
web-dev-local:
	@rm -rf web/.next
	cd web && NEXT_PUBLIC_API_URL=http://localhost:3000 NEXT_PUBLIC_CHAIN_ID=31337 npm run dev

# View local AA logs
local-aa-logs:
	docker compose --profile local-aa logs -f

# ============================================
# Forked Sepolia AA Development (ZeroDev)
# ============================================
# Uses anvil --fork-url to fork Sepolia where ZeroDev contracts
# are already deployed. Requires SEPOLIA_RPC_URL in .env.

# Start Anvil forking Sepolia (ZeroDev contracts available)
anvil-fork:
	@if [ -z "$(SEPOLIA_RPC_URL)" ]; then \
		echo "Error: SEPOLIA_RPC_URL not set. Export it or add to .env at project root."; \
		exit 1; \
	fi
	SEPOLIA_RPC_URL=$(SEPOLIA_RPC_URL) docker compose --profile fork-aa up -d anvil-fork alto-bundler-fork

# Full forked Sepolia setup: anvil fork + configure .env
local-aa-fork:
	@echo "Starting Anvil (forked Sepolia) in Docker..."
	$(MAKE) anvil-fork
	@echo "Waiting for Anvil to be healthy..."
	@docker compose --profile fork-aa exec anvil-fork sh -c \
		'for i in $$(seq 1 15); do cast block-number --rpc-url http://localhost:8545 > /dev/null 2>&1 && exit 0; sleep 1; done; exit 1'
	./scripts/update-aa-config.sh --mode fork
	@echo ""
	@echo "Forked Sepolia ready! Anvil (localhost:8545) + Alto bundler (localhost:4337)"

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
	docker compose logs -f demucs-worker

# Start Demucs worker with GPU acceleration (requires NVIDIA GPU + Container Toolkit)
worker-gpu:
	docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d demucs-worker
	@echo "Demucs worker started with GPU acceleration"
	@echo "Verify GPU: docker compose exec demucs-worker nvidia-smi"

# Rebuild Demucs worker with GPU support (useful after Dockerfile changes)
worker-rebuild:
	docker compose -f docker-compose.yml -f docker-compose.gpu.yml build --no-cache demucs-worker
	docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d demucs-worker

# Check Demucs worker health
worker-health:
	@curl -s http://localhost:8000/health | python3 -m json.tool || echo "Worker not responding"

# Skip model pre-caching for faster builds (model downloads on first use)
worker-quick-build:
	docker compose -f docker-compose.yml -f docker-compose.gpu.yml build --build-arg CACHE_MODEL=0 demucs-worker
