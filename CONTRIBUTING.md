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

## Infrastructure

Infrastructure-as-code and the local Dockerized stack now live in
[`akoita/resonate-iac`](https://github.com/akoita/resonate-iac).

- Use `resonate-iac` for local stack startup/shutdown, Docker logs, deploy workflows,
  and infra changes.
- Use this repo for backend, frontend, contract, and app-local configuration work.

## Running the App

```bash
make backend-dev     # Start NestJS API
make web-dev         # Start Next.js frontend
make worker-health   # Check the Demucs worker started from resonate-iac
make pubsub-init     # Recreate local Pub/Sub emulator topics if needed
```

Start the supporting local services from `resonate-iac` first, then use the commands
above from this repo.

See [README.md](README.md) for detailed setup instructions.
