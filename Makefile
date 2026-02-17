dev-up:
	docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d

dev-down:
	docker compose down -v

# ============================================
# Docker Production Builds
# ============================================

# Build backend + web Docker images
docker-build:
	docker build -t resonate-backend ./backend
	docker build -t resonate-web ./web

# Start production-like stack (backend + web + postgres + redis)
docker-up:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d

# Stop production stack
docker-down:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml down


backend-dev: dev-clean
	cd backend && npm run prisma:generate && npm run prisma:migrate && npm run start:dev

web-dev: dev-clean
	cd web && npm run dev

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

# Deploy protocol contracts (StemNFT, Marketplace, TransferValidator)
deploy-contracts:
	@echo "Deploying Resonate Protocol contracts..."
	cd contracts && forge script script/DeployProtocol.s.sol --rpc-url http://localhost:8545 --broadcast
	@echo ""
	@echo "Updating configuration files..."
	./scripts/update-protocol-config.sh

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
	cd web && NEXT_PUBLIC_CHAIN_ID=31337 npm run dev

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
	cd web && NEXT_PUBLIC_CHAIN_ID=11155111 NEXT_PUBLIC_RPC_URL=http://localhost:8545 npm run dev

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
