import "dotenv/config";
import { resolve } from "path";
import { ConfigService } from "@nestjs/config";
import { prisma } from "../db/prisma";
import {
  applyShowCampaignFixtures,
  SHOW_CAMPAIGN_FIXTURES,
} from "../fixtures/show_campaigns";
import { GcsStorageProvider } from "../modules/storage/gcs_storage_provider";
import { LighthouseStorageProvider } from "../modules/storage/lighthouse_storage_provider";
import { LocalStorageProvider } from "../modules/storage/local_storage_provider";
import type { StorageProvider } from "../modules/storage/storage_provider";

function storageProvider(config: ConfigService): StorageProvider {
  const provider = config.get<string>("STORAGE_PROVIDER", "local");
  if (provider === "gcs") return new GcsStorageProvider(config);
  if (provider === "ipfs" || provider === "filecoin") return new LighthouseStorageProvider(config);
  return new LocalStorageProvider();
}

function assertSafeEnvironment() {
  const environment = process.env.DEPLOY_ENV || process.env.APP_ENV || process.env.NODE_ENV || "development";
  const sharedEnvironment = ["dev", "staging", "test", "prod", "production"].includes(environment.toLowerCase());
  if (sharedEnvironment && process.env.ALLOW_SAMPLE_SHOW_FIXTURES !== "true") {
    throw new Error(
      `Refusing to create sample shows in ${environment}. Set ALLOW_SAMPLE_SHOW_FIXTURES=true to opt in explicitly.`,
    );
  }
}

async function main() {
  assertSafeEnvironment();
  const dryRun = process.argv.includes("--dry-run");
  const chainId = Number.parseInt(process.env.SAMPLE_SHOWS_CHAIN_ID || process.env.AA_CHAIN_ID || "31337", 10);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("SAMPLE_SHOWS_CHAIN_ID must be a positive integer");
  const assetDirectory = process.env.SAMPLE_SHOWS_ASSET_DIR
    ? resolve(process.env.SAMPLE_SHOWS_ASSET_DIR)
    : resolve(process.cwd(), "fixtures", "show-campaigns", "assets");

  const result = await applyShowCampaignFixtures(prisma, storageProvider(new ConfigService()), {
    assetDirectory,
    chainId,
    dryRun,
  });
  console.log(`${dryRun ? "Validated" : "Created or refreshed"} ${result.campaigns} sample show campaigns:`);
  for (const fixture of SHOW_CAMPAIGN_FIXTURES) console.log(`- ${fixture.campaign.title} (${fixture.campaign.slug})`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
