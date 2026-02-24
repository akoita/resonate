
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  try {
    const txs = await prisma.agentTransaction.findMany();
    const purchases = await prisma.stemPurchase.findMany();
    
    console.log("---------------------------------------------------");
    console.log(`Agent Transactions (Sonic Radar Source): ${txs.length}`);
    console.log(`Stem Purchases (Library Source):        ${purchases.length}`);
    console.log("---------------------------------------------------");

    if (txs.length > 0) {
        console.log("Sample Agent Transaction:");
        console.log(JSON.stringify(txs[0], (key, value) => (typeof value === "bigint" ? value.toString() : value), 2));
    } else {
        console.log("No Agent Transactions found.");
    }

    if (purchases.length > 0) {
        console.log("Sample Stem Purchase:");
        console.log(JSON.stringify(purchases[0], (key, value) => (typeof value === "bigint" ? value.toString() : value), 2));
    } else {
        console.log("No Stem Purchases found.");
    }

  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
