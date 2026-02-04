# Contributing

> **Note**: This is a personal learning project and I'm not actively accepting contributions at this time. Feel free to explore the codebase, fork it, or open issues for discussion, but please don't expect PR reviews or merges.

If this changes in the future, I'll update this document.

## For Reference

If you're exploring the codebase, here's how it's organized:

- **`backend/`** — NestJS API with Prisma, BullMQ job processing
- **`web/`** — Next.js frontend
- **`contracts/`** — Solidity smart contracts (Foundry)
- **`workers/`** — Microservices (Demucs AI stem separation)
- **`docs/`** — Project specifications and guides

## Running the Stack

```bash
make dev-up          # Start Docker services (PostgreSQL, Redis, Demucs)
make backend-dev     # Start NestJS API
make web-dev         # Start Next.js frontend
make worker-logs     # View Demucs worker logs
```

See [README.md](README.md) for detailed setup instructions.
