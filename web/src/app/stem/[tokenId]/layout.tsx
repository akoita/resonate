import type { Metadata } from "next";
import { API_BASE } from "../../../lib/api";
import {
  canonicalPath,
  configuredChainId,
  decodePathSegment,
  publicMetadata,
} from "../../../lib/seo";

interface Props {
  params: Promise<{ tokenId: string }>;
}

type PublicStemTokenMetadata = {
  name?: unknown;
  description?: unknown;
  image?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function getPublicStemTokenMetadata(tokenId: string): Promise<PublicStemTokenMetadata | null> {
  const chainId = configuredChainId();
  const apiBase = API_BASE.replace(/\/+$/, "");
  try {
    const response = await fetch(
      `${apiBase}/metadata/${chainId}/${encodeURIComponent(tokenId)}`,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
      },
    );
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (!isRecord(payload)) return null;
    return payload as PublicStemTokenMetadata;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tokenId: rawTokenId } = await params;
  const tokenId = decodePathSegment(rawTokenId);
  const tokenMetadata = await getPublicStemTokenMetadata(tokenId);
  const fallbackTitle = tokenId ? `Stem #${tokenId}` : "Stem";

  return publicMetadata({
    title: tokenMetadata?.name || fallbackTitle,
    description:
      tokenMetadata?.description ||
      "Explore this music stem and its remix permissions on Resonate.",
    image: tokenMetadata?.image,
    imageAlt: tokenMetadata?.name || fallbackTitle,
    path: canonicalPath("stem", tokenId),
  });
}

export default function RouteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
