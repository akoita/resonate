import Link from "next/link";

import { articleStatus, isLevelledArticle, relatedArticles } from "../../lib/help";
import { STATUS_LABELS, audienceLabel, categoryMeta } from "../../lib/help/taxonomy";
import type { HelpArticle } from "../../lib/help/types";
import { HelpLevelledBody } from "./HelpLevelledBody";
import { HelpSectionView, HelpToc } from "./HelpSectionView";

/**
 * Renders a full guide article. Server component — fully readable without
 * JavaScript. Heading order is h1 (title) → h2 (each section) so screen
 * readers and the "On this page" nav stay consistent.
 */
export function HelpArticleView({ article }: { article: HelpArticle }) {
  const category = categoryMeta(article.category);
  const status = articleStatus(article);
  const related = relatedArticles(article);
  const levelled = isLevelledArticle(article);

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

      {levelled ? (
        // Beginner / Intermediate / Professional switch (#1905); the outline
        // lives inside it and follows the selected level.
        <HelpLevelledBody sections={article.sections} intros={article.levelIntros ?? {}} />
      ) : (
        <>
          <HelpToc sections={article.sections} />
          <div className="help-article__body">
            {article.sections.map((section) => (
              <HelpSectionView key={section.id} section={section} />
            ))}
          </div>
        </>
      )}

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
