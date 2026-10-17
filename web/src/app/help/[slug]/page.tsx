import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { HelpArticleView } from "../../../components/help/HelpArticleView";
import { articleSlugs, getArticle, isOperatorOnly } from "../../../lib/help";
import {
  canonicalPath,
  decodePathSegment,
  privateMetadata,
  publicMetadata,
} from "../../../lib/seo";

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return articleSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const decodedSlug = decodePathSegment(slug);
  const article = getArticle(decodedSlug);
  if (!article) {
    return publicMetadata({
      title: "Guide not found",
      description: "Browse the Resonate User Guide.",
      path: canonicalPath("help", decodedSlug),
    });
  }
  if (isOperatorOnly(article.audiences)) {
    // Only operators and admins see this guide's body, so keep it out of search engines.
    return privateMetadata({ title: article.title, description: article.summary });
  }
  return publicMetadata({
    title: article.title,
    description: article.summary,
    openGraphType: "article",
    path: canonicalPath("help", decodedSlug),
  });
}

export default async function HelpArticlePage({ params }: Props) {
  const { slug } = await params;
  const article = getArticle(decodePathSegment(slug));
  if (!article) {
    notFound();
  }

  return (
    <div className="help-page help-page--article">
      <HelpArticleView article={article} />
    </div>
  );
}
