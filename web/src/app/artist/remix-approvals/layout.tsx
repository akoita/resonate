import { privateMetadata } from "../../../lib/seo";

export const metadata = privateMetadata({ title: "Remix approvals" });

export default function RemixApprovalsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
