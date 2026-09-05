import { privateMetadata } from "../../lib/seo";

export const metadata = privateMetadata({ title: "Sonic Radar" });

export default function SonicRadarLayout({ children }: { children: React.ReactNode }) {
  return children;
}
