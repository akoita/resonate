import { recordProductAnalyticsEvent, type ProductAnalyticsInput } from "./api";
import { TOKEN_KEY } from "./authSession";

const SESSION_STORAGE_KEY = "resonate.product.sessionId";

export const PRODUCT_ANALYTICS_EVENT_NAMES = [
  "onboarding.started",
  "onboarding.step_viewed",
  "onboarding.step_completed",
  "onboarding.completed",
  "onboarding.abandoned",
  "playlist.created",
  "playlist.updated",
  "playlist.track_added",
  "playlist.track_removed",
  "playlist.played",
  "playlist.visibility_changed",
  "playlist.shared",
  "playlist.saved",
  "playlist.removed_from_library",
  "library.saved",
  "library.removed",
  "search.submitted",
  "search.result_clicked",
  "marketplace.listing_viewed",
  "marketplace.checkout_started",
  "marketplace.purchase_intent",
  "marketplace.owner_inventory_viewed",
  "player.action_impression",
  "player.action_selected",
  "artist.upload_started",
  "artist.upload_step_completed",
  "artist.catalog_viewed",
  "artist.action_card_impression",
  "artist.action_card_clicked",
  "wallet.connected",
  "wallet.faucet_requested",
  "wallet.budget_set",
  "agent.intent_viewed",
  "agent.intent_selected",
  "agent.session_started",
  "agent.session_stopped",
  "agent.next_pick_requested",
  "settings.updated",
  "taste_memory.settings_updated",
  "taste_memory.signal_hidden",
  "taste_memory.signal_restored",
  "taste_memory.reset",
  "community.profile_updated",
  "community.profile_visibility_updated",
  "community.profile_showcase_updated",
  "community.artist_tab_viewed",
  "community.room_selected",
  "community.room_join_clicked",
  "remix.cta_impression",
  "remix.cta_clicked",
  "remix.studio_opened",
  "remix.studio_saved",
  "remix.studio_action_unavailable",
  "remix.published",
  "punchline.drop_viewed",
  "punchline.preview_played",
  "punchline.collect_started",
  "punchline.collect_completed",
  "recommendation.served",
  "recommendation.clicked",
] as const;

export type ProductAnalyticsEventName = (typeof PRODUCT_ANALYTICS_EVENT_NAMES)[number];

export type ProductAnalyticsPayloadValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | string[]
  | number[]
  | boolean[];

export type ProductAnalyticsPayload = Record<string, ProductAnalyticsPayloadValue>;

export type ProductAnalyticsEventInput = Omit<
  ProductAnalyticsInput,
  "eventName" | "sessionId" | "clientEventId" | "payload"
> & {
  sessionId?: string;
  clientEventId?: string;
  payload?: ProductAnalyticsPayload;
};

export function getProductAnalyticsSessionId() {
  if (typeof window === "undefined") {
    return "product_ssr";
  }

  const generated = createProductAnalyticsId("product_session");

  try {
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) {
      return existing;
    }
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, generated);
  } catch {
    return generated;
  }

  return generated;
}

export function createProductAnalyticsClientEventId() {
  return createProductAnalyticsId("product_event");
}

export async function recordProductAnalytics(
  token: string | null | undefined,
  eventName: ProductAnalyticsEventName,
  input: ProductAnalyticsEventInput = {},
) {
  if (!token) return null;

  const event: ProductAnalyticsInput = {
    ...input,
    eventName,
    sessionId: input.sessionId ?? getProductAnalyticsSessionId(),
    clientEventId: input.clientEventId ?? createProductAnalyticsClientEventId(),
    source: input.source ?? "web",
    payload: input.payload ? compactProductAnalyticsPayload(input.payload) : undefined,
  };

  try {
    return await recordProductAnalyticsEvent(token, event);
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.warn("[Analytics] Product event dropped", { eventName, error });
    }
    return null;
  }
}

export function recordProductAnalyticsFromBrowser(
  eventName: ProductAnalyticsEventName,
  input: ProductAnalyticsEventInput = {},
) {
  const token = getStoredAnalyticsToken();
  void recordProductAnalytics(token, eventName, input);
}

export function compactProductAnalyticsPayload(payload: ProductAnalyticsPayload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );
}

function getStoredAnalyticsToken() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function createProductAnalyticsId(prefix: string) {
  if (typeof window !== "undefined" && "crypto" in window && "randomUUID" in window.crypto) {
    return window.crypto.randomUUID();
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
