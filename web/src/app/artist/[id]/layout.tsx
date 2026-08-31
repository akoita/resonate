import type { Metadata } from "next";
import { getArtistPublic } from "../../../lib/api";
import {
  canonicalPath,
  decodePathSegment,
  publicMetadata,
} from "../../../lib/seo";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const artistId = decodePathSegment(id);

  try {
    const artist = await getArtistPublic(artistId);
    const artistName = artist?.displayName || "Artist";
    return publicMetadata({
      title: artistName,
      description: artist?.summary || `${artistName} on Resonate. Discover releases and remixable music.`,
      image: artist?.imageUrl,
      imageAlt: artistName,
      path: canonicalPath("artist", artistId),
    });
  } catch {
    return publicMetadata({
      title: "Artist",
      description: "Discover artists, releases, and remixable music on Resonate.",
      path: canonicalPath("artist", artistId),
    });
  }
}

export default function RouteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
