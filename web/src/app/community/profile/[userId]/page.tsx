import type { Metadata } from "next";
import { PublicCommunityProfile } from "../../../../components/community/PublicCommunityProfile";
import { getPublicCommunityProfile } from "../../../../lib/api";
import {
  canonicalPath,
  decodePathSegment,
  publicMetadata,
  safeText,
} from "../../../../lib/seo";

interface Props {
  params: Promise<{ userId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { userId } = await params;
  const decodedUserId = decodePathSegment(userId);

  try {
    const publicProfile = await getPublicCommunityProfile(decodedUserId);
    const displayName = safeText(publicProfile?.profile?.displayName, "Community member", 70);
    return publicMetadata({
      title: displayName,
      description: publicProfile?.profile?.bio || "A public Resonate community profile.",
      image: publicProfile?.profile?.avatarUrl,
      imageAlt: displayName,
      path: canonicalPath("community", "profile", decodedUserId),
    });
  } catch {
    return publicMetadata({
      title: "Community profile",
      description: "Discover public community profiles on Resonate.",
      path: canonicalPath("community", "profile", decodedUserId),
    });
  }
}

export default async function CommunityProfilePage({ params }: Props) {
  const { userId } = await params;
  const decodedUserId = decodePathSegment(userId);
  const profile = await getPublicCommunityProfile(decodedUserId).catch(() => null);

  return (
    <PublicCommunityProfile
      profile={profile}
      requestedUserId={decodedUserId}
    />
  );
}
