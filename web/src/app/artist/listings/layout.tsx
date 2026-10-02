import { privateMetadata } from "../../../lib/seo";

export const metadata = privateMetadata({ title: "Manage listings" });

export default function MarketplaceManageLayout({ children }: { children: React.ReactNode }) {
  return children;
}
