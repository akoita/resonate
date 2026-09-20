import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const LINKS = [
  ["/terms", "Terms"],
  ["/privacy", "Privacy"],
  ["/refunds", "Refunds"],
  ["/imprint", "Imprint & contact"],
] as const;

export function LegalPage({ markdown }: { markdown: string }) {
  return (
    <article className="legal-page">
      <nav className="legal-page__nav" aria-label="Legal documents">
        {LINKS.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
      </nav>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href = "", children }) => href.startsWith("/")
            ? <Link href={href}>{children}</Link>
            : <a href={href}>{children}</a>,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  );
}
