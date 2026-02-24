const { PrismaClient } = require("@prisma/client");

async function check() {
  const prisma = new PrismaClient();
  
  const wallets = await prisma.wallet.findMany({
    take: 10
  });
  
  console.log("All Wallets:", wallets);
  await prisma.$disconnect();
}

check().catch(console.error);
