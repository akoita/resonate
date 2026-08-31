import { privateMetadata } from "../../lib/seo";

export const metadata = privateMetadata({ title: "Wallet" });

export default function RouteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
