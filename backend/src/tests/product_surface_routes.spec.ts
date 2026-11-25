import { GUARDS_METADATA } from "@nestjs/common/constants";
import type { ProductSurface } from "../config/product_surfaces";
import { ProductSurfaceGuard } from "../modules/product_surfaces/product_surface.guard";
import { ShowsController } from "../modules/shows/shows.controller";
import { PunchlineController } from "../modules/punchline/punchline.controller";
import { CratesController } from "../modules/crates/crates.controller";
import { X402Controller } from "../modules/x402/x402.controller";
import { PurchaseConsentController } from "../modules/purchase_consent/purchase_consent.controller";
import { WalletController } from "../modules/identity/wallet.controller";
import { GenerationController } from "../modules/generation/generation.controller";

/**
 * Pins every route that a product surface switch refuses (#2658). Removing a
 * gate, or moving a route to another surface, must be a deliberate change here.
 */
const GATED_ROUTES: Array<[string, any, string, ProductSurface]> = [
  ["POST /shows/campaigns/:id/pledges/intent", ShowsController, "createPledgeIntent", "showsPledging"],
  ["GET /punchline/moments/:id/collect/quote", PunchlineController, "getCollectQuote", "paidCollects"],
  ["POST /crates/:id/quote", CratesController, "createQuote", "stemPurchases"],
  ["GET /api/stems/:id/x402", X402Controller, "downloadWithPayment", "stemPurchases"],
  ["POST /purchase-consents", PurchaseConsentController, "record", "stemPurchases"],
  ["POST /wallet/fund", WalletController, "fund", "wallet"],
  ["POST /wallet/budget", WalletController, "setBudget", "wallet"],
  ["POST /wallet/provider", WalletController, "setProvider", "wallet"],
  ["POST /wallet/agent/enable", WalletController, "enableAgentWallet", "agentPayments"],
  ["POST /wallet/agent/session-key/activate", WalletController, "activateSessionKey", "agentPayments"],
  ["POST /wallet/agent/purchase", WalletController, "agentPurchase", "agentPayments"],
  ["POST /generation/create", GenerationController, "create", "aiGeneration"],
  ["POST /generation/complementary", GenerationController, "generateComplementary", "aiGeneration"],
  ["POST /generation/artwork", GenerationController, "generateArtwork", "aiGeneration"],
];

describe("product surface route gates (#2658)", () => {
  it.each(GATED_ROUTES)("%s is gated", (_route, controller, method, surface) => {
    const handler = controller.prototype[method];
    expect(typeof handler).toBe("function");
    const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, handler) ?? [];
    const surfaces = guards
      .filter((guard): guard is ProductSurfaceGuard => guard instanceof ProductSurfaceGuard)
      .map((guard) => guard.surface);
    expect(surfaces).toEqual([surface]);
  });
});
