# Resonate — AI Agent Coding Standards

> This file is read by AI coding assistants (GitHub Copilot, Gemini Code Assist, Claude, etc.)
> to enforce project-wide conventions. Keep it up to date.

## 🚨 No Hardcoded Configuration Values

**NEVER hardcode** URLs, ports, secrets, API keys, project IDs, bucket names, or any
environment-dependent values directly in source code.

### Rules

1. **Always use environment variables** with a sensible local-dev fallback:

   ```typescript
   // ✅ CORRECT
   const url = process.env.BACKEND_URL || "http://localhost:3001";

   // ❌ WRONG — hardcoded production/staging URL
   const url = "https://resonate-dev-backend-82886308956.europe-west1.run.app";

   // ❌ WRONG — no env var at all
   const url = "http://localhost:3001/encryption/decrypt";
   ```

2. **Use centralized constants** — don't redeclare `API_BASE` in every file:

   ```typescript
   // ✅ Import from the canonical source
   import { API_BASE } from "@/lib/api";

   // ❌ Don't redeclare per-file
   const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
   ```

3. **Port conventions** — local dev defaults must use the correct port:
   - Frontend (Next.js): `3000`
   - Backend (NestJS): `3001`
   - Demucs Worker: `8000`
   - Anvil (local chain): `8545`
   - AA Bundler: `4337`

4. **Never commit secrets** — API keys, JWT secrets, private keys, and service account
   credentials must come from environment variables or secret managers, never from source.

### Environment Variable Naming

| Layer              | Prefix         | Example                                |
| ------------------ | -------------- | -------------------------------------- |
| Frontend (browser) | `NEXT_PUBLIC_` | `NEXT_PUBLIC_API_URL`                  |
| Frontend (server)  | none           | `BACKEND_URL`                          |
| Backend            | none           | `STORAGE_PROVIDER`, `GCS_STEMS_BUCKET` |

### Required Environment Variables

Document any new env var in `docs/deployment.md` and the relevant Terraform config
(`infra/terraform/backend-service.tf` or `infra/terraform/frontend-service.tf`).

---

## Architecture Conventions

### Backend (NestJS)

- Storage provider is selected by `STORAGE_PROVIDER` env var (`gcs`, `ipfs`, `local`)
- BullMQ workers run in the same process (Cloud Run `minScale=1, cpu-throttling=false`)
- Redis connection via `REDIS_HOST` / `REDIS_PORT` (Memorystore in prod)

### Frontend (Next.js)

- API base URL: `NEXT_PUBLIC_API_URL` → defaults to `http://localhost:3001`
- WebSocket URL: same as API URL (Socket.IO on same backend)
- Chain config: `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_RPC_URL`

### Deployment

- Cloud Run in `europe-west1`
- Terraform manages infrastructure (`infra/terraform/`)
- `make deploy-backend ENV=dev` / `make deploy-frontend ENV=dev` for deployments

---

## Code Quality

- Run `npm run lint` in both `backend/` and `web/` before committing
- Prisma schema changes require `npx prisma generate` and migration
- Use `window.confirm()` sparingly — prefer `ConfirmDialog` React component for UX consistency
- Test files go in `__tests__/` or `*.spec.ts` alongside source files
