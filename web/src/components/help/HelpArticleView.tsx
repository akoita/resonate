import Link from "next/link";

import { articleStatus, isLevelledArticle, isOperatorOnly, relatedArticles } from "../../lib/help";
import { STATUS_LABELS, categoryMeta } from "../../lib/help/taxonomy";
import type { HelpArticle } from "../../lib/help/types";
import {
  HelpAppLinks,
  HelpArticleBody,
  HelpAudienceChips,
  HelpOperatorOnly,
  HelpRelatedList,
} from "./HelpReaderViews";

/**
 * Renders a full guide article. Server component — fully readable without
 * JavaScript. Heading order is h1 (title) → h2 (each section) so screen
 * readers and the "On this page" nav stay consistent. Operator and admin
 * material shows only to operators and admins (`HelpReaderViews`).
 */
export function HelpArticleView({ article }: { article: HelpArticle }) {
  const category = categoryMeta(article.category);
  const status = articleStatus(article);
  const related = relatedArticles(article).map((r) => ({
    slug: r.slug,
    title: r.title,
    summary: r.summary,
    ...(isOperatorOnly(r.audiences) ? { audience: "operator" as const } : {}),
  }));
  const levelled = isLevelledArticle(article);
  const body = (
    <>
      <HelpArticleBody sections={article.sections} levelled={levelled} intros={article.levelIntros ?? {}} />
      <HelpAppLinks links={article.appLinks ?? []} />
    </>
  );

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
          <HelpAudienceChips audiences={article.audiences} />
          {status !== "available" ? (
            <span className={`help-chip help-chip--status help-chip--${status}`}>
              {STATUS_LABELS[status]}
            </span>
          ) : null}
        </div>
      </header>

      {isOperatorOnly(article.audiences) ? <HelpOperatorOnly>{body}</HelpOperatorOnly> : body}

      <HelpRelatedList items={related} />

      <footer className="help-article__footer">
        <Link href="/help" className="help-textbtn">
          ← Back to the User Guide
        </Link>
      </footer>
    </article>
  );
}
