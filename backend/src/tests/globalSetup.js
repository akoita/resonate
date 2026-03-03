/**
 * Jest Global Setup — Testcontainers
 *
 * Starts Postgres and Redis containers BEFORE any tests.
 * Connection strings are written to a temp file for workers.
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const { PostgreSqlContainer } = require('@testcontainers/postgresql');
const { RedisContainer } = require('@testcontainers/redis');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const BACKEND_ROOT = path.resolve(__dirname, '../..');
const ENV_FILE = path.join(__dirname, '.testcontainers.env.json');

module.exports = async function globalSetup() {
  console.log('\n🐳 Starting Testcontainers...');

  // Postgres
  const pgContainer = await new PostgreSqlContainer('postgres:16')
    .withDatabase('resonate_test')
    .withUsername('test')
    .withPassword('test')
    .start();

  const connectionUri = pgContainer.getConnectionUri();

  // Push Prisma schema (no programmatic API exists for this)
  console.log('📦 Pushing Prisma schema...');
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: BACKEND_ROOT,
    env: Object.assign({}, process.env, { DATABASE_URL: connectionUri }),
    stdio: 'pipe',
  });

  // Redis
  const redisContainer = await new RedisContainer('redis:7').start();
  const redisUrl = redisContainer.getConnectionUrl();

  // Write connection strings for worker processes
  fs.writeFileSync(ENV_FILE, JSON.stringify({
    DATABASE_URL: connectionUri,
    REDIS_URL: redisUrl,
  }));

  // Store refs for teardown (same process)
  global.__TC_PG__ = pgContainer;
  global.__TC_REDIS__ = redisContainer;

  console.log('✅ Postgres: ' + connectionUri);
  console.log('✅ Redis: ' + redisUrl + '\n');
};
