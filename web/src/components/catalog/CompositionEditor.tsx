"use client";

import {
  COLLECTING_SOCIETIES,
  EMPTY_WRITER,
  MAX_COVER_NOTE,
  MAX_PUBLISHER,
  MAX_WRITER_NAME,
  MAX_WRITERS,
  WRITER_ROLES,
  WRITER_ROLE_LABELS,
  type CompositionDraft,
  type CompositionDraftErrors,
  type WriterDraft,
  type WriterRole,
} from "../../lib/composition";
import "../../styles/composition.css";

/**
 * #2669: the composition fields of one track: writers with role, optional
 * share, society and IPI number; publisher or self-published; work code; and
 * the cover or samples declaration. Controlled: the parent keeps the draft
 * and decides when to validate and save.
 */
export function CompositionEditor({
  idPrefix,
  value,
  errors = {},
  onChange,
  disabled = false,
}: {
  idPrefix: string;
  value: CompositionDraft;
  errors?: CompositionDraftErrors;
  onChange: (next: CompositionDraft) => void;
  disabled?: boolean;
}) {
  const set = (patch: Partial<CompositionDraft>) => onChange({ ...value, ...patch });
  const setWriter = (index: number, patch: Partial<WriterDraft>) =>
    set({ writers: value.writers.map((writer, i) => (i === index ? { ...writer, ...patch } : writer)) });
  const removeWriter = (index: number) => set({ writers: value.writers.filter((_, i) => i !== index) });
  const addWriter = () => set({ writers: [...value.writers, { ...EMPTY_WRITER }] });
  const writersErrorId = `${idPrefix}-writers-error`;

  return (
    <div className="composition-editor">
      <fieldset className="composition-editor__group" disabled={disabled} aria-describedby={errors.writers ? writersErrorId : undefined}>
        <legend>Writers</legend>
        <p className="composition-editor__hint">
          Who wrote the song. Shares are optional; if you enter them, they must add up to 100%.
        </p>
        {value.writers.length === 0 && <p className="composition-editor__empty">No writers listed yet.</p>}
        <ol className="composition-editor__writers">
          {value.writers.map((writer, index) => {
            const rowError = errors.writerRows?.[index];
            const rowErrorId = `${idPrefix}-writer-${index}-error`;
            return (
              <li key={index} className="composition-editor__writer">
                <label>
                  <span>Name</span>
                  <input
                    type="text"
                    value={writer.name}
                    maxLength={MAX_WRITER_NAME}
                    autoComplete="off"
                    aria-invalid={rowError ? true : undefined}
                    aria-describedby={rowError ? rowErrorId : undefined}
                    onChange={(event) => setWriter(index, { name: event.target.value })}
                  />
                </label>
                <label>
                  <span>Role</span>
                  <select value={writer.role} onChange={(event) => setWriter(index, { role: event.target.value as WriterRole })}>
                    {WRITER_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {WRITER_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="composition-editor__share">
                  <span>Share %</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={writer.share}
                    placeholder="optional"
                    onChange={(event) => setWriter(index, { share: event.target.value })}
                  />
                </label>
                <label>
                  <span>Society</span>
                  <select value={writer.society} onChange={(event) => setWriter(index, { society: event.target.value })}>
                    <option value="">Not given</option>
                    {COLLECTING_SOCIETIES.map((society) => (
                      <option key={society} value={society}>
                        {society === "none" ? "None (not a member)" : society === "other" ? "Another society" : society}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>IPI number</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={writer.ipi}
                    placeholder="optional"
                    onChange={(event) => setWriter(index, { ipi: event.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="ui-btn ui-btn-ghost composition-editor__remove"
                  onClick={() => removeWriter(index)}
                  aria-label={`Remove writer ${writer.name.trim() || index + 1}`}
                >
                  Remove
                </button>
                {rowError && (
                  <p id={rowErrorId} className="composition-editor__error" role="alert">
                    {rowError}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        {value.writers.length < MAX_WRITERS && (
          <button type="button" className="ui-btn ui-btn-ghost composition-editor__add" onClick={addWriter}>
            Add a writer
          </button>
        )}
        {errors.writers && (
          <p id={writersErrorId} className="composition-editor__error" role="alert">
            {errors.writers}
          </p>
        )}
      </fieldset>

      <fieldset className="composition-editor__group" disabled={disabled}>
        <legend>Publishing</legend>
        <label className="composition-editor__check">
          <input
            type="checkbox"
            checked={value.selfPublished}
            onChange={(event) => set({ selfPublished: event.target.checked })}
          />
          <span>Self-published (no publisher)</span>
        </label>
        {!value.selfPublished && (
          <label>
            <span>Publisher</span>
            <input
              type="text"
              value={value.publisher}
              maxLength={MAX_PUBLISHER}
              placeholder="optional"
              aria-invalid={errors.publisher ? true : undefined}
              onChange={(event) => set({ publisher: event.target.value })}
            />
          </label>
        )}
        {errors.publisher && <p className="composition-editor__error" role="alert">{errors.publisher}</p>}
        <label>
          <span>Work code (ISWC)</span>
          <input
            type="text"
            value={value.iswc}
            placeholder="T-123.456.789-0"
            autoComplete="off"
            aria-invalid={errors.iswc ? true : undefined}
            aria-describedby={errors.iswc ? `${idPrefix}-iswc-error` : undefined}
            onChange={(event) => set({ iswc: event.target.value.toUpperCase() })}
          />
        </label>
        {errors.iswc && (
          <p id={`${idPrefix}-iswc-error`} className="composition-editor__error" role="alert">
            {errors.iswc}
          </p>
        )}
      </fieldset>

      <fieldset className="composition-editor__group" disabled={disabled}>
        <legend>Covers and samples</legend>
        <label className="composition-editor__check">
          <input
            type="checkbox"
            checked={value.coverOrSamples}
            onChange={(event) => set({ coverOrSamples: event.target.checked })}
          />
          <span>This recording is a cover, or contains samples</span>
        </label>
        {value.coverOrSamples && (
          <label>
            <span>What it covers or samples</span>
            <textarea
              rows={3}
              value={value.coverNote}
              maxLength={MAX_COVER_NOTE}
              placeholder="The original song and its writers, or what is sampled and from where."
              onChange={(event) => set({ coverNote: event.target.value })}
            />
          </label>
        )}
        {errors.coverNote && <p className="composition-editor__error" role="alert">{errors.coverNote}</p>}
      </fieldset>
    </div>
  );
}
