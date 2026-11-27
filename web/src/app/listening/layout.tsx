import { privateMetadata } from "../../lib/seo";

export const metadata = privateMetadata({ title: "Your listening" });

export default function ListeningLayout({ children }: { children: React.ReactNode }) {
  return children;
}
