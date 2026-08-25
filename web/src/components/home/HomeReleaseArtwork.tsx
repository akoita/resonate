import Image from "next/image";
import { getReleaseArtworkUrl } from "../../lib/api";

export type HomeReleaseArtworkProps = {
  releaseId: string;
  mimeType: string;
  artworkRevision?: number | null;
  alt: string;
  sizes: string;
  className?: string;
};

const OPTIMIZABLE_HOME_ARTWORK_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

export function shouldOptimizeHomeReleaseArtwork(mimeType: string): boolean {
  const normalizedMimeType = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return OPTIMIZABLE_HOME_ARTWORK_MIME_TYPES.has(normalizedMimeType);
}

/** Optimized artwork for a canonical public catalog release. */
export function HomeReleaseArtwork({
  releaseId,
  mimeType,
  artworkRevision,
  alt,
  sizes,
  className,
}: HomeReleaseArtworkProps) {
  return (
    <Image
      src={getReleaseArtworkUrl(releaseId, { artworkRevision })}
      alt={alt}
      fill
      sizes={sizes}
      unoptimized={!shouldOptimizeHomeReleaseArtwork(mimeType)}
      className={["ng-home-release-artwork", className].filter(Boolean).join(" ")}
    />
  );
}
