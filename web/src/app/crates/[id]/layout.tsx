import { privateMetadata } from "../../../lib/seo";

// A crate is the signed-in owner's own set, so it stays noindex even though the
// parent /crates route is public (its "Browse stems" tab).
export const metadata = privateMetadata({ title: "Crate" });

export default function CrateLayout({ children }: { children: React.ReactNode }) {
  return children;
}
