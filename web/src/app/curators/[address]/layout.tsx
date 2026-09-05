import type { Metadata } from "next";
import { getCuratorProfile } from "../../../lib/api";
import {
  canonicalPath,
  decodePathSegment,
  publicMetadata,
} from "../../../lib/seo";

interface Props {
  params: Promise<{ address: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { address: rawAddress } = await params;
  const address = decodePathSegment(rawAddress);

  // Resolve only the public DTO and keep reputation details out of metadata.
  // The abbreviated public address makes each profile identifiable without
  // adding any owner, reporting, or verification state to crawler output.
  const profile = await getCuratorProfile(address).catch(() => null);
  const publicAddress = profile?.walletAddress || address;
  const curatorLabel = publicAddress.length > 12
    ? `${publicAddress.slice(0, 6)}…${publicAddress.slice(-4)}`
    : publicAddress;

  return publicMetadata({
    title: curatorLabel ? `Curator ${curatorLabel}` : "Curator reputation",
    description: curatorLabel
      ? `Explore the public reporting reputation for curator ${curatorLabel} on Resonate.`
      : "Explore public reporting reputation signals on Resonate.",
    path: canonicalPath("curators", address),
  });
}

export default function RouteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
