import type { HelpFigureRef } from "../../lib/help/types";

/**
 * A captioned screenshot. Static local asset under /public, so a plain
 * <img> (with explicit dimensions to avoid layout shift) is the simplest
 * accessible choice — same approach the rest of the app uses.
 */
export function HelpFigure({ figure }: { figure: HelpFigureRef }) {
  const { src, alt, caption, width, height, source } = figure;
  return (
    <figure className="help-figure">
      {/* eslint-disable-next-line @next/next/no-img-element -- static local screenshot, not remote media */}
      <img
        className="help-figure__img"
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
      />
      <figcaption className="help-figure__caption">
        {caption}
        {source ? <span className="help-figure__source"> · {source}</span> : null}
      </figcaption>
    </figure>
  );
}
