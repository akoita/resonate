import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { HelpArticleView } from "../../../components/help/HelpArticleView";
import { articleSlugs, getArticle } from "../../../lib/help";
import {
  canonicalPath,
  decodePathSegment,
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
