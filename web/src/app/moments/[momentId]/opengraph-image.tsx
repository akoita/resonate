import { ImageResponse } from "next/og";
import { buildOgIngredients, fetchPublicMoment } from "../../../lib/momentShare";

/**
 * Server-rendered OG share card for a moment permalink (#1477 slice 2) — the
 * repo's first `ImageResponse` route. 1200×630, seeded-hue gradient background
 * (matching the in-app card's accent), the MASKED lyric as slogan-scale poster
 * text, a serial chip, an artist · track footer, the Resonate · Drops wordmark,
 * and the rights label.
 *
 * NOTE: Next's file-based `opengraph-image` route receives only `params`, never
 * `searchParams`, so it cannot know the `?c=<collectibleId>` edition. The serial
 * is therefore always the generic `№ 1–{editionSize}`; the pride serial lives in
 * the page's HTML/metadata, not the image.
 */

export const runtime = "nodejs";
export const alt = "A collectible vocal moment on Resonate";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

interface OgProps {
  params: Promise<{ momentId: string }>;
}

export default async function OpengraphImage({ params }: OgProps) {
  const { momentId } = await params;
  const share = await fetchPublicMoment(momentId);
  const ing = buildOgIngredients(share);
  const footerMeta = [ing.editionsLabel, ing.priceLabel].filter(Boolean).join(" · ");

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px",
          background: `linear-gradient(135deg, ${ing.gradientFrom}, ${ing.gradientTo})`,
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: "0.06em",
          }}
        >
          <div style={{ display: "flex" }}>{ing.wordmark}</div>
          <div
            style={{
              display: "flex",
              background: "rgba(0,0,0,0.28)",
              borderRadius: 999,
              padding: "10px 26px",
              fontSize: 30,
            }}
          >
            {ing.serialLabel}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", maxWidth: "1040px" }}>
          <div
            style={{
              display: "flex",
              fontSize: ing.lyricFontPx,
              fontWeight: 800,
              lineHeight: 1.12,
            }}
          >
            {`“${ing.lyric}”`}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 36, fontWeight: 600 }}>
              {ing.artistLine}
            </div>
            {footerMeta ? (
              <div style={{ display: "flex", fontSize: 26, opacity: 0.85, marginTop: 10 }}>
                {footerMeta}
              </div>
            ) : (
              <div style={{ display: "flex" }} />
            )}
          </div>
          <div style={{ display: "flex", fontSize: 20, opacity: 0.8 }}>
            {ing.rightsLabel}
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
