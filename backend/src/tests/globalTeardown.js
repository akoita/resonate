/**
 * Jest Global Teardown — Testcontainers
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '.testcontainers.env.json');

module.exports = async function globalTeardown() {
  console.log('\n🐳 Stopping Testcontainers...');

  if (global.__TC_PG__) {
    await global.__TC_PG__.stop();
    console.log('✅ Postgres stopped');
  }
  if (global.__TC_REDIS__) {
    await global.__TC_REDIS__.stop();
    console.log('✅ Redis stopped');
  }

  try { fs.unlinkSync(ENV_FILE); } catch (e) { /* ignore */ }
};
