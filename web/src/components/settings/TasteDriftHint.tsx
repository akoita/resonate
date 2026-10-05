"use client";

import type { TasteDrift, TasteSignalControl } from "../../lib/api";
import { Button } from "../ui/Button";

const MAX_SHOWN = 2;

type ListeningValue = { signalType: "genre" | "mood"; value: string };

type Props = {
  drift: TasteDrift;
  /** Used to offer removal only for boosts that still exist in the controls list. */
  controls: TasteSignalControl[];
  onProposeMore: (signalType: "genre" | "mood", value: string) => void;
  onRemoveBoost: (controlId: string) => void;
  busy?: boolean;
};

function joinValues(values: string[]): string {
  if (values.length <= 1) return values.join("");
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

function uniqueValues(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * "Your saved taste and your listening have drifted apart" (#2101). Surfaces
 * boosts that no longer match what the listener plays and offers two explicit
 * choices. Nothing here changes taste by itself: "Show more" only pre-fills the
 * preview, and removal is an explicit click.
 */
export default function TasteDriftHint({ drift, controls, onProposeMore, onRemoveBoost, busy = false }: Props) {
  const controlIds = new Set(controls.map((control) => control.id));
  const staleBoosts = drift.staleBoosts.filter((boost) => controlIds.has(boost.controlId)).slice(0, MAX_SHOWN);
  if (staleBoosts.length === 0) return null;

  const listening: ListeningValue[] = [
    ...drift.listeningGenres.map((value) => ({ signalType: "genre" as const, value })),
    ...drift.listeningMoods.map((value) => ({ signalType: "mood" as const, value })),
  ]
    .filter((entry, index, all) =>
      all.findIndex((other) => other.value.trim().toLowerCase() === entry.value.trim().toLowerCase()) === index,
    )
    .slice(0, MAX_SHOWN);

  const staleText = joinValues(uniqueValues(staleBoosts.map((boost) => boost.value)));
  const listeningText = joinValues(listening.map((entry) => entry.value));

  return (
    <section className="taste-drift" aria-labelledby="taste-drift-title" data-testid="taste-drift-hint">
      <h4 className="taste-edit-title" id="taste-drift-title">
        Your saved taste and your listening have drifted apart
      </h4>
      <p className="taste-edit-hint">
        You asked for more {staleText},{" "}
        {listening.length > 0
          ? `but lately you mostly play ${listeningText}.`
          : "but you haven’t played much of it lately."}
      </p>
      <div className="taste-edit-actions">
        {listening.map((entry) => (
          <Button
            key={`more-${entry.signalType}-${entry.value}`}
            onClick={() => onProposeMore(entry.signalType, entry.value)}
            disabled={busy}
          >
            Show more {entry.value}
          </Button>
        ))}
        {staleBoosts.map((boost) => (
          <Button
            key={`remove-${boost.controlId}`}
            variant="ghost"
            onClick={() => onRemoveBoost(boost.controlId)}
            disabled={busy}
          >
            Remove the {boost.value} boost
          </Button>
        ))}
      </div>
      <p className="taste-edit-footnote">
        {listening.length > 0
          ? "“Show more” only fills in the preview below — nothing is added until you apply. "
          : ""}
        Your boosts never fade on their own.
      </p>
    </section>
  );
}
