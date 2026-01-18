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
- `docs/metadata/music_metadata_standard.md`

## Repository Structure (Initial)

- `docs/`: product and architecture specifications
- `.github/`: workflows and repository settings

## Development

### Local services

Start Postgres:

```
docker compose up -d
```

Starts a local Postgres container in the background on port 5432.

### Backend

Set env vars:

- `DATABASE_URL=postgresql://resonate:resonate@localhost:5432/resonate`
- `JWT_SECRET=dev-secret`

`DATABASE_URL` tells Prisma/Nest which local database to use.  
`JWT_SECRET` is used to sign and verify auth tokens.

Install and run:

```
cd backend
npm install
npm run prisma:generate
npm run prisma:migrate
npm run start:dev
```

`npm install` installs backend dependencies.  
`prisma:generate` creates the Prisma client from the schema.  
`prisma:migrate` applies the schema to the local database.  
`start:dev` runs the NestJS API with auto-reload.

### Makefile helpers

```
make dev-up
make backend-dev
make web-dev
```

`make dev-up` starts Postgres via docker-compose.  
`make backend-dev` generates Prisma client, runs migrations, and starts the API.  
`make web-dev` starts the Next.js web app.
