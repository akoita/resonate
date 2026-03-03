/**
 * Jest Global Setup — Testcontainers
 *
 * Starts all infrastructure containers BEFORE any tests:
 *   - Postgres 16 (schema pushed via Prisma)
 *   - Redis 7
 *   - Anvil (Foundry local Ethereum node)
 *   - Google Pub/Sub emulator
 *
 * Connection strings are written to a temp JSON file for workers.
 * Only dependency: Docker.
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const { PostgreSqlContainer } = require('@testcontainers/postgresql');
const { RedisContainer } = require('@testcontainers/redis');
const { GenericContainer, Wait } = require('testcontainers');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const BACKEND_ROOT = path.resolve(__dirname, '../..');
const ENV_FILE = path.join(__dirname, '.testcontainers.env.json');

module.exports = async function globalSetup() {
  console.log('\n🐳 Starting Testcontainers...');

  const env = {};

  // ===== Postgres =====
  const pgContainer = await new PostgreSqlContainer('postgres:16')
    .withDatabase('resonate_test')
    .withUsername('test')
    .withPassword('test')
    .start();

  env.DATABASE_URL = pgContainer.getConnectionUri();

  // Push Prisma schema (no programmatic API exists for this)
  console.log('📦 Pushing Prisma schema...');
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: BACKEND_ROOT,
    env: Object.assign({}, process.env, { DATABASE_URL: env.DATABASE_URL }),
    stdio: 'pipe',
  });
  console.log('✅ Postgres: ' + env.DATABASE_URL);

  // ===== Redis =====
  const redisContainer = await new RedisContainer('redis:7').start();
  env.REDIS_URL = redisContainer.getConnectionUrl();
  console.log('✅ Redis: ' + env.REDIS_URL);

  // ===== Anvil (Foundry local Ethereum node) =====
  try {
    const anvilContainer = await new GenericContainer('ghcr.io/foundry-rs/foundry:latest')
      .withCommand(['anvil', '--host', '0.0.0.0', '--chain-id', '31337'])
      .withExposedPorts(8545)
      .withWaitStrategy(Wait.forLogMessage('Listening on'))
      .withStartupTimeout(60000)
      .start();

    env.ANVIL_RPC_URL = 'http://' + anvilContainer.getHost() + ':' + anvilContainer.getMappedPort(8545);
    global.__TC_ANVIL__ = anvilContainer;
    console.log('✅ Anvil: ' + env.ANVIL_RPC_URL);
  } catch (err) {
    console.warn('⚠️  Anvil container failed to start (blockchain tests will be skipped): ' + err.message);
    env.ANVIL_RPC_URL = '';
  }

  // ===== Google Pub/Sub Emulator =====
  try {
    const pubsubContainer = await new GenericContainer('gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators')
      .withCommand([
        'gcloud', 'beta', 'emulators', 'pubsub', 'start',
        '--host-port=0.0.0.0:8085',
        '--project=resonate-local',
      ])
      .withExposedPorts(8085)
      .withWaitStrategy(Wait.forLogMessage('Server started'))
      .withStartupTimeout(60000)
      .start();

    env.PUBSUB_EMULATOR_HOST = pubsubContainer.getHost() + ':' + pubsubContainer.getMappedPort(8085);
    env.PUBSUB_PROJECT_ID = 'resonate-local';
    global.__TC_PUBSUB__ = pubsubContainer;
    console.log('✅ Pub/Sub: ' + env.PUBSUB_EMULATOR_HOST);
  } catch (err) {
    console.warn('⚠️  Pub/Sub emulator failed to start (pipeline tests will be skipped): ' + err.message);
    env.PUBSUB_EMULATOR_HOST = '';
  }

  // Write all connection strings for worker processes
  fs.writeFileSync(ENV_FILE, JSON.stringify(env));

  // Store containers for teardown
  global.__TC_PG__ = pgContainer;
  global.__TC_REDIS__ = redisContainer;

  console.log('🚀 All containers ready.\n');
};
