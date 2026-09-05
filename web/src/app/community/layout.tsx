import { privateMetadata } from "../../lib/seo";

export const metadata = privateMetadata({ title: "Community" });

export default function CommunityLayout({ children }: { children: React.ReactNode }) {
  return children;
}
