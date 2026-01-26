const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const sampleUri = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3";
    const updated = await prisma.stem.updateMany({
        data: { uri: sampleUri }
    });
    console.log(`Updated ${updated.count} stems.`);
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
