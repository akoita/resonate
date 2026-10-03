import { prisma } from "../db/prisma";
import { DiscoveryPopularityExportService } from "../modules/catalog/discovery-popularity-export.service";
import { RedisCacheService } from "../modules/shared/redis_cache.service";

/**
 * Scheduled batch entry point for #1450. BigQuery access is read-only; the
 * exporter reads the Dataform marts and writes one atomic Postgres snapshot.
 * Run with DISCOVERY_POPULARITY_SOURCE=warehouse.
 */
async function main() {
  const redisCache = new RedisCacheService();
  try {
    const result = await new DiscoveryPopularityExportService(redisCache).refreshFromWarehouse();
    process.stdout.write(
      `Discovery popularity exported ${result.trackRows} track and ${result.artistRows} artist rows ` +
        `(computed ${result.computedAt}).\n`,
    );
  } finally {
    await redisCache.onModuleDestroy();
  }
}

void main()
  .catch((error) => {
    process.stderr.write(
      `Discovery popularity export failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
