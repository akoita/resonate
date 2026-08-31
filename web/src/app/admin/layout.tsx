import { privateMetadata } from "../../lib/seo";

export const metadata = privateMetadata({ title: "Admin" });

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
