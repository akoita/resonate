import Image from "next/image";
import { API_BASE } from "../../lib/api";

export type HomeCampaignVisualProps = {
  src: string;
  sizes: string;
  className?: string;
  preload?: boolean;
};

const campaignVisualApiUrl = new URL(API_BASE);
const campaignVisualApiBasePath = campaignVisualApiUrl.pathname.replace(/\/+$/, "");
const escapedCampaignVisualApiBasePath = campaignVisualApiBasePath.replace(
  /[.*+?^${}()|[\]\\]/g,
  "\\$&",
);
const campaignVisualPathPattern = new RegExp(
  `^${escapedCampaignVisualApiBasePath}/shows/campaigns/[^/]+/visuals/[^/]+(?:/v[1-9]\\d*)?$`,
);

/**
 * The Next optimizer may fetch only canonical campaign visual responses from
 * the configured API. External, local, blob/data, query-bearing, and malformed
 * sources keep the browser-direct fallback.
 */
export function shouldOptimizeHomeCampaignVisual(src: string): boolean {
  try {
    const url = new URL(src);
    return url.origin === campaignVisualApiUrl.origin
      && url.username === ""
      && url.password === ""
      && url.search === ""
      && url.hash === ""
      && campaignVisualPathPattern.test(url.pathname);
  } catch {
    return false;
  }
}

/** Decorative responsive campaign artwork used by the Home hero and cards. */
export function HomeCampaignVisual({
  src,
  sizes,
  className,
  preload = false,
}: HomeCampaignVisualProps) {
  const classes = ["ng-home-campaign-visual", className].filter(Boolean).join(" ");

  if (shouldOptimizeHomeCampaignVisual(src)) {
    return (
      <Image
        src={src}
        alt=""
        fill
        sizes={sizes}
        className={classes}
        {...(preload ? { preload: true } : { loading: "lazy" as const })}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- non-canonical campaign media must bypass the server-side optimizer.
    <img
      src={src}
      alt=""
      sizes={sizes}
      className={classes}
      loading={preload ? "eager" : "lazy"}
      fetchPriority={preload ? "high" : undefined}
      decoding="async"
    />
  );
}
