import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Shows",
  description:
    "Fan-funded artist booking. Pledge to bring an artist to your city — refunded automatically if the threshold isn't met.",
};

export default function ShowsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
