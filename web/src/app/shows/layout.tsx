import { publicMetadata } from "../../lib/seo";

export const metadata = {
  ...publicMetadata({
    title: "Shows",
    description:
      "Fan-funded artist booking. Pledge to bring an artist to your city — refunded automatically if the threshold isn't met.",
    path: "/shows",
  }),
  title: {
    default: "Shows",
    template: "%s · Resonate",
  },
};

export default function ShowsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
