import { privateMetadata } from "../../lib/seo";

export const metadata = privateMetadata({ title: "Crate Digger" });

export default function CratesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
