import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    default: "User Guide",
    template: "%s · User Guide · Resonate",
  },
  description:
    "Learn how to use Resonate — discover and play music, collect and sell stems, create and remix with AI, back live shows, and manage your account.",
};

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return <div className="help-root">{children}</div>;
}
