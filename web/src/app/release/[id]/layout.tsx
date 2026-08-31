import type { Metadata } from "next";
import { getRelease } from "../../../lib/api";
import {
  canonicalPath,
  decodePathSegment,
  publicMetadata,
  safeText,
} from "../../../lib/seo";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const releaseId = decodePathSegment(id);

  try {
    const release = await getRelease(releaseId);
    const title = safeText(release?.title, "Release", 70);
    const artist = safeText(
      release?.primaryArtist || release?.artist?.displayName,
      "Resonate artist",
      80,
    );
    const type = safeText(release?.type, "Release", 40).toLowerCase();
    const genre = safeText(release?.genre, "", 40);
    const details = [type, genre].filter(Boolean).join(" · ");
    const description = `${title} by ${artist}${details ? ` — ${details}` : ""}. Discover it on Resonate.`;

    return publicMetadata({
      title,
      description,
      image: release?.artworkUrl,
      imageAlt: title,
      path: canonicalPath("release", releaseId),
    });
  } catch {
    return publicMetadata({
      title: "Release",
      description: "Discover releases and remixable music on Resonate.",
      path: canonicalPath("release", releaseId),
    });
  }
}

export default function RouteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
