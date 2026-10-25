import { useId } from "react";

import type { HelpBlock } from "../../lib/help/types";

type AudioBlock = Extract<HelpBlock, { kind: "audio" }>;

/** "0:12" style length for the caption line. */
function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * A captioned audio example (#1943). A native `<audio controls>` is keyboard
 * and screen-reader accessible, and `preload="none"` keeps the page light:
 * nothing is downloaded until the reader presses play. The description is
 * always visible text (not a tooltip), so the example still makes sense to a
 * reader who cannot hear it or has audio off; the player is labelled by the
 * caption and described by that text.
 */
export function HelpAudio({ audio }: { audio: AudioBlock }) {
  const { src, caption, description, duration } = audio;
  const id = useId();
  const captionId = `${id}-caption`;
  const descriptionId = `${id}-description`;
  return (
    <figure className="help-audio">
      <figcaption id={captionId} className="help-audio__caption">
        {caption}
        <span className="help-audio__duration"> · {formatDuration(duration)}</span>
      </figcaption>
      <audio
        className="help-audio__player"
        controls
        preload="none"
        src={src}
        aria-labelledby={captionId}
        aria-describedby={descriptionId}
      />
      <p id={descriptionId} className="help-audio__description">
        {description}
      </p>
    </figure>
  );
}
