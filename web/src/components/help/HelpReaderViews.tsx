"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { audiencesForReader, canSeeOperatorHelp, forReader } from "../../lib/help/audience";
import { audienceLabel } from "../../lib/help/taxonomy";
import type { HelpAppLink, HelpAudience, HelpLevel, HelpLevelIntro, HelpSection } from "../../lib/help/types";
import { useAuth } from "../auth/AuthProvider";
import { HelpLevelledBody } from "./HelpLevelledBody";
import { HelpSectionView, HelpToc } from "./HelpSectionView";

/**
 * The parts of an article that depend on who is reading: operator and admin
 * material shows only to signed-in operators and admins. The server render
 * has no role, so it shows the reader view; an operator's extra sections
 * appear once the session is known.
 */
export function useOperatorReader(): boolean {
  const { role } = useAuth();
  return canSeeOperatorHelp(role);
}

export function HelpArticleBody({
  sections,
  levelled,
  intros,
}: {
  sections: HelpSection[];
  levelled: boolean;
  intros: Partial<Record<HelpLevel, HelpLevelIntro>>;
}) {
  const visible = forReader(sections, useOperatorReader());
  if (levelled) {
    // Beginner / Intermediate / Professional switch (#1905); the outline
    // lives inside it and follows the selected level.
    return <HelpLevelledBody sections={visible} intros={intros} />;
  }
  return (
    <>
      <HelpToc sections={visible} />
      <div className="help-article__body">
        {visible.map((section) => (
          <HelpSectionView key={section.id} section={section} />
        ))}
      </div>
    </>
  );
}

export function HelpAudienceChips({ audiences }: { audiences: HelpAudience[] }) {
  const shown = audiencesForReader(audiences, useOperatorReader());
  // An operator-only guide keeps its chip: it says who the guide is for.
  return (
    <>
      {(shown.length > 0 ? shown : audiences).map((a) => (
        <span className="help-chip" key={a}>
          {audienceLabel(a)}
        </span>
      ))}
    </>
  );
}

export function HelpAppLinks({ links }: { links: HelpAppLink[] }) {
  const visible = forReader(links, useOperatorReader());
  if (visible.length === 0) return null;
  return (
    <section className="help-applinks" aria-labelledby="help-applinks-h">
      <h2 id="help-applinks-h" className="help-section__heading">
        Open in the app
      </h2>
      <ul className="help-applinks__list">
        {visible.map((link) => (
          <li key={`${link.href}-${link.label}`}>
            <Link href={link.href} className="help-applink">
              <span className="help-applink__label">{link.label}</span>
              <span className="help-applink__desc">{link.description}</span>
              <span className="help-applink__arrow" aria-hidden="true">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface HelpRelatedItem {
  slug: string;
  title: string;
  summary: string;
  audience?: "operator";
}

export function HelpRelatedList({ items }: { items: HelpRelatedItem[] }) {
  const visible = forReader(items, useOperatorReader());
  if (visible.length === 0) return null;
  return (
    <section className="help-related" aria-labelledby="help-related-h">
      <h2 id="help-related-h" className="help-section__heading">
        Related guides
      </h2>
      <ul className="help-related__list">
        {visible.map((r) => (
          <li key={r.slug}>
            <Link href={`/help/${r.slug}`} className="help-related__link">
              <span className="help-related__title">{r.title}</span>
              <span className="help-related__summary">{r.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** An article written only for operators and admins: everyone else gets a short note. */
export function HelpOperatorOnly({ children }: { children: ReactNode }) {
  if (useOperatorReader()) return <>{children}</>;
  return (
    <aside className="help-callout help-callout--note" role="note">
      <p className="help-callout__label">For operators and admins</p>
      <p className="help-callout__text">
        This guide covers tools that only operators and admins can use. Sign in with an operator or
        admin account to read it, or go back to the User Guide for everything else.
      </p>
    </aside>
  );
}
