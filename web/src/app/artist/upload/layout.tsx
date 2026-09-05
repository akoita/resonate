import { privateMetadata } from "../../../lib/seo";

export const metadata = privateMetadata({ title: "Upload" });

export default function RouteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
