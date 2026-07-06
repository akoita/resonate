import "dotenv/config";
import { resolve } from "path";
import { ConfigService } from "@nestjs/config";
import { prisma } from "../db/prisma";
import {
  applyShowCampaignFixtures,
  SHOW_CAMPAIGN_FIXTURES,
  type ShowCampaignEscrowLink,
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

/**
 * #1355 optional escrow linking (OFF by default). To promote a fixture from an
 * honest provisional campaign to a linked artist-authorized escrow campaign,
 * supply both a shared escrow address and a per-slug mapping:
 *
 *   SHOW_CAMPAIGN_ESCROW_ADDRESS=0x...        # deployed ShowCampaignEscrow
 *   SAMPLE_SHOWS_ESCROW_LINKS='{"sennarin-paris":{"contractCampaignId":"1","beneficiaryAddress":"0x..."}}'
 *
 * With no env, or a slug absent from the map, the fixture stays provisional.
 * Beneficiary is required per link because an authorized escrow campaign must
 * have a payout target for hydration to reconcile.
 */
function escrowLinksFromEnv(): Record<string, ShowCampaignEscrowLink> | undefined {
  const escrowAddress = process.env.SHOW_CAMPAIGN_ESCROW_ADDRESS?.trim();
  const raw = process.env.SAMPLE_SHOWS_ESCROW_LINKS?.trim();
  if (!escrowAddress || !raw) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("SAMPLE_SHOWS_ESCROW_LINKS must be valid JSON (slug → { contractCampaignId, beneficiaryAddress }).");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("SAMPLE_SHOWS_ESCROW_LINKS must be a JSON object keyed by campaign slug.");
  }

  const knownSlugs = new Set(SHOW_CAMPAIGN_FIXTURES.map((fixture) => fixture.campaign.slug));
  const links: Record<string, ShowCampaignEscrowLink> = {};
  for (const [slug, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!knownSlugs.has(slug)) throw new Error(`SAMPLE_SHOWS_ESCROW_LINKS references unknown fixture slug: ${slug}`);
    const entry = value as { contractCampaignId?: unknown; beneficiaryAddress?: unknown; beneficiaryType?: unknown };
    const contractCampaignId = String(entry.contractCampaignId ?? "").trim();
    const beneficiaryAddress = String(entry.beneficiaryAddress ?? "").trim();
    if (!contractCampaignId || !beneficiaryAddress) {
      throw new Error(`SAMPLE_SHOWS_ESCROW_LINKS[${slug}] requires both contractCampaignId and beneficiaryAddress.`);
    }
    const beneficiaryType =
      entry.beneficiaryType === "split_contract" || entry.beneficiaryType === "multisig"
        ? entry.beneficiaryType
        : "wallet";
    links[slug] = { escrowContractAddress: escrowAddress, contractCampaignId, beneficiaryAddress, beneficiaryType };
  }
  return Object.keys(links).length > 0 ? links : undefined;
}

async function main() {
  assertSafeEnvironment();
  const dryRun = process.argv.includes("--dry-run");
  const chainId = Number.parseInt(process.env.SAMPLE_SHOWS_CHAIN_ID || process.env.AA_CHAIN_ID || "31337", 10);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("SAMPLE_SHOWS_CHAIN_ID must be a positive integer");
  const assetDirectory = process.env.SAMPLE_SHOWS_ASSET_DIR
    ? resolve(process.env.SAMPLE_SHOWS_ASSET_DIR)
    : resolve(process.cwd(), "fixtures", "show-campaigns", "assets");

  const escrowLinks = escrowLinksFromEnv();
  const result = await applyShowCampaignFixtures(prisma, storageProvider(new ConfigService()), {
    assetDirectory,
    chainId,
    dryRun,
    escrowLinks,
  });
  console.log(`${dryRun ? "Validated" : "Created or refreshed"} ${result.campaigns} sample show campaigns:`);
  for (const fixture of SHOW_CAMPAIGN_FIXTURES) {
    const linked = escrowLinks?.[fixture.campaign.slug];
    const suffix = linked ? ` — linked escrow #${linked.contractCampaignId}` : " — provisional (unlinked)";
    console.log(`- ${fixture.campaign.title} (${fixture.campaign.slug})${suffix}`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
