import type { HelpBlock } from "../../lib/help/types";
import { HelpFigure } from "./HelpFigure";

const CALLOUT_LABEL: Record<"tip" | "note" | "warning", string> = {
  tip: "Tip",
  note: "Note",
  warning: "Important",
};

export function HelpBlocks({ blocks }: { blocks: HelpBlock[] }) {
  return (
    <>
      {blocks.map((block, i) => (
        <HelpBlockView key={i} block={block} />
      ))}
    </>
  );
}

function HelpBlockView({ block }: { block: HelpBlock }) {
  switch (block.kind) {
    case "paragraph":
      return <p className="help-prose">{block.text}</p>;

    case "steps":
      return (
        <ol className="help-steps">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      );

    case "list":
      return (
        <ul className="help-list">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );

    case "definitions":
      return (
        <dl className="help-defs">
          {block.items.map((d, i) => (
            <div className="help-defs__row" key={i}>
              <dt className="help-defs__term">{d.term}</dt>
              <dd className="help-defs__desc">{d.description}</dd>
            </div>
          ))}
        </dl>
      );

    case "callout":
      return (
        <aside className={`help-callout help-callout--${block.tone}`} role="note">
          <p className="help-callout__label">{block.title ?? CALLOUT_LABEL[block.tone]}</p>
          <p className="help-callout__text">{block.text}</p>
        </aside>
      );

    case "figure":
      return <HelpFigure figure={block.figure} />;

    default:
      return null;
  }
}
