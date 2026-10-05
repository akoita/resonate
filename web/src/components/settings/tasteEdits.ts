/**
 * Pure state and flow helpers for the "Tell us what you want more or less of"
 * taste edits (#1961, ADR-TE-5). Nothing here touches React or the network
 * directly: the API calls are injected, which keeps the two guarantees the
 * feature rests on easy to test:
 *
 *  - a preview never applies anything, and
 *  - apply sends only the rows the listener left selected.
 */
import {
  DECLARED_TEXT_EDIT_SOURCE,
  type ConfirmedTasteEdit,
  type ProposedTasteEdit,
  type TasteEditPreviewResponse,
  type TasteMemoryResponse,
  type TasteSignalControl,
} from "../../lib/api";

export type TasteEditDraftRow = {
  item: ProposedTasteEdit;
  /** Whether the listener still wants this change. Unmapped rows never are. */
  included: boolean;
};

export type TasteEditDraft = TasteEditDraftRow[];

type ApplyResult = TasteMemoryResponse & { edits: { appliedCount: number; ignoredCount: number } };

/** An unmapped row has nothing to apply: it is shown honestly and not selectable. */
export function isApplicable(item: ProposedTasteEdit): boolean {
  return item.kind !== "unmapped" && item.signalType !== null && item.action !== null;
}

export function buildDraft(items: ProposedTasteEdit[]): TasteEditDraft {
  return items.map((item) => ({ item, included: isApplicable(item) }));
}

/**
 * The edit a drift hint pre-fills (#2101): "Show more <value>" as a boost the
 * listener still has to preview-confirm and Apply. Nothing is stored here.
 */
export function driftProposal(signalType: "genre" | "mood", value: string): ProposedTasteEdit {
  const isGenre = signalType === "genre";
  return {
    id: `drift-${signalType}-${value}`,
    kind: isGenre ? "boost_genre" : "boost_mood",
    signalType,
    value,
    action: "boosted",
    phrase: value,
    statement: isGenre ? `Show more ${value}` : `Show more ${value} music`,
  };
}

export function toggleRow(draft: TasteEditDraft, id: string): TasteEditDraft {
  return draft.map((row) =>
    row.item.id === id && isApplicable(row.item) ? { ...row, included: !row.included } : row,
  );
}

export function removeRow(draft: TasteEditDraft, id: string): TasteEditDraft {
  return draft.filter((row) => row.item.id !== id);
}

const SWITCHABLE = ["boost_genre", "downrank_genre", "boost_mood", "downrank_mood"] as const;

/** More and less can be swapped for genres and moods; every other row is what it says. */
export function canSwitchDirection(item: ProposedTasteEdit): boolean {
  return (SWITCHABLE as readonly string[]).includes(item.kind);
}

export function directionLabel(item: ProposedTasteEdit): string {
  return item.action === "boosted" ? "Switch to less" : "Switch to more";
}

/** Flips a genre or mood row between "more" and "less", rewriting its statement. */
export function switchDirection(draft: TasteEditDraft, id: string): TasteEditDraft {
  return draft.map((row) => {
    if (row.item.id !== id || !canSwitchDirection(row.item)) return row;
    const { item } = row;
    const wasBoost = item.action === "boosted";
    const isGenre = item.signalType === "genre";
    const kind = isGenre
      ? wasBoost ? "downrank_genre" : "boost_genre"
      : wasBoost ? "downrank_mood" : "boost_mood";
    const noun = isGenre ? item.value : `${item.value} music`;
    return {
      ...row,
      item: {
        ...item,
        kind,
        action: wasBoost ? "downranked" : "boosted",
        statement: `${wasBoost ? "Show less" : "Show more"} ${noun}`,
      },
    };
  });
}

export function selectedRows(draft: TasteEditDraft): TasteEditDraftRow[] {
  return draft.filter((row) => row.included && isApplicable(row.item));
}

/** Exactly what goes over the wire on Apply: the selected rows, nothing else. */
export function confirmedEdits(draft: TasteEditDraft): ConfirmedTasteEdit[] {
  return selectedRows(draft).map(({ item }) => ({
    signalType: item.signalType as ConfirmedTasteEdit["signalType"],
    value: item.value,
    action: item.action as ConfirmedTasteEdit["action"],
  }));
}

/** Preview: read-only. Blank text never reaches the server. */
export async function runPreview(
  api: { preview: (token: string, text: string) => Promise<TasteEditPreviewResponse> },
  token: string,
  text: string,
): Promise<TasteEditDraft | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const { items } = await api.preview(token, trimmed);
  return buildDraft(items);
}

/** Apply: sends only the selected rows, and does nothing at all when none are. */
export async function runApply(
  api: { apply: (token: string, items: ConfirmedTasteEdit[]) => Promise<ApplyResult> },
  token: string,
  draft: TasteEditDraft,
): Promise<ApplyResult | null> {
  const items = confirmedEdits(draft);
  if (items.length === 0) return null;
  return api.apply(token, items);
}

export function isDeclaredControl(control: TasteSignalControl): boolean {
  return control.source === DECLARED_TEXT_EDIT_SOURCE;
}

/** Short plain-language label for a control in the list, e.g. "more of this genre". */
export function controlLabel(control: TasteSignalControl): string {
  switch (control.action) {
    case "boosted":
      return control.signalType === "energy" ? "preferred energy" : `more of this ${control.signalType}`;
    case "declared":
      return "note (saved; nudges recommendations where music matching is on)";
    default:
      return `${control.action} ${control.signalType}`;
  }
}

/** The button text: declared and boosted entries are removed, hidden ones restored. */
export function controlRemoveLabel(control: TasteSignalControl): string {
  return control.action === "boosted" || control.action === "declared" ? "Remove" : "Restore";
}
