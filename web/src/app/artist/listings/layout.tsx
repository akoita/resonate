import { privateMetadata } from "../../../lib/seo";

export const metadata = privateMetadata({ title: "Listings" });

export default function ArtistListingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
