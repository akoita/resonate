---
title: Project Resonate
---

# Project Resonate

Resonate is an agentic audio protocol for decentralized, AI-native music
streaming, remixing, and rights management.

## Docs

- `docs/RESONATE_SPECS.md`
- `docs/phase0/requirements_user_stories.md`
- `docs/phase0/licensing_pricing_model.md`
- `docs/phase0/event_taxonomy_domain_model.md`
- `docs/phase0/architecture_service_boundaries.md`
- `docs/phase0/data_model_storage_plan.md`

## Repository Structure (Initial)

- `docs/`: product and architecture specifications
- `.github/`: workflows and repository settings

## Development

### Local services

Start Postgres:

```
docker compose up -d
```

### Backend

Set env vars:

- `DATABASE_URL=postgresql://resonate:resonate@localhost:5432/resonate`
- `JWT_SECRET=dev-secret`

Install and run:

```
cd backend
npm install
npm run prisma:generate
npm run prisma:migrate
npm run start:dev
```

### Makefile helpers

```
make dev-up
make backend-dev
make web-dev
```
