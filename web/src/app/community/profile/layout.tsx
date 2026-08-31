import { publicMetadata } from "../../../lib/seo";

// `/community` is an authenticated hub, but public profile pages are
// indexable and provide their own redacted dynamic metadata at the page level.
export const metadata = {
  ...publicMetadata({
    title: "Community profile",
    description: "Discover public community profiles on Resonate.",
    path: "/community/profile",
  }),
  title: {
    default: "Community profile",
    template: "%s · Resonate",
  },
};

export default function PublicCommunityProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
