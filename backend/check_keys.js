const { PrismaClient } = require("@prisma/client");

async function check() {
  const prisma = new PrismaClient();
  const address = "0x50AF7b3C5166990aD7b772f475D5ce1162a20Eb4";
  
  const wallet = await prisma.wallet.findFirst({
    where: { address: { equals: address, mode: "insensitive" } }
  });
  
  console.log("Wallet:", wallet);
  await prisma.$disconnect();
}

check().catch(console.error);
