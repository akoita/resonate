
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const eoa = "0x709f2a7d6683e2d6710cdd8eff3649ed7c065120";
  const smartAccount = "0x19552ac7a9d023f03f39a738af01556094252ac7";

  console.log("Checking config for EOA:", eoa);
  const configEOA = await prisma.agentConfig.findUnique({ where: { userId: eoa } });
  console.log("EOA Config:", configEOA);

  console.log("Checking config for Smart Account:", smartAccount);
  const configSA = await prisma.agentConfig.findUnique({ where: { userId: smartAccount } });
  console.log("Smart Account Config:", configSA);

  console.log("--- Session Keys ---");
  const keyEOA = await prisma.sessionKey.findFirst({
      where: { userId: eoa, revokedAt: null, validUntil: { gt: new Date() } }
  });
  console.log("EOA Active Key:", keyEOA ? "YES (id=" + keyEOA.id + ")" : "NO");

  const keySA = await prisma.sessionKey.findFirst({
      where: { userId: smartAccount, revokedAt: null, validUntil: { gt: new Date() } }
  });
  console.log("Smart Account Active Key:", keySA ? "YES (id=" + keySA.id + ")" : "NO");

  console.log("--- Latest Session ---");
  const session = await prisma.session.findFirst({
      where: { userId: eoa },
      orderBy: { startedAt: 'desc' },
      include: {
          licenses: {
              include: {
                  track: {
                      include: {
                          stems: {
                              include: {
                                  listings: {
                                      where: { status: 'active' }
                                  }
                              }
                          }
                      }
                  }
              }
          }
      }
  });

  if (session) {
      console.log('Session ID:', session.id, 'Started At:', session.startedAt);
      console.log('Licenses found:', session.licenses.length);
      for (const lic of session.licenses) {
          console.log(`Track: ${lic.track.title} (${lic.trackId})`);
          let totalListings = 0;
          if (lic.track && lic.track.stems) {
            for (const stem of lic.track.stems) {
                 console.log(`  Stem: ${stem.type} - Listings: ${stem.listings.length}`);
                 totalListings += stem.listings.length;
            }
          }
          if (totalListings === 0) console.log("  ⚠️ NO ACTIVE LISTINGS FOUND IN DB");

          // Check transactions for this session
          const txs = await prisma.agentTransaction.findMany({
              where: { sessionId: session.id }
          });
          console.log(`  Transactions for session: ${txs.length}`);
          txs.forEach(tx => console.log(`    Tx: ${tx.id} Status: ${tx.status} Error: ${tx.errorMessage}`));
      }
  } else {
      console.log("No session found.");
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
