import type { Metadata } from "next";

import { HelpBrowser } from "../../components/help/HelpBrowser";
import { AUDIENCES, CATEGORIES, indexEntries } from "../../lib/help";

export const metadata: Metadata = {
  title: "User Guide",
  description:
    "Plain-language guides to everything in Resonate — from your first sign-in to running a fan-funded show.",
};

export default function HelpLandingPage() {
  const entries = indexEntries();

  return (
    <div className="help-page">
      <header className="help-hero">
        <p className="help-kicker">User Guide</p>
        <h1 className="help-hero__title">How can we help?</h1>
        <p className="help-hero__lead">
          Plain-language guides to everything in Resonate — from your first sign-in to running a
          fan-funded show. Search below, or pick the topics that match how you use Resonate.
        </p>
      </header>

      <HelpBrowser entries={entries} categories={CATEGORIES} audiences={AUDIENCES} />
    </div>
  );
}
