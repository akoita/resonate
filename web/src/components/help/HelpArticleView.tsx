import Link from "next/link";

import { articleStatus, relatedArticles } from "../../lib/help";
import { STATUS_LABELS, audienceLabel, categoryMeta } from "../../lib/help/taxonomy";
import type { HelpArticle } from "../../lib/help/types";
import { HelpBlocks } from "./HelpBlocks";

/**
 * Renders a full guide article. Server component — fully readable without
 * JavaScript. Heading order is h1 (title) → h2 (each section) so screen
 * readers and the "On this page" nav stay consistent.
 */
export function HelpArticleView({ article }: { article: HelpArticle }) {
  const category = categoryMeta(article.category);
  const status = articleStatus(article);
  const related = relatedArticles(article);
  const showToc = article.sections.length > 1;

  return (
    <article className="help-article">
      <nav className="help-breadcrumb" aria-label="Breadcrumb">
        <Link href="/help">User Guide</Link>
        <span className="help-breadcrumb__sep" aria-hidden="true">›</span>
        <span aria-current="page">{category?.label ?? "Help"}</span>
      </nav>

      <header className="help-article__header">
        {category ? <p className="help-kicker">{category.label}</p> : null}
        <h1 className="help-article__title">{article.title}</h1>
        <p className="help-article__summary">{article.summary}</p>
        <div className="help-chips" aria-label="Who this guide is for">
          {article.audiences.map((a) => (
            <span className="help-chip" key={a}>
              {audienceLabel(a)}
            </span>
          ))}
          {status !== "available" ? (
            <span className={`help-chip help-chip--status help-chip--${status}`}>
              {STATUS_LABELS[status]}
            </span>
          ) : null}
        </div>
      </header>

      {showToc ? (
        <nav className="help-toc" aria-label="On this page">
          <p className="help-toc__title">On this page</p>
          <ul>
            {article.sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.heading}</a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <div className="help-article__body">
        {article.sections.map((section) => (
          <section
            key={section.id}
            id={section.id}
            className="help-section"
            aria-labelledby={`${section.id}-h`}
          >
            <h2 id={`${section.id}-h`} className="help-section__heading">
              <a className="help-anchor" href={`#${section.id}`} aria-label={`Link to “${section.heading}”`}>
                #
              </a>
              {section.heading}
            </h2>
            <HelpBlocks blocks={section.blocks} />
          </section>
        ))}
      </div>

      {article.appLinks && article.appLinks.length > 0 ? (
        <section className="help-applinks" aria-labelledby="help-applinks-h">
          <h2 id="help-applinks-h" className="help-section__heading">
            Open in the app
          </h2>
          <ul className="help-applinks__list">
            {article.appLinks.map((link) => (
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
      ) : null}

      {related.length > 0 ? (
        <section className="help-related" aria-labelledby="help-related-h">
          <h2 id="help-related-h" className="help-section__heading">
            Related guides
          </h2>
          <ul className="help-related__list">
            {related.map((r) => (
              <li key={r.slug}>
                <Link href={`/help/${r.slug}`} className="help-related__link">
                  <span className="help-related__title">{r.title}</span>
                  <span className="help-related__summary">{r.summary}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="help-article__footer">
        <Link href="/help" className="help-textbtn">
          ← Back to the User Guide
        </Link>
      </footer>
    </article>
  );
}
