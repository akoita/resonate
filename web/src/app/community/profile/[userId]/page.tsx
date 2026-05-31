import { PublicCommunityProfile } from "../../../../components/community/PublicCommunityProfile";
import { getPublicCommunityProfile } from "../../../../lib/api";

interface Props {
  params: Promise<{ userId: string }>;
}

export default async function CommunityProfilePage({ params }: Props) {
  const { userId } = await params;
  const decodedUserId = decodeURIComponent(userId);
  const profile = await getPublicCommunityProfile(decodedUserId).catch(() => null);

  return (
    <PublicCommunityProfile
      profile={profile}
      requestedUserId={decodedUserId}
    />
  );
}
