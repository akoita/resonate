const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const prisma = new PrismaClient();

async function main() {
    const tracks = await prisma.track.findMany({
        where: { id: 'trk_1769525963340_0504d2c1' }, // Target specifically the one that failed
        include: { stems: true }
    });

    console.log(`Found ${tracks.length} tracks to fix.`);

    for (const track of tracks) {
        const uploadDir = path.join(__dirname, 'uploads', track.id);
        if (!fs.existsSync(uploadDir)) {
            console.log(`Upload dir for ${track.id} not found. Skipping.`);
            continue;
        }

        const files = fs.readdirSync(uploadDir).filter(f => !f.startsWith('artwork_'));
        console.log(`Found ${files.length} files in ${uploadDir}`);

        // Clean up the dummy stem I created by accident
        await prisma.stem.deleteMany({
            where: { id: 'stem', trackId: track.id }
        });

        const stemsData = files.map(filename => {
            const parts = filename.split('_');
            const stemId = parts.slice(0, 3).join('_'); // Get stem_timestamp_hex
            const title = parts.slice(3).join('_').replace(/\.[^/.]+$/, "");

            return {
                id: stemId,
                trackId: track.id,
                type: filename.toLowerCase().includes('drum') ? 'drums' :
                    filename.toLowerCase().includes('vocal') ? 'vocals' :
                        filename.toLowerCase().includes('bass') ? 'bass' : 'ORIGINAL',
                uri: `http://localhost:3000/uploads/${track.id}/${encodeURIComponent(filename)}`,
                title: title || filename
            };
        });

        for (const stem of stemsData) {
            console.log(`Upserting stem: ${stem.id} - ${stem.title}`);
            await prisma.stem.upsert({
                where: { id: stem.id },
                update: stem,
                create: stem
            });
        }

        await prisma.track.update({
            where: { id: track.id },
            data: { status: 'ready' }
        });
        console.log(`Track ${track.id} recovered with ${stemsData.length} stems.`);
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
