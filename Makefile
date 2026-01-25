dev-up:
	docker compose up -d

dev-down:
	docker compose down -v

backend-dev:
	cd backend && npm run prisma:generate && npm run prisma:migrate && npm run start:dev

web-dev:
	cd web && npm run dev

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
	docker compose --profile local-aa down

# Deploy AA contracts to local Anvil
local-aa-deploy:
	cd contracts && forge script script/DeployLocalAA.s.sol --rpc-url http://localhost:8545 --broadcast

# Full local AA setup: start infra + deploy contracts
local-aa-full: local-aa-up
	@sleep 2
	$(MAKE) local-aa-deploy

# Start web frontend in local AA mode
web-dev-local:
	cd web && NEXT_PUBLIC_CHAIN_ID=31337 npm run dev

# View local AA logs
local-aa-logs:
	docker compose --profile local-aa logs -f
