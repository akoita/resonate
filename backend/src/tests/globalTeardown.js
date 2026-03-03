/**
 * Jest Global Teardown — Testcontainers
 *
 * Stops all infrastructure containers.
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '.testcontainers.env.json');

module.exports = async function globalTeardown() {
  console.log('\n🐳 Stopping Testcontainers...');

  const containers = [
    { name: 'Postgres', ref: global.__TC_PG__ },
    { name: 'Redis', ref: global.__TC_REDIS__ },
    { name: 'Anvil', ref: global.__TC_ANVIL__ },
    { name: 'Pub/Sub', ref: global.__TC_PUBSUB__ },
  ];

  for (const c of containers) {
    if (c.ref) {
      await c.ref.stop();
      console.log('✅ ' + c.name + ' stopped');
    }
  }

  try { fs.unlinkSync(ENV_FILE); } catch (e) { /* ignore */ }
};
