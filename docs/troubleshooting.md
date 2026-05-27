# Troubleshooting

Quick fixes for the most common local-dev issues. If your problem isn't listed
here, check the topic-specific guides linked at the bottom.

## Common Issues

| Symptom | Cause | Fix |
| --- | --- | --- |
| Container shows "Created" (not "Up") | Port conflict — another container or process is using the port | Run `docker ps` to find the conflicting container, then `docker stop <name>` |
| Redis won't start (port 6379) | Stale Redis from another project | Stop the conflicting container, then rerun `make dev-up` |
| Track stuck at "🔵 Pending" forever | `PUBSUB_EMULATOR_HOST` missing from `backend/.env` | Run `make pubsub-init` then restart backend; `make backend-dev` auto-adds it |
| Worker logs: "Subscription does not exist" | PubSub emulator has no topics (emulator restarted) | Run `make pubsub-init`, then restart the worker with `make worker-gpu` |
| Track stuck at "🟡 Separating..." | Demucs worker not running, stale image, or import errors | Check `make worker-health`, then `make worker-logs`, then `make worker-rebuild` if needed |
| No progress % during separation | Worker can't POST progress back to backend | Leave `BACKEND_URL` unset for local fallback or set it to a Docker-reachable backend URL |
| `SEPOLIA_RPC_URL` warning in Docker logs | Env var not exported in the shell running the AA stack | Export `SEPOLIA_RPC_URL=https://sepolia.drpc.org` before `make local-aa-fork` |

## Demucs Worker

For GPU setup, image rebuilds, and worker-specific troubleshooting see
[`workers/demucs/README.md`](../workers/demucs/README.md).

## Smart Contracts

For contract deployment issues, local Anvil problems, and Foundry configuration
see [`docs/smart-contracts/deployment.md`](smart-contracts/deployment.md).

## Environment Variables

For a full list of required and optional environment variables see
[`docs/deployment/environment.md`](deployment/environment.md).
