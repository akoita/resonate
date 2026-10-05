"use client";

import { useId, useState } from "react";
import {
  applyTasteEdits,
  previewTasteEdits,
  type ProposedTasteEdit,
  type TasteMemoryResponse,
} from "../../lib/api";
import { Button } from "../ui/Button";
import {
  buildDraft,
  canSwitchDirection,
  directionLabel,
  isApplicable,
  removeRow,
  runApply,
  runPreview,
  selectedRows,
  switchDirection,
  toggleRow,
  type TasteEditDraft,
} from "./tasteEdits";

type ToastFn = (toast: { type: "success" | "error" | "info" | "warning"; title: string; message: string }) => void;

type Props = {
  token: string | null | undefined;
  addToast: ToastFn;
  /** Called with the updated taste memory after a successful apply. */
  onApplied: (memory: TasteMemoryResponse) => void;
  /**
   * A ready-made proposal, e.g. from a taste drift hint (#2101). When `key`
   * changes the rows replace the current preview. Nothing is applied until the
   * listener presses Apply.
   */
  proposal?: { key: string; items: ProposedTasteEdit[] } | null;
};

/** Mirrors the backend bound on the text a preview reads. */
const MAX_TEXT_LENGTH = 500;

/**
 * "Tell us what you want more or less of" (#1961, ADR-TE-5). The listener
 * types in their own words, previews the exact statements we would apply, edits
 * them, and only then applies. Nothing is stored before Apply.
 */
