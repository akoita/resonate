"use client";

import { useId, useRef, useState } from "react";
import {
  getArtistEnrichmentCandidates,
  getArtistEnrichmentSuggestions,
  type ArtistEnrichmentCandidate,
  type ArtistEnrichmentField,
  type ArtistEnrichmentSuggestion,
  type ArtistEnrichmentSuggestions,
} from "../../lib/api";
import {
  applyArtistEnrichmentSuggestions,
  ARTIST_SOCIAL_LINK_LABELS,
  isValidHttpUrl,
  type ArtistProfileFormState,
} from "../../lib/artistProfileForm";
import { Button } from "../ui/Button";

const FIELD_LABELS: Record<ArtistEnrichmentField, string> = {
  imageUrl: "Image URL",
  summary: "Bio",
  website: "Website",
  ...ARTIST_SOCIAL_LINK_LABELS,
};

const CONFIDENCE_LABELS: Record<ArtistEnrichmentSuggestion["confidence"], string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

const SUMMARY_MAX = 2000;
const CURRENT_SUMMARY_PREVIEW = 120;

const STEPS = ["Choose artist", "Review fields", "Save profile"] as const;

type Props = {
  artistId: string;
  token: string;
  form: ArtistProfileFormState;
  onApply: (form: ArtistProfileFormState, appliedFields: ArtistEnrichmentField[]) => void;
};

type Operation = "search" | "prepare";

type PanelError = {
  message: string;
  /** Which request "Try again" re-runs; absent for local validation errors. */
  retry?: Operation;
};

function safeSourceUrl(value: string): string | null {
  if (!isValidHttpUrl(value)) return null;
  const url = new URL(value);
  return !url.username && !url.password ? url.toString() : null;
}

/** Human label for a public source link, derived from its host. */
function sourceName(value: string): string {
  const host = new URL(value).hostname.toLowerCase();
  if (host === "musicbrainz.org" || host.endsWith(".musicbrainz.org")) return "MusicBrainz";
  if (host === "wikidata.org" || host.endsWith(".wikidata.org")) return "Wikidata";
  return host.replace(/^www\./, "");
}

function candidateMeta(candidate: ArtistEnrichmentCandidate): string {
  return [candidate.disambiguation, candidate.area, candidate.type].filter(Boolean).join(" · ");
}

function currentPreview(field: ArtistEnrichmentField, value: string): string {
  const trimmed = value.trim();
  if (field !== "summary" || trimmed.length <= CURRENT_SUMMARY_PREVIEW) return trimmed;
  return `${trimmed.slice(0, CURRENT_SUMMARY_PREVIEW).trimEnd()}…`;
}

function joinLabels(fields: readonly ArtistEnrichmentField[]): string {
  return fields.map((field) => FIELD_LABELS[field]).join(", ");
}

function SparkleIcon() {
  return (
    <svg className="artist-enrichment-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M12 2.5l1.9 5.1 5.1 1.9-5.1 1.9L12 16.5l-1.9-5.1L5 9.5l5.1-1.9L12 2.5zm6.5 11l.95 2.55L22 17l-2.55.95L18.5 20.5l-.95-2.55L15 17l2.55-.95.95-2.55zM5.5 15l.7 1.8L8 17.5l-1.8.7L5.5 20l-.7-1.8L3 17.5l1.8-.7.7-1.8z" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg className="artist-enrichment-external-icon" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false">
      <path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

function StatusIcon({ kind }: { kind: "error" | "warning" | "success" }) {
  const path = kind === "success"
    ? "M5 12.5l4.5 4.5L19 7.5"
    : "M12 7.5v5.5M12 16.5v.01";
  return (
    <svg className={`artist-enrichment-status-icon is-${kind}`} viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      {kind === "success" ? null : <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="2" />}
      <path fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}

function SourceLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      className="artist-enrichment-source"
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(event) => event.stopPropagation()}
    >
      {label}
      <ExternalIcon />
      <span className="visually-hidden"> (opens in a new tab)</span>
    </a>
  );
}

