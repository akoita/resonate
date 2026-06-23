import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { HelpArticleView } from "../../../components/help/HelpArticleView";
import { articleSlugs, getArticle } from "../../../lib/help";

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return articleSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) {
    return { title: "Guide not found" };
  }
  return {
    title: article.title,
    description: article.summary,
    openGraph: {
      title: article.title,
      description: article.summary,
      type: "article",
    },
  };
}

export default async function HelpArticlePage({ params }: Props) {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) {
    notFound();
  }

  return (
    <div className="help-page help-page--article">
      <HelpArticleView article={article} />
    </div>
  );
}
