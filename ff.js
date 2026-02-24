const { PrismaClient } = require('./dist/db/prisma');
const prisma = new PrismaClient();
async function main() {
  await prisma.indexerState.update({
    where: { chainId: 11155111 },
    data: { lastBlockNumber: 10295000n }
  });
  console.log("SUCCESS: Indexer advanced to 10295000");
}
main().catch(console.error).finally(() => process.exit(0));
