import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Artist Catalog",
};

export default function RouteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
