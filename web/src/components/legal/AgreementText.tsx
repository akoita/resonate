import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * The artist participation agreement (#2666). The operator writes it in
 * Markdown; raw HTML in it is not rendered.
 */
export function AgreementText({ markdown }: { markdown: string }) {
  return (
    <div className="legal-page legal-page--embedded">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </div>
  );
}
