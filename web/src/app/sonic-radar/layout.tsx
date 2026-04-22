import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sonic Radar",
};

export default function RouteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
