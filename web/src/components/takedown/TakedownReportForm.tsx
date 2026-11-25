"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthProvider";
import { fileTakedownNotice, getContactEmail, getRelease, type TakedownNoticeReceipt } from "../../lib/api";
import {
  EMPTY_TAKEDOWN_FORM,
  TAKEDOWN_CAPACITIES,
  TAKEDOWN_CATEGORIES,
  TAKEDOWN_REASON_MAX,
  parseResonateContentLink,
  shortReference,
  takedownErrorMessage,
  toTakedownNotice,
  validateTakedownForm,
  type TakedownFormErrors,
  type TakedownFormValues,
} from "../../lib/takedownForm";
import styles from "./TakedownReportForm.module.css";

type TrackOption = { id: string; title: string };
type LoadedRelease = { id: string; title: string; tracks: TrackOption[] };

const FIELD_ORDER: Array<keyof TakedownFormValues> = [
  "trackId",
  "claimantName",
  "claimantCapacity",
  "claimantEmail",
  "originalWorkUrl",
  "category",
  "reason",
  "goodFaith",
];

/**
 * The public report form (#2664): no account and no stake. It posts a notice
 * to the operator queue, shows the reference, and tells the reporter what
 * happens next. Errors appear only after a send attempt, beside each field.
 */
