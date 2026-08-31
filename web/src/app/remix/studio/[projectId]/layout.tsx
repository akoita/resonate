import { privateMetadata } from "../../../../lib/seo";

export const metadata = privateMetadata({ title: "Remix Studio" });

export default function RemixStudioLayout({ children }: { children: React.ReactNode }) {
  return children;
}
