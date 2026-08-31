import { privateMetadata } from "../../../lib/seo";

export const metadata = privateMetadata({ title: "Admin Review" });

export default function AdminDisputesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
