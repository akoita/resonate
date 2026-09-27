import type { HelpSection } from "../../lib/help/types";
import { HelpBlocks } from "./HelpBlocks";

/**
 * One article section: an h2 with a self-link, then its blocks. Hook-free, so
 * both the server article view and the client level switch render it.
 */
export function HelpSectionView({ section }: { section: HelpSection }) {
  return (
    <section id={section.id} className="help-section" aria-labelledby={`${section.id}-h`}>
      <h2 id={`${section.id}-h`} className="help-section__heading">
        <a className="help-anchor" href={`#${section.id}`} aria-label={`Link to “${section.heading}”`}>
          #
        </a>
        {section.heading}
      </h2>
      <HelpBlocks blocks={section.blocks} />
    </section>
  );
}

/** The "On this page" outline for the sections currently shown. */
export function HelpToc({ sections }: { sections: readonly HelpSection[] }) {
  if (sections.length <= 1) return null;
  return (
    <nav className="help-toc" aria-label="On this page">
      <p className="help-toc__title">On this page</p>
      <ul>
        {sections.map((section) => (
          <li key={section.id}>
            <a href={`#${section.id}`}>{section.heading}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
