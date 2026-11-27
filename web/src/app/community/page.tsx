"use client";

import AuthGate from "../../components/auth/AuthGate";
import { useAuth } from "../../components/auth/AuthProvider";
import CommunityBenefitsPanel from "../../components/community/CommunityBenefitsPanel";
import ListenerCohortsPanel from "../../components/settings/ListenerCohortsPanel";
import { useToast } from "../../components/ui/Toast";

/**
 * Community hub — the first-class home for listener cohorts and their rooms.
 *
 * Cohorts are privacy-safe peer groups with no other natural anchor (unlike
 * artist or campaign rooms, which live on their subject's page), so this is
 * where members browse and enter them. The chat lived buried in Settings; it
 * is a participation surface, not configuration, and belongs here.
 */
export default function CommunityPage() {
  const { token } = useAuth();
  const { addToast } = useToast();

  return (
    <AuthGate title="Sign in to join your communities.">
      <main className="community-workspace">
        <header className="community-hero">
          <span className="settings-kicker">Communities</span>
          <h1>Your listener communities</h1>
          <p className="community-hero__subtitle">
            Small groups of people who love the same music as you. Join the ones that fit, then meet and talk in
            their rooms. Nobody sees you in a group until you join it.
          </p>
        </header>

        <section className="community-panel" aria-label="Your perks" aria-live="polite">
          <CommunityBenefitsPanel token={token} addToast={addToast} />
        </section>

        <section className="community-panel" aria-label="Your communities">
          <ListenerCohortsPanel token={token} addToast={addToast} />
        </section>
      </main>
    </AuthGate>
  );
}
