/**
 * Jest Setup File — loads Testcontainers env vars
 *
 * Reads connection strings from the temp file written by globalSetup,
 * so the global prisma singleton and all services connect to Testcontainers.
 *
 * Env vars set:
 *   DATABASE_URL       → Postgres container
 *   REDIS_URL          → Redis container
 *   ANVIL_RPC_URL      → Anvil (Foundry) container
 *   PUBSUB_EMULATOR_HOST → Pub/Sub emulator container
 *   PUBSUB_PROJECT_ID    → Pub/Sub project ID
 */

import fs from 'fs';
import path from 'path';

const ENV_FILE = path.join(__dirname, '.testcontainers.env.json');

try {
  const env = JSON.parse(fs.readFileSync(ENV_FILE, 'utf-8'));
  for (const [key, value] of Object.entries(env)) {
    if (value) process.env[key] = value as string;
  }
} catch {
  // No env file = no Testcontainers (logic tests only)
}
