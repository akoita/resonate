"use client";

import { useState } from "react";
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

type Props = {
  artistId: string;
  token: string;
  form: ArtistProfileFormState;
  onApply: (form: ArtistProfileFormState) => void;
};

function safeSourceUrl(value: string): string | null {
  if (!isValidHttpUrl(value)) return null;
  const url = new URL(value);
  return !url.username && !url.password ? url.toString() : null;
}

export function ArtistEnrichmentPanel({ artistId, token, form, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ArtistEnrichmentCandidate[] | null>(null);
  const [candidateId, setCandidateId] = useState("");
  const [result, setResult] = useState<ArtistEnrichmentSuggestions | null>(null);
  const [values, setValues] = useState<Partial<Record<ArtistEnrichmentField, string>>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [replacements, setReplacements] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState(false);

  const search = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    setCandidateId("");
    setApplied(false);
    try {
      setCandidates(await getArtistEnrichmentCandidates(token, artistId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not search public artist profiles. Try again.");
      setCandidates(null);
    } finally {
      setBusy(false);
    }
  };

  const start = () => {
    setOpen(true);
    void search();
  };

  const prepare = async () => {
    if (!candidateId) return;
    setBusy(true);
    setError(null);
    setApplied(false);
    try {
      const suggestions = await getArtistEnrichmentSuggestions(token, artistId, candidateId);
      setResult(suggestions);
      setValues(Object.fromEntries(suggestions.suggestions.map((item) => [item.field, item.value])));
      setSelected(new Set());
      setReplacements(new Set());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not prepare suggestions. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (field: string, current: Set<string>, setter: (value: Set<string>) => void) => {
    const next = new Set(current);
    if (next.has(field)) next.delete(field);
    else next.add(field);
    setter(next);
    setApplied(false);
  };

  const apply = () => {
    if (!result) return;
    const edited = result.suggestions.map((item) => ({ ...item, value: values[item.field] ?? "" }));
    const next = applyArtistEnrichmentSuggestions(form, edited, selected, replacements);
    if (next.skipped.length) {
      setError(`Review the selected ${next.skipped.map((field) => FIELD_LABELS[field as ArtistEnrichmentField]).join(", ")} before applying.`);
      return;
    }
    setError(null);
    onApply(next.form);
    setApplied(true);
  };

  if (!open) {
    return <Button type="button" variant="ghost" onClick={start}>Suggest profile info with AI</Button>;
  }

  return (
    <section className="artist-enrichment" aria-label="Suggest artist profile information">
      <div className="artist-enrichment-heading">
        <div>
          <strong>Suggest profile info with AI</strong>
          <p>Choose the correct public artist first. Nothing changes until you review and save it.</p>
        </div>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Close</Button>
      </div>

      {error && <p className="artist-enrichment-error" role="alert">{error}</p>}
      {busy && <p role="status">Looking up public artist information…</p>}
      {!busy && !candidates && !result && (
        <Button type="button" variant="ghost" onClick={() => void search()}>Try search again</Button>
      )}

      {candidates && !result && (
        <div className="artist-enrichment-candidates">
          {candidates.length === 0 ? (
            <p>No matching public profiles found. You can keep editing manually or try the search again.</p>
          ) : (
            <>
              <p>Artists can share a name. Check the details and source before choosing.</p>
              {candidates.map((candidate) => (
                <label className="artist-enrichment-candidate" key={candidate.id}>
                  <input
                    type="radio"
                    name="artist-enrichment-candidate"
                    value={candidate.id}
                    checked={candidateId === candidate.id}
                    onChange={() => setCandidateId(candidate.id)}
                  />
                  <span>
                    <strong>{candidate.name}</strong>
                    {[candidate.disambiguation, candidate.area, candidate.type].filter(Boolean).join(" · ") && (
                      <small>{[candidate.disambiguation, candidate.area, candidate.type].filter(Boolean).join(" · ")}</small>
                    )}
                    {safeSourceUrl(candidate.sourceUrl) && (
                      <a href={candidate.sourceUrl} target="_blank" rel="noreferrer noopener" onClick={(event) => event.stopPropagation()}>View source</a>
                    )}
                  </span>
                </label>
              ))}
              <div className="artist-enrichment-actions">
                <Button type="button" onClick={() => void prepare()} disabled={!candidateId || busy}>Review suggestions</Button>
                <Button type="button" variant="ghost" onClick={() => setCandidates([])} disabled={busy}>None of these</Button>
              </div>
            </>
          )}
          <Button type="button" variant="ghost" onClick={() => void search()} disabled={busy}>Search again</Button>
        </div>
      )}

      {result && (
        <div className="artist-enrichment-review">
          <p>
            Suggestions for <strong>{result.candidate.name}</strong>
            {[result.candidate.disambiguation, result.candidate.area, result.candidate.type].filter(Boolean).length > 0
              ? ` · ${[result.candidate.disambiguation, result.candidate.area, result.candidate.type].filter(Boolean).join(" · ")}`
              : ""}. Check the{" "}
            {safeSourceUrl(result.candidate.sourceUrl) ? (
              <a href={result.candidate.sourceUrl} target="_blank" rel="noreferrer noopener">selected artist source</a>
            ) : "selected artist"}{" "}
            and each field source before adding anything to your form.
          </p>
          {result.warnings.map((warning, index) => <p className="artist-enrichment-warning" key={`${index}-${warning}`}>{warning}</p>)}
          {result.suggestions.length === 0 && <p>No usable suggestions were found. Your profile is unchanged.</p>}
          {result.suggestions.map((item: ArtistEnrichmentSuggestion) => {
            const field = item.field;
            const replacesExisting = Boolean(form[field].trim());
            return (
              <div className="artist-enrichment-suggestion" key={field}>
                <label className="artist-enrichment-select">
                  <input type="checkbox" checked={selected.has(field)} onChange={() => toggle(field, selected, setSelected)} />
                  <strong>{FIELD_LABELS[field]}</strong>
                  <span>{item.confidence} confidence</span>
                </label>
                {field === "summary" ? (
                  <textarea
                    aria-label={`Suggested ${FIELD_LABELS[field]}`}
                    className="ui-input artist-profile-edit-textarea"
                    value={values[field] ?? ""}
                    maxLength={2000}
                    rows={4}
                    onChange={(event) => setValues({ ...values, [field]: event.target.value })}
                  />
                ) : (
                  <input
                    aria-label={`Suggested ${FIELD_LABELS[field]}`}
                    className="ui-input"
                    value={values[field] ?? ""}
                    maxLength={2048}
                    onChange={(event) => setValues({ ...values, [field]: event.target.value })}
                  />
                )}
                {safeSourceUrl(item.sourceUrl) && <a href={item.sourceUrl} target="_blank" rel="noreferrer noopener">Source: {item.sourceLabel}</a>}
                {item.rights && <small>Image: {item.rights.license}. {safeSourceUrl(item.rights.descriptionUrl) && <a href={item.rights.descriptionUrl} target="_blank" rel="noreferrer noopener">Check file information before use.</a>}</small>}
                {item.rights?.attribution && <small>Image credit: {item.rights.attribution}</small>}
                {replacesExisting && selected.has(field) && (
                  <label className="artist-enrichment-replace">
                    <input type="checkbox" checked={replacements.has(field)} onChange={() => toggle(field, replacements, setReplacements)} />
                    Replace my existing {FIELD_LABELS[field].toLowerCase()}
                  </label>
                )}
              </div>
            );
          })}
          <div className="artist-enrichment-actions">
            <Button type="button" onClick={apply} disabled={busy || selected.size === 0}>Add selected fields to form</Button>
            <Button type="button" variant="ghost" onClick={() => { setResult(null); setSelected(new Set()); }} disabled={busy}>Choose a different artist</Button>
          </div>
          {applied && <p role="status">Added to the form. Review the fields above, then choose Save changes to publish them.</p>}
        </div>
      )}
    </section>
  );
}
