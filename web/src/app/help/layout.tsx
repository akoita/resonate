import { publicMetadata } from "../../lib/seo";

const HELP_DESCRIPTION =
  "Learn how to use Resonate — discover and play music, collect and sell stems, create and remix with AI, back live shows, and manage your account.";

export const metadata = {
  ...publicMetadata({
    title: "User Guide",
    description: HELP_DESCRIPTION,
    path: "/help",
  }),
  title: {
    default: "User Guide",
    template: "%s · User Guide · Resonate",
  },
};

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return <div className="help-root">{children}</div>;
}
