const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });
async function run() {
  await client.connect();
  const res = await client.query('UPDATE "IndexerState" SET "lastBlockNumber" = 10295000 WHERE "chainId" = 11155111');
  console.log("SUCCESS DB UPDATE:", res.rowCount);
  await client.end();
}
run().catch(console.error).finally(() => process.exit(0));