export function ArtistEnrichmentPanel({ artistId, token, form, onApply }: Props) {
  const idPrefix = useId();
  const requestRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [error, setError] = useState<PanelError | null>(null);
  const [candidates, setCandidates] = useState<ArtistEnrichmentCandidate[] | null>(null);
  const [candidateId, setCandidateId] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [result, setResult] = useState<ArtistEnrichmentSuggestions | null>(null);
  const [values, setValues] = useState<Partial<Record<ArtistEnrichmentField, string>>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [replacements, setReplacements] = useState<Set<string>>(new Set());
  const [appliedFields, setAppliedFields] = useState<ArtistEnrichmentField[] | null>(null);
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());
  // Values this panel last wrote into the form, so re-adding a revised
  // suggestion does not ask to "replace" the manager's own staged choice.
  const lastAppliedValues = useRef<Partial<Record<ArtistEnrichmentField, string>>>({});
  const [needsReapply, setNeedsReapply] = useState(false);

  const busy = operation !== null;

  const search = async () => {
    const request = ++requestRef.current;
    setOperation("search");
    setError(null);
    setResult(null);
    setCandidates(null);
    setCandidateId("");
    setDismissed(false);
    setAppliedFields(null);
    setNeedsReapply(false);
    lastAppliedValues.current = {};
    try {
      const found = await getArtistEnrichmentCandidates(token, artistId);
      if (request !== requestRef.current) return;
      setCandidates(found);
    } catch (cause) {
      if (request !== requestRef.current) return;
      setError({
        message: cause instanceof Error ? cause.message : "Could not search public artist profiles. Try again.",
        retry: "search",
      });
    } finally {
      if (request === requestRef.current) setOperation(null);
    }
  };

  const prepare = async () => {
    if (!candidateId) return;
    const request = ++requestRef.current;
    setOperation("prepare");
    setError(null);
    setAppliedFields(null);
    setNeedsReapply(false);
    lastAppliedValues.current = {};
    try {
      const suggestions = await getArtistEnrichmentSuggestions(token, artistId, candidateId);
      if (request !== requestRef.current) return;
      setResult(suggestions);
      setValues(Object.fromEntries(suggestions.suggestions.map((item) => [item.field, item.value])));
      setSelected(new Set());
      setReplacements(new Set());
      setBrokenImages(new Set());
    } catch (cause) {
      if (request !== requestRef.current) return;
      setError({
        message: cause instanceof Error ? cause.message : "Could not prepare suggestions. Try again.",
        retry: "prepare",
      });
    } finally {
      if (request === requestRef.current) setOperation(null);
    }
  };

  const start = () => {
    setOpen(true);
    void search();
  };

  const close = () => {
    // Invalidate any in-flight request so a late response cannot repopulate a closed panel.
    requestRef.current += 1;
    setOperation(null);
    setOpen(false);
  };

  const retry = () => {
    if (error?.retry === "prepare") void prepare();
    else void search();
  };

  const changeArtist = () => {
    setResult(null);
    setSelected(new Set());
    setReplacements(new Set());
    setAppliedFields(null);
    setError(null);
  };

  const markEdited = () => {
    if (Object.keys(lastAppliedValues.current).length > 0) setNeedsReapply(true);
  };

  const toggle = (field: string, current: Set<string>, setter: (value: Set<string>) => void) => {
    const next = new Set(current);
    if (next.has(field)) next.delete(field);
    else next.add(field);
    setter(next);
    markEdited();
  };

  const editValue = (field: ArtistEnrichmentField, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    markEdited();
  };

  /** True when the form holds a value the manager entered, not one this panel added. */
  const hasOwnValue = (field: ArtistEnrichmentField) => {
    const current = form[field].trim();
    return Boolean(current) && current !== lastAppliedValues.current[field];
  };

  const apply = () => {
    if (!result) return;
    const edited = result.suggestions.map((item) => ({ ...item, value: values[item.field] ?? "" }));
    const confirmedReplacements = new Set(replacements);
    for (const item of edited) {
      if (!hasOwnValue(item.field)) confirmedReplacements.add(item.field);
    }
    const next = applyArtistEnrichmentSuggestions(form, edited, selected, confirmedReplacements);
    if (next.skipped.length) {
      const skipped = next.skipped as ArtistEnrichmentField[];
      const needsConfirmation = skipped.filter((field) => form[field].trim() && !confirmedReplacements.has(field));
      const invalid = skipped.filter((field) => !needsConfirmation.includes(field));
      const parts: string[] = [];
      if (needsConfirmation.length === 1) {
        const label = FIELD_LABELS[needsConfirmation[0]];
        parts.push(`${label} already has a value. Tick “Replace my existing ${label.toLowerCase()}” to overwrite it, or unselect ${label}.`);
      } else if (needsConfirmation.length > 1) {
        parts.push(`${joinLabels(needsConfirmation)} already have values. Tick their “Replace my existing” boxes to overwrite them, or unselect them.`);
      }
      if (invalid.length) {
        parts.push(`Check ${joinLabels(invalid)}: the value is empty or is not a valid address for that field.`);
      }
      setError({ message: `Nothing was added yet. ${parts.join(" ")}` });
      return;
    }
    setError(null);
    onApply(next.form, next.applied);
    for (const field of next.applied) lastAppliedValues.current[field] = next.form[field].trim();
    setNeedsReapply(false);
    setAppliedFields(next.applied);
  };

  if (!open) {
    return (
      <div className="artist-enrichment-invite">
        <div className="artist-enrichment-invite-main">
          <span className="artist-enrichment-invite-icon"><SparkleIcon /></span>
          <div className="artist-enrichment-invite-text">
            <strong>Fill in your profile from public sources</strong>
            <p>Find links, a reusable photo, and an AI-drafted bio from MusicBrainz and Wikidata. You review everything before saving.</p>
          </div>
        </div>
        <Button type="button" variant="ghost" className="artist-enrichment-invite-btn" onClick={start}>
          Find suggestions
        </Button>
      </div>
    );
  }

  const step = appliedFields ? 3 : result ? 2 : 1;
  const headingId = `${idPrefix}-heading`;
  const showEmptyState = !busy && !result && candidates !== null && (candidates.length === 0 || dismissed);
  const showCandidates = !busy && !result && candidates !== null && candidates.length > 0 && !dismissed;
  const selectedCount = result ? result.suggestions.filter((item) => selected.has(item.field)).length : 0;
  const allSelected = result ? result.suggestions.length > 0 && selectedCount === result.suggestions.length : false;
  const statusText = operation === "search"
    ? "Searching public music databases…"
    : operation === "prepare" ? "Preparing suggestions…" : "";

  return (
    <section className="artist-enrichment" aria-labelledby={headingId}>
      <div className="artist-enrichment-header">
        <h2 id={headingId} className="artist-enrichment-title">
          <SparkleIcon />
          Profile suggestions
        </h2>
        <button type="button" className="artist-enrichment-close" aria-label="Close suggestions" onClick={close}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
            <path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <ol className="artist-enrichment-steps" aria-label="Progress">
        {STEPS.map((label, index) => {
          const number = index + 1;
          const state = number < step ? "is-done" : number === step ? "is-current" : "is-upcoming";
          return (
            <li key={label} className={`artist-enrichment-step ${state}`} aria-current={number === step ? "step" : undefined}>
              <span className="artist-enrichment-step-marker" aria-hidden="true">
                {number < step ? (
                  <svg viewBox="0 0 24 24" width="12" height="12" focusable="false">
                    <path fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                ) : number}
              </span>
              <span className="artist-enrichment-step-label">{label}</span>
            </li>
          );
        })}
      </ol>

      {step === 1 && !showEmptyState && (
        <p className="artist-enrichment-hint">Artists can share a name — check the details before choosing.</p>
      )}

      <p className="artist-enrichment-live" role="status" aria-live="polite">{statusText}</p>

      {error?.retry && (
        <div className="artist-enrichment-alert" role="alert">
          <StatusIcon kind="error" />
          <p className="artist-enrichment-error">{error.message}</p>
          <Button type="button" variant="ghost" className="artist-enrichment-compact-btn" onClick={retry} disabled={busy}>
            Try again
          </Button>
        </div>
      )}

      {busy && (
        <div className="artist-enrichment-skeletons" aria-hidden="true">
          {[0, 1].map((index) => (
            <div className="artist-enrichment-skeleton" key={index}>
              <span className="artist-enrichment-skeleton-line is-title" />
              <span className="artist-enrichment-skeleton-line is-body" />
              <span className="artist-enrichment-skeleton-line is-short" />
            </div>
          ))}
        </div>
      )}

      {showEmptyState && (
        <div className="artist-enrichment-empty">
          <strong className="artist-enrichment-empty-title">{dismissed ? "No match selected" : "No matches found"}</strong>
          <p>
            {dismissed
              ? "You can keep editing your profile by hand. Nothing has changed."
              : "No public profiles matched this artist name. You can keep editing by hand."}
          </p>
          <div className="artist-enrichment-actions">
            <Button type="button" onClick={() => void search()}>Search again</Button>
            <Button type="button" variant="ghost" onClick={close}>Close</Button>
          </div>
        </div>
      )}

      {showCandidates && candidates && (
        <div className="artist-enrichment-candidates">
          <div className="artist-enrichment-candidate-list" role="radiogroup" aria-label="Matching public artists">
            {candidates.map((candidate) => {
              const meta = candidateMeta(candidate);
              const source = safeSourceUrl(candidate.sourceUrl);
              return (
                <label className="artist-enrichment-candidate" key={candidate.id}>
                  <input
                    type="radio"
                    name={`${idPrefix}-candidate`}
                    value={candidate.id}
                    checked={candidateId === candidate.id}
                    onChange={() => setCandidateId(candidate.id)}
                  />
                  <span className="artist-enrichment-candidate-body">
                    <span className="artist-enrichment-candidate-top">
                      <strong className="artist-enrichment-name">{candidate.name}</strong>
                      {typeof candidate.score === "number" && (
                        <span className="artist-enrichment-pill is-match">{Math.round(candidate.score)}% match</span>
                      )}
                    </span>
                    {meta && <span className="artist-enrichment-meta">{meta}</span>}
                    {source && <SourceLink href={source} label={sourceName(source)} />}
                  </span>
                </label>
              );
            })}
          </div>
          <div className="artist-enrichment-actions">
            <Button type="button" onClick={() => void prepare()} disabled={!candidateId || busy}>Review suggestions</Button>
            <Button type="button" variant="ghost" onClick={() => setDismissed(true)} disabled={busy}>None of these match</Button>
          </div>
        </div>
      )}

      {result && !busy && appliedFields && (
        <div className="artist-enrichment-success">
          <StatusIcon kind="success" />
          <div className="artist-enrichment-success-text" role="status">
            <strong>
              Added {appliedFields.length} {appliedFields.length === 1 ? "field" : "fields"} to your form: {joinLabels(appliedFields)}.
            </strong>
            <p>Review them below, then choose Save changes to publish.</p>
          </div>
          <div className="artist-enrichment-actions">
            <Button type="button" onClick={close}>Done</Button>
            <Button type="button" variant="ghost" onClick={() => setAppliedFields(null)}>Back to suggestions</Button>
          </div>
        </div>
      )}

      {result && !busy && !appliedFields && (
        <div className="artist-enrichment-review">
          <div className="artist-enrichment-selected">
            <div className="artist-enrichment-selected-text">
              <span className="artist-enrichment-eyebrow">Selected artist</span>
              <strong className="artist-enrichment-name">{result.candidate.name}</strong>
              {candidateMeta(result.candidate) && <span className="artist-enrichment-meta">{candidateMeta(result.candidate)}</span>}
              {safeSourceUrl(result.candidate.sourceUrl) && (
                <SourceLink href={safeSourceUrl(result.candidate.sourceUrl) as string} label={sourceName(result.candidate.sourceUrl)} />
              )}
            </div>
            <Button type="button" variant="ghost" className="artist-enrichment-compact-btn" onClick={changeArtist}>
              Change artist
            </Button>
          </div>

          {result.warnings.length > 0 && (
            <div className="artist-enrichment-notice">
              <StatusIcon kind="warning" />
              <ul>
                {result.warnings.map((warning, index) => (
                  <li className="artist-enrichment-warning" key={`${index}-${warning}`}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          {result.suggestions.length === 0 ? (
            <div className="artist-enrichment-empty">
              <strong className="artist-enrichment-empty-title">No usable suggestions</strong>
              <p>We couldn’t find fields to suggest for this artist. Your profile is unchanged.</p>
            </div>
          ) : (
            <>
              <div className="artist-enrichment-toolbar">
                <span className="artist-enrichment-count">
                  {result.suggestions.length} {result.suggestions.length === 1 ? "suggestion" : "suggestions"}
                </span>
                <button
                  type="button"
                  className="artist-enrichment-text-btn"
                  onClick={() => setSelected(allSelected ? new Set() : new Set(result.suggestions.map((item) => item.field)))}
                >
                  {allSelected ? "Clear selection" : "Select all"}
                </button>
              </div>

              <ul className="artist-enrichment-suggestions">
                {result.suggestions.map((item: ArtistEnrichmentSuggestion) => {
                  const field = item.field;
                  const isSelected = selected.has(field);
                  const current = hasOwnValue(field) ? form[field].trim() : "";
                  const value = values[field] ?? "";
                  const source = safeSourceUrl(item.sourceUrl);
                  const rightsUrl = item.rights ? safeSourceUrl(item.rights.descriptionUrl) : null;
                  const inputId = `${idPrefix}-${field}`;
                  const showThumb = field === "imageUrl" && isValidHttpUrl(value.trim()) && !brokenImages.has(value.trim());
                  return (
                    <li className={`artist-enrichment-suggestion${isSelected ? " is-selected" : ""}`} key={field}>
                      <label className="artist-enrichment-select">
                        <input type="checkbox" checked={isSelected} onChange={() => toggle(field, selected, setSelected)} />
                        <strong className="artist-enrichment-field-name">{FIELD_LABELS[field]}</strong>
                        {field === "summary" && <span className="artist-enrichment-pill is-ai">AI draft</span>}
                        <span className={`artist-enrichment-pill is-${item.confidence}`}>{CONFIDENCE_LABELS[item.confidence]}</span>
                      </label>

                      <div className={`artist-enrichment-value${field === "imageUrl" ? " has-thumb" : ""}`}>
                        {showThumb && (
                          // eslint-disable-next-line @next/next/no-img-element -- external, user-reviewed preview; next/image would require allow-listing arbitrary hosts.
                          <img
                            className="artist-enrichment-thumb"
                            src={value.trim()}
                            alt=""
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            onError={() => setBrokenImages((prev) => new Set(prev).add(value.trim()))}
                          />
                        )}
                        {field === "summary" ? (
                          <div className="artist-enrichment-textarea-wrap">
                            <textarea
                              id={inputId}
                              aria-label={`Suggested ${FIELD_LABELS[field]}`}
                              aria-describedby={`${inputId}-count`}
                              className="ui-input artist-profile-edit-textarea"
                              value={value}
                              maxLength={SUMMARY_MAX}
                              rows={4}
                              onChange={(event) => editValue(field, event.target.value)}
                            />
                            <span id={`${inputId}-count`} className="artist-enrichment-counter">
                              {value.length} / {SUMMARY_MAX}
                            </span>
                          </div>
                        ) : (
                          <input
                            id={inputId}
                            aria-label={`Suggested ${FIELD_LABELS[field]}`}
                            className="ui-input"
                            value={value}
                            maxLength={2048}
                            onChange={(event) => editValue(field, event.target.value)}
                          />
                        )}
                      </div>

                      {current && (
                        <p className="artist-enrichment-current" title={field === "summary" ? undefined : current}>
                          Current: {currentPreview(field, current)}
                        </p>
                      )}

                      {current && isSelected && (
                        <label className="artist-enrichment-replace">
                          <input type="checkbox" checked={replacements.has(field)} onChange={() => toggle(field, replacements, setReplacements)} />
                          Replace my existing {FIELD_LABELS[field].toLowerCase()}
                        </label>
                      )}

                      {(source || item.rights) && (
                        <div className="artist-enrichment-footnotes">
                          {source && <span>Source: <SourceLink href={source} label={item.sourceLabel} /></span>}
                          {item.rights && (
                            <span>
                              Image license: {item.rights.license}.{" "}
                              {rightsUrl && <SourceLink href={rightsUrl} label="Check file information before use" />}
                            </span>
                          )}
                          {item.rights?.attribution && <span>Image credit: {item.rights.attribution}</span>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              {/* Validation errors from "Add … to form" sit next to the button that raised them. */}
              {error && !error.retry && (
                <div className="artist-enrichment-alert" role="alert">
                  <StatusIcon kind="error" />
                  <p className="artist-enrichment-error">{error.message}</p>
                </div>
              )}

              {needsReapply && (
                <div className="artist-enrichment-notice" role="status">
                  <StatusIcon kind="warning" />
                  <p>Your latest suggestion edits are not in the form yet. Add them to the form again to include them.</p>
                </div>
              )}

              <div className="artist-enrichment-actions artist-enrichment-apply-bar">
                <Button type="button" onClick={apply} disabled={busy || selectedCount === 0}>
                  {selectedCount === 0
                    ? "Select fields to add"
                    : `Add ${selectedCount} ${selectedCount === 1 ? "field" : "fields"} to form`}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
