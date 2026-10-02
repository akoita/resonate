import { publicMetadata } from "../../lib/seo";

// The "Browse stems" tab is public (the old /marketplace), so the route keeps
// public metadata; the signed-in crate pages under /crates/[id] stay private.
export const metadata = publicMetadata({
  title: "Crates & Stems",
  description:
    "Build a DJ crate from a sentence, or browse stems from artists worldwide and license them on their own.",
  path: "/crates",
});

export default function CratesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