export default function TakedownReportForm({
  initialReleaseId,
  initialTrackId,
}: {
  initialReleaseId?: string;
  initialTrackId?: string;
}) {
  const { token } = useAuth();
  const idBase = useId();
  const fieldId = (name: string) => `${idBase}-${name}`;
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<TakedownFormValues>({
    ...EMPTY_TAKEDOWN_FORM,
    trackId: initialTrackId ?? "",
    contentLocation: initialReleaseId
      ? `/release/${initialReleaseId}${initialTrackId ? `?track=${initialTrackId}` : ""}`
      : "",
  });
  const [errors, setErrors] = useState<TakedownFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<TakedownNoticeReceipt | null>(null);
  const [release, setRelease] = useState<LoadedRelease | null>(null);
  const [releaseState, setReleaseState] = useState<"idle" | "loading" | "missing">("idle");
  const [releaseId, setReleaseId] = useState<string | undefined>(initialReleaseId);

  // Load the release so the reporter can pick the track by name.
  useEffect(() => {
    if (!releaseId) return;
    let cancelled = false;
    setReleaseState("loading");
    getRelease(releaseId)
      .then((data) => {
        if (cancelled) return;
        const tracks = (data.tracks ?? []).map((t) => ({ id: t.id, title: t.title }));
        setRelease({ id: data.id, title: data.title, tracks });
        setReleaseState("idle");
        setValues((current) => {
          if (current.trackId && tracks.some((t) => t.id === current.trackId)) return current;
          return { ...current, trackId: tracks.length === 1 ? tracks[0].id : "" };
        });
      })
      .catch(() => {
        if (cancelled) return;
        setRelease(null);
        setReleaseState("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [releaseId]);

  // Prefill a signed-in reporter's confirmed notice address.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getContactEmail(token)
      .then((state) => {
        if (cancelled || !state?.address || state.status !== "confirmed") return;
        setValues((current) => (current.claimantEmail ? current : { ...current, claimantEmail: state.address ?? "" }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token]);

  const set = <K extends keyof TakedownFormValues>(name: K, value: TakedownFormValues[K]) => {
    setValues((current) => ({ ...current, [name]: value }));
    if (errors[name]) setErrors((current) => ({ ...current, [name]: undefined }));
  };

  const onLocationBlur = () => {
    const parsed = parseResonateContentLink(values.contentLocation);
    if (!parsed) return;
    if (parsed.releaseId !== releaseId) setReleaseId(parsed.releaseId);
    if (parsed.trackId) set("trackId", parsed.trackId);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const found = validateTakedownForm(values);
    setErrors(found);
    setSubmitError(null);
    const firstInvalid = FIELD_ORDER.find((name) => found[name]);
    if (firstInvalid) {
      formRef.current?.querySelector<HTMLElement>(`[data-field="${firstInvalid}"]`)?.focus();
      return;
    }
    setSubmitting(true);
    try {
      setReceipt(await fileTakedownNotice(toTakedownNotice(values)));
    } catch (error) {
      setSubmitError(takedownErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  if (receipt) {
    return (
      <section className={styles.done} aria-labelledby={fieldId("done")}>
        <h2 id={fieldId("done")}>Your notice was sent</h2>
        <p>
          Reference: <span className={styles.reference}>{shortReference(receipt.id)}</span>
        </p>
        <p>
          An operator reviews every notice. Nothing is removed before that review. If the content is removed, the person
          who uploaded it is told why and may send a counter-notice.
        </p>
        <p>
          {receipt.receiptSent
            ? "We also emailed you this reference."
            : "Keep this reference: quote it if you write to us about this notice."}
        </p>
        <p className={styles.hint}>Full reference: {receipt.id}</p>
        <p>
          <Link href="/">Back to Resonate</Link>
        </p>
      </section>
    );
  }

  const errorFor = (name: keyof TakedownFormValues) =>
    errors[name] ? (
      <p className={styles.error} id={fieldId(`${name}-error`)}>
        {errors[name]}
      </p>
    ) : null;
  const describedBy = (name: keyof TakedownFormValues, hint?: boolean) =>
    [hint ? fieldId(`${name}-hint`) : null, errors[name] ? fieldId(`${name}-error`) : null].filter(Boolean).join(" ") ||
    undefined;
  const invalid = (name: keyof TakedownFormValues) => (errors[name] ? "true" : "false");

  return (
    <form ref={formRef} className={styles.form} onSubmit={onSubmit} noValidate aria-label="Report content">
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>The content</legend>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={fieldId("contentLocation")}>
            Link to the content on Resonate
          </label>
          <p className={styles.hint} id={fieldId("contentLocation-hint")}>
            Paste the address of the release page. We use it to find the track.
          </p>
          <input
            id={fieldId("contentLocation")}
            className={styles.input}
            type="url"
            inputMode="url"
            value={values.contentLocation}
            onChange={(e) => set("contentLocation", e.target.value)}
            onBlur={onLocationBlur}
            aria-describedby={describedBy("contentLocation", true)}
            maxLength={2000}
          />
          {releaseState === "missing" && (
            <p className={styles.error} role="status">
              That release could not be found. Check the link.
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={fieldId("trackId")}>
            Track
          </label>
          <select
            id={fieldId("trackId")}
            data-field="trackId"
            className={styles.select}
            value={values.trackId}
            onChange={(e) => set("trackId", e.target.value)}
            required
            aria-invalid={invalid("trackId")}
            aria-describedby={describedBy("trackId")}
            disabled={!release && !values.trackId}
          >
            <option value="">
              {releaseState === "loading"
                ? "Loading tracks…"
                : release
                  ? `Choose a track from "${release.title}"`
                  : "Paste a release link first"}
            </option>
            {release?.tracks.map((track) => (
              <option key={track.id} value={track.id}>
                {track.title}
              </option>
            ))}
            {!release && values.trackId && <option value={values.trackId}>The track you were viewing</option>}
          </select>
          {errorFor("trackId")}
        </div>

        <fieldset className={styles.choices} data-field="category" tabIndex={-1} aria-describedby={describedBy("category")}>
          <legend className={styles.label}>Reason</legend>
          {TAKEDOWN_CATEGORIES.map((category) => (
            <label key={category.value} className={styles.choice}>
              <input
                className={styles.radio}
                type="radio"
                name={fieldId("category")}
                value={category.value}
                checked={values.category === category.value}
                onChange={() => set("category", category.value)}
                required
              />
              <span>
                {category.label}
                <small>{category.hint}</small>
              </span>
            </label>
          ))}
          {errorFor("category")}
        </fieldset>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={fieldId("originalWorkUrl")}>
            The work concerned
          </label>
          <p className={styles.hint} id={fieldId("originalWorkUrl-hint")}>
            Its title, or a link to where it is published. For impersonation, the name of the person or artist.
          </p>
          <input
            id={fieldId("originalWorkUrl")}
            data-field="originalWorkUrl"
            className={styles.input}
            value={values.originalWorkUrl}
            onChange={(e) => set("originalWorkUrl", e.target.value)}
            required
            maxLength={2000}
            aria-invalid={invalid("originalWorkUrl")}
            aria-describedby={describedBy("originalWorkUrl", true)}
          />
          {errorFor("originalWorkUrl")}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={fieldId("reason")}>
            What is wrong
          </label>
          <p className={styles.hint} id={fieldId("reason-hint")}>
            Explain in your own words. The person who uploaded the content does not see this text or your contact
            details.
          </p>
          <textarea
            id={fieldId("reason")}
            data-field="reason"
            className={styles.textarea}
            value={values.reason}
            onChange={(e) => set("reason", e.target.value)}
            required
            maxLength={TAKEDOWN_REASON_MAX}
            aria-invalid={invalid("reason")}
            aria-describedby={describedBy("reason", true)}
          />
          {errorFor("reason")}
        </div>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>About you</legend>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={fieldId("claimantName")}>
            Your name or organisation
          </label>
          <input
            id={fieldId("claimantName")}
            data-field="claimantName"
            className={styles.input}
            autoComplete="name"
            value={values.claimantName}
            onChange={(e) => set("claimantName", e.target.value)}
            required
            maxLength={200}
            aria-invalid={invalid("claimantName")}
            aria-describedby={describedBy("claimantName")}
          />
          {errorFor("claimantName")}
        </div>

        <fieldset
          className={styles.choices}
          data-field="claimantCapacity"
          tabIndex={-1}
          aria-describedby={describedBy("claimantCapacity")}
        >
          <legend className={styles.label}>How you are connected to the work</legend>
          {TAKEDOWN_CAPACITIES.map((capacity) => (
            <label key={capacity.value} className={styles.choice}>
              <input
                className={styles.radio}
                type="radio"
                name={fieldId("capacity")}
                value={capacity.value}
                checked={values.claimantCapacity === capacity.value}
                onChange={() => set("claimantCapacity", capacity.value)}
                required
              />
              <span>{capacity.label}</span>
            </label>
          ))}
          {errorFor("claimantCapacity")}
        </fieldset>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={fieldId("claimantEmail")}>
            Email
          </label>
          <p className={styles.hint} id={fieldId("claimantEmail-hint")}>
            We use it only to handle this notice.
          </p>
          <input
            id={fieldId("claimantEmail")}
            data-field="claimantEmail"
            className={styles.input}
            type="email"
            autoComplete="email"
            value={values.claimantEmail}
            onChange={(e) => set("claimantEmail", e.target.value)}
            required
            maxLength={320}
            aria-invalid={invalid("claimantEmail")}
            aria-describedby={describedBy("claimantEmail", true)}
          />
          {errorFor("claimantEmail")}
        </div>

        {/* Hidden from people; a value here marks the submission as automated. */}
        <div className={styles.honeypot} aria-hidden="true">
          <label htmlFor={fieldId("website")}>Website</label>
          <input
            id={fieldId("website")}
            tabIndex={-1}
            autoComplete="off"
            value={values.website}
            onChange={(e) => set("website", e.target.value)}
          />
        </div>
      </fieldset>

      <div className={styles.field}>
        <label className={styles.statement}>
          <input
            className={styles.checkbox}
            data-field="goodFaith"
            type="checkbox"
            checked={values.goodFaith}
            onChange={(e) => set("goodFaith", e.target.checked)}
            required
            aria-invalid={invalid("goodFaith")}
            aria-describedby={describedBy("goodFaith")}
          />
          <span>
            I believe in good faith that this use is not authorised by the rights holder or the law, and the information
            in this notice is accurate.
          </span>
        </label>
        {errorFor("goodFaith")}
      </div>

      {submitError && (
        <p className={styles.alert} role="alert">
          {submitError}
        </p>
      )}

      <div className={styles.actions}>
        <button className={styles.button} type="submit" disabled={submitting}>
          {submitting ? "Sending…" : "Send notice"}
        </button>
        <span className={styles.hint}>No account needed. You will get a reference.</span>
      </div>
    </form>
  );
}
