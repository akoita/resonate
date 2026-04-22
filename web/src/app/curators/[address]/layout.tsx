import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Curator",
};

export default function RouteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
