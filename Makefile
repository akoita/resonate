dev-up:
	docker compose up -d

dev-down:
	docker compose down -v

backend-dev:
	cd backend && npm run prisma:generate && npm run prisma:migrate && npm run start:dev

web-dev:
	cd web && npm run dev
