/**
 * Jest Setup File — loads Testcontainers env vars
 *
 * Reads DATABASE_URL and REDIS_URL from the temp file
 * written by globalSetup, so every test worker has them.
 */

import fs from 'fs';
import path from 'path';

const ENV_FILE = path.join(__dirname, '.testcontainers.env.json');

try {
  const env = JSON.parse(fs.readFileSync(ENV_FILE, 'utf-8'));
  process.env.DATABASE_URL = env.DATABASE_URL;
  process.env.REDIS_URL = env.REDIS_URL;
} catch {
  // No env file = no Testcontainers (logic tests only)
}
