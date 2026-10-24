"use client";

import React, { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../ui/Toast";
import {
  OFFICIAL_STEM_TYPES,
  getOfficialStemFileValidationError,
  uploadOfficialStems,
  type OfficialStemType,
} from "../../lib/api";
import {
  OFFICIAL_STEMS_ACCEPTED_FORMATS,
  OFFICIAL_STEMS_FORM_HINT,
  describeOfficialStemUpload,
  formatFileSize,
  officialStemRejectionIssues,
  stemTypeLabel,
  type OfficialStemIssue,
} from "../../lib/officialStems";
import { StemSourceBadge } from "../stem/StemSourceBadge";
import "../../styles/stem-pricing.css";

interface OfficialStemsPanelProps {
  releaseId: string;
  releaseStatus?: string | null;
  tracks: Array<{
    trackId: string;
    trackTitle: string;
    /** Stem types that already have a current official stem. */
    officialTypes: string[];
  }>;
}

type ChosenFiles = Partial<Record<OfficialStemType, File>>;

interface OfficialStemsUploadFormProps {
  files: ChosenFiles;
  /** Why the server refused the package; part issues show under their row. */
  issues: OfficialStemIssue[];
  /** A problem with a file picked here (for example, not WAV or FLAC), by part. */
  fileErrors: Partial<Record<OfficialStemType, string>>;
  /** A failure that is not about one part. */
  error: string | null;
  uploading: boolean;
  /** Bumped when a picker is cleared, so its native input resets. */
  inputKeys: Partial<Record<OfficialStemType, number>>;
  onChoose: (type: OfficialStemType, file: File | undefined) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

/**
 * The upload form of one track: one compact row per stem type with a styled
 * picker (a hidden native input behind a button label), the chosen file's name
 * and size, a remove control, and any refusal reason right under its row.
 */
export function OfficialStemsUploadForm({
  files,
  issues,
  fileErrors,
  error,
  uploading,
  inputKeys,
  onChoose,
  onSubmit,
  onCancel,
}: OfficialStemsUploadFormProps) {
  const count = Object.keys(files).length;
  const generalIssues = issues.filter((issue) => !issue.stemType || !(OFFICIAL_STEM_TYPES as readonly string[]).includes(issue.stemType));
  return (
    <div className="official-stems-panel__form">
      <p className="official-stems-panel__hint">{OFFICIAL_STEMS_FORM_HINT}</p>
      {generalIssues.length > 0 && (
        <div role="alert" className="official-stems-panel__error" data-testid="official-stems-issues">
          {generalIssues.map((issue) => (
            <p key={issue.message}>{issue.message}</p>
          ))}
        </div>
      )}
      <ul className="official-stems-rows">
        {OFFICIAL_STEM_TYPES.map((type) => {
          const file = files[type];
          const rowIssues = issues.filter((issue) => issue.stemType === type);
          const fileError = fileErrors[type];
          const label = stemTypeLabel(type);
          return (
            <li key={type} className={`official-stems-row${rowIssues.length > 0 || fileError ? " official-stems-row--refused" : ""}`} data-stem-type={type}>
              <span className="official-stems-row__type">{label}</span>
              <div className="official-stems-row__file">
                {file ? (
                  <span className="official-stems-row__chosen" title={file.name}>
                    <span className="official-stems-row__name">{file.name}</span>
                    <span className="official-stems-row__size">{formatFileSize(file.size)}</span>
                  </span>
                ) : (
                  <span className="official-stems-row__empty">{OFFICIAL_STEMS_ACCEPTED_FORMATS}</span>
                )}
              </div>
              <div className="official-stems-row__actions">
                <label className="ui-btn ui-btn-ghost ui-btn-sm official-stems-row__pick">
                  {file ? "Change" : "Choose file"}
                  <input
                    key={inputKeys[type] ?? 0}
                    type="file"
                    className="official-stems-row__input"
                    accept=".wav,.flac,audio/wav,audio/flac"
                    aria-label={`${label} file (WAV or FLAC)`}
                    disabled={uploading}
                    onChange={(event) => onChoose(type, event.target.files?.[0])}
                  />
                </label>
                {file && (
                  <button
                    type="button"
                    className="official-stems-row__remove"
                    aria-label={`Remove the ${type} file`}
                    disabled={uploading}
                    onClick={() => onChoose(type, undefined)}
                  >
                    ×
                  </button>
                )}
              </div>
              {fileError && (
                <p role="alert" className="official-stems-row__issue">{fileError}</p>
              )}
              {rowIssues.map((issue) => (
                <p key={issue.message} role="alert" className="official-stems-row__issue">{issue.message}</p>
              ))}
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="official-stems-panel__error">{error}</p>}
      <div className="official-stems-panel__actions">
        <button type="button" className="ui-btn ui-btn-ghost" onClick={onCancel} disabled={uploading}>
          Cancel
        </button>
        <button
          type="button"
          className="ui-btn ui-btn-primary"
          disabled={uploading || count === 0}
          onClick={onSubmit}
        >
          {uploading ? "Checking and uploading…" : count > 0 ? `Upload ${count} ${count === 1 ? "part" : "parts"}` : "Upload"}
        </button>
      </div>
    </div>
  );
}

/**
 * Owner-only: upload the artist's own lossless parts for a published track
 * (#1976, ADR-TE-7). Official stems are checked against the published mix and
 * sold as "Official", next to the "Separated (AI)" stems Resonate makes itself.
 */
export function OfficialStemsPanel({ releaseId, releaseStatus, tracks }: OfficialStemsPanelProps) {
  const { token } = useAuth();
  const { addToast } = useToast();
  const [openTrackId, setOpenTrackId] = useState<string | null>(null);
  const [files, setFiles] = useState<ChosenFiles>({});
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileErrors, setFileErrors] = useState<Partial<Record<OfficialStemType, string>>>({});
  /** One reason per problem when the server refuses a package. */
  const [issues, setIssues] = useState<OfficialStemIssue[]>([]);
  const [inputKeys, setInputKeys] = useState<Partial<Record<OfficialStemType, number>>>({});
  const [uploaded, setUploaded] = useState<Record<string, string[]>>({});

  if (releaseStatus && releaseStatus !== "ready" && releaseStatus !== "published") return null;
  if (tracks.length === 0) return null;

  const resetForm = () => {
    setFiles({});
    setError(null);
    setIssues([]);
    setFileErrors({});
    setInputKeys({});
  };

  const choose = (type: OfficialStemType, file: File | undefined) => {
    setError(null);
    setIssues((current) => current.filter((issue) => issue.stemType !== type));
    setFileErrors((current) => {
      const next = { ...current };
      delete next[type];
      return next;
    });
    const problem = file ? getOfficialStemFileValidationError(file) : null;
    if (file && problem) {
      setFileErrors((current) => ({ ...current, [type]: problem }));
    }
    if (!file || problem) {
      // Clearing, or refusing a bad pick: reset the native input too.
      setInputKeys((current) => ({ ...current, [type]: (current[type] ?? 0) + 1 }));
    }
    setFiles((current) => {
      const next = { ...current };
      if (file && !problem) next[type] = file;
      else delete next[type];
      return next;
    });
  };

  const submit = async (trackId: string) => {
    if (!token) return;
    setUploading(true);
    setError(null);
    setIssues([]);
    try {
      const result = await uploadOfficialStems(token, releaseId, trackId, files);
      setUploaded((current) => ({
        ...current,
        [trackId]: [...new Set([...(current[trackId] ?? tracks.find((track) => track.trackId === trackId)?.officialTypes ?? []), ...result.stems.map((stem) => stem.type)])],
      }));
      resetForm();
      setOpenTrackId(null);
      addToast({
        type: "success",
        title: "Official stems added",
        message: describeOfficialStemUpload(result),
      });
    } catch (err) {
      const reasons = officialStemRejectionIssues(err);
      if (reasons.length > 0) {
        setIssues(reasons);
      } else {
        setError(err instanceof Error ? err.message : "The stems could not be uploaded.");
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="official-stems-panel" data-testid="official-stems-panel" aria-labelledby="official-stems-title">
      <h3 id="official-stems-title">Official stems</h3>
      <p className="official-stems-panel__intro">
        Upload your own lossless parts (WAV or FLAC), exported from the same start point as the published mix. Buyers
        see them as <StemSourceBadge source="official" /> and receive the lossless file. You price them separately from
        the <StemSourceBadge source="separated" /> stems below, and Resonate sets no minimum price.
      </p>
      {tracks.map((track) => {
        const have = [...new Set(uploaded[track.trackId] ?? track.officialTypes)];
        const isOpen = openTrackId === track.trackId;
        return (
          <div key={track.trackId} className="official-stems-panel__track">
            <div className="official-stems-panel__track-head">
              <div className="official-stems-panel__track-title">
                <strong>{track.trackTitle}</strong>
                {have.length > 0 ? (
                  <ul className="official-stems-chips" aria-label={`Official stems of ${track.trackTitle}`}>
                    {have.map((type) => (
                      <li key={type} className="official-stems-chip">{stemTypeLabel(type)}</li>
                    ))}
                  </ul>
                ) : (
                  <span className="official-stems-panel__none">No official stems yet</span>
                )}
              </div>
              <button
                type="button"
                className={`ui-btn ui-btn-sm ${isOpen ? "ui-btn-ghost" : have.length > 0 ? "ui-btn-ghost" : "ui-btn-primary"}`}
                onClick={() => {
                  resetForm();
                  setOpenTrackId(isOpen ? null : track.trackId);
                }}
              >
                {isOpen ? "Close" : have.length > 0 ? "Replace official stems" : "Upload official stems"}
              </button>
            </div>
            {isOpen && (
              <OfficialStemsUploadForm
                files={files}
                issues={issues}
                fileErrors={fileErrors}
                error={error}
                uploading={uploading}
                inputKeys={inputKeys}
                onChoose={choose}
                onSubmit={() => void submit(track.trackId)}
                onCancel={() => {
                  resetForm();
                  setOpenTrackId(null);
                }}
              />
            )}
          </div>
        );
      })}
    </section>
  );
}