export default function TasteEditSection({ token, addToast, onApplied, proposal }: Props) {
  const fieldId = useId();
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<TasteEditDraft | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [seenProposalKey, setSeenProposalKey] = useState<string | null>(null);

  // Adjust state during render when a new proposal arrives (no effect needed).
  if (proposal && proposal.key !== seenProposalKey) {
    setSeenProposalKey(proposal.key);
    if (proposal.items.length > 0) setDraft(buildDraft(proposal.items));
  }

  const preview = async () => {
    if (!token || !text.trim()) return;
    setBusy("preview");
    try {
      setDraft(await runPreview({ preview: previewTasteEdits }, token, text));
    } catch {
      addToast({
        type: "error",
        title: "Preview unavailable",
        message: "We could not read that just now. Nothing was changed. Please try again.",
      });
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!token || !draft) return;
    setBusy("apply");
    try {
      const result = await runApply({ apply: applyTasteEdits }, token, draft);
      if (!result) return;
      onApplied(result);
      setDraft(null);
      setText("");
      addToast({
        type: "success",
        title: "Taste edits applied",
        message: `${result.edits.appliedCount} change${result.edits.appliedCount === 1 ? "" : "s"} saved. Remove any of them from the list below.`,
      });
    } catch {
      addToast({
        type: "error",
        title: "Edits not applied",
        message: "Nothing was changed. Please try again.",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <TasteEditSectionContent
      fieldId={fieldId}
      text={text}
      draft={draft}
      busy={busy}
      canUse={Boolean(token)}
      onTextChange={setText}
      onPreview={preview}
      onToggle={(id) => setDraft((current) => (current ? toggleRow(current, id) : current))}
      onSwitch={(id) => setDraft((current) => (current ? switchDirection(current, id) : current))}
      onRemove={(id) => setDraft((current) => (current ? removeRow(current, id) : current))}
      onApply={apply}
      onDiscard={() => setDraft(null)}
    />
  );
}

type ContentProps = {
  fieldId: string;
  text: string;
  draft: TasteEditDraft | null;
  busy: "preview" | "apply" | null;
  canUse: boolean;
  onTextChange: (text: string) => void;
  onPreview: () => void;
  onToggle: (id: string) => void;
  onSwitch: (id: string) => void;
  onRemove: (id: string) => void;
  onApply: () => void;
  onDiscard: () => void;
};

/** Presentational half, exported so its rendering can be tested without a browser. */
export function TasteEditSectionContent({
  fieldId,
  text,
  draft,
  busy,
  canUse,
  onTextChange,
  onPreview,
  onToggle,
  onSwitch,
  onRemove,
  onApply,
  onDiscard,
}: ContentProps) {
  const selected = draft ? selectedRows(draft).length : 0;
  const hintId = `${fieldId}-hint`;

  return (
    <section className="taste-edit" aria-labelledby={`${fieldId}-title`}>
      <h4 className="taste-edit-title" id={`${fieldId}-title`}>
        Tell us what you want more or less of
      </h4>
      <p className="taste-edit-hint" id={hintId}>
        Type it in your own words, for example &ldquo;less drill, more live instruments&rdquo;. We show exactly
        what would change, and nothing is saved until you apply it.
      </p>

      <label className="taste-memory-field" htmlFor={`${fieldId}-text`}>
        <span>Your words</span>
        <textarea
          id={`${fieldId}-text`}
          value={text}
          maxLength={MAX_TEXT_LENGTH}
          aria-describedby={hintId}
          placeholder="Less drill, more live instruments"
          onChange={(event) => onTextChange(event.target.value)}
        />
      </label>

      <div className="taste-edit-actions">
        <Button onClick={onPreview} disabled={!canUse || !text.trim() || busy !== null}>
          {busy === "preview" ? "Reading..." : "Preview changes"}
        </Button>
      </div>

      <div aria-live="polite">
        {draft ? (
          draft.length === 0 ? (
            <p className="taste-edit-empty">
              We could not find anything to change in that. Try something like &ldquo;less drill&rdquo; or
              &ldquo;more jazz&rdquo;.
            </p>
          ) : (
            <>
              <p className="taste-edit-preview-title">
                Proposed changes. Untick or remove anything you do not want.
              </p>
              <ul className="taste-edit-list" aria-label="Proposed taste changes">
                {draft.map(({ item, included }) => {
                  const applicable = isApplicable(item);
                  const rowId = `${fieldId}-${item.id}`;
                  return (
                    <li
                      key={item.id}
                      className={`taste-edit-row${applicable ? "" : " taste-edit-row-unmapped"}`}
                    >
                      <div className="taste-edit-row-main">
                        {applicable ? (
                          <label className="taste-edit-row-label" htmlFor={rowId}>
                            <input
                              id={rowId}
                              type="checkbox"
                              checked={included}
                              disabled={busy !== null}
                              onChange={() => onToggle(item.id)}
                            />
                            <span>{item.statement}</span>
                          </label>
                        ) : (
                          <p className="taste-edit-row-label">
                            <span>{item.statement}</span>
                          </p>
                        )}
                        <small>
                          {applicable
                            ? item.kind === "written_preference"
                              ? "Saved as a note you can read back. Where music matching is on, it gently nudges recommendations toward music like it."
                              : `From: “${item.phrase}”`
                            : "Not selectable, so it will not be saved."}
                        </small>
                      </div>
                      <div className="taste-edit-row-actions">
                        {applicable && canSwitchDirection(item) ? (
                          <Button
                            variant="ghost"
                            onClick={() => onSwitch(item.id)}
                            disabled={busy !== null}
                            aria-label={`${directionLabel(item)}: ${item.statement}`}
                          >
                            {directionLabel(item)}
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          onClick={() => onRemove(item.id)}
                          disabled={busy !== null}
                          aria-label={`Remove from this list: ${item.statement}`}
                        >
                          Remove
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="taste-edit-actions">
                <Button onClick={onApply} disabled={selected === 0 || busy !== null}>
                  {busy === "apply"
                    ? "Applying..."
                    : `Apply ${selected} selected change${selected === 1 ? "" : "s"}`}
                </Button>
                <Button variant="ghost" onClick={onDiscard} disabled={busy !== null}>
                  Discard
                </Button>
              </div>
            </>
          )
        ) : null}
      </div>

      <p className="taste-edit-footnote">
        Changes you apply stay until you remove them, and they count for more than what we have inferred from your
        listening.
      </p>
    </section>
  );
}
