import type { CSSProperties } from "react";
import type { AiDisclosure } from "../../lib/api";

export type AiDisclosureBadgeProps = {
  disclosure?: AiDisclosure | null;
  /** Human-made declarations are normally omitted to keep labels focused. */
  showHumanMade?: boolean;
  className?: string;
};

type BadgePresentation = {
  label: string;
  title: string;
  color: string;
  background: string;
  border: string;
};

function getPresentation(
  disclosure: AiDisclosure | null | undefined,
  showHumanMade: boolean,
): BadgePresentation | null {
  switch (disclosure?.level) {
    case "none":
      return showHumanMade
        ? {
            label: "Human-made",
            title: "The uploader declared that this music contains no AI contribution.",
            color: "#a7f3d0",
            background: "rgba(16, 185, 129, 0.12)",
            border: "rgba(16, 185, 129, 0.3)",
          }
        : null;
    case "partly":
      return {
        label: "AI-assisted",
        title:
          disclosure.source === "remix_derived"
            ? "Resonate derived that AI contributed to part of this remix from its creation mode."
            : "The uploader declared that AI contributed to part of this music.",
        color: "#fde68a",
        background: "rgba(245, 158, 11, 0.12)",
        border: "rgba(245, 158, 11, 0.3)",
      };
    case "all":
      return {
        label: "AI-generated",
        title:
          disclosure.source === "resonate_native"
            ? "Resonate recorded this music as fully AI-generated from platform provenance."
            : disclosure.source === "remix_derived"
              ? "Resonate derived that this remix is fully AI-generated from its creation mode."
              : "The uploader declared that this music is fully AI-generated.",
        color: "#ddd6fe",
        background: "rgba(124, 58, 237, 0.14)",
        border: "rgba(124, 58, 237, 0.34)",
      };
    case "undeclared":
    default:
      return {
        label: "AI disclosure unavailable",
        title: "No reliable AI involvement declaration is available for this music.",
        color: "rgba(255, 255, 255, 0.68)",
        background: "rgba(255, 255, 255, 0.06)",
        border: "rgba(255, 255, 255, 0.18)",
      };
  }
}

export function AiDisclosureBadge({
  disclosure,
  showHumanMade = false,
  className,
}: AiDisclosureBadgeProps) {
  const presentation = getPresentation(disclosure, showHumanMade);
  if (!presentation) return null;

  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    width: "fit-content",
    border: `1px solid ${presentation.border}`,
    borderRadius: "999px",
    padding: "3px 8px",
    color: presentation.color,
    background: presentation.background,
    fontSize: "11px",
    fontWeight: 700,
    lineHeight: 1.3,
    whiteSpace: "nowrap",
  };

  return (
    <span
      className={className}
      style={style}
      title={presentation.title}
      aria-label={`AI disclosure: ${presentation.label}`}
    >
      {presentation.label}
    </span>
  );
}

export default AiDisclosureBadge;
