"use client";

import Link from "next/link";
import { useId, useRef, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthProvider";
import { sendSupportRequest, type SupportRequestReceipt } from "../../lib/api";
import {
  EMPTY_SUPPORT_FORM,
  SUPPORT_MESSAGE_MAX,
  SUPPORT_TOPICS,
  supportErrorMessage,
  validateSupportForm,
  type SupportFormErrors,
  type SupportFormValues,
} from "../../lib/supportForm";
import { shortReference } from "../../lib/takedownForm";
import styles from "../takedown/TakedownReportForm.module.css";

const FIELD_ORDER: Array<keyof SupportFormErrors> = ["topic", "message", "email"];

/**
 * Contact support (#2667). Open to everyone: a signed-in person's request is
 * linked to their account and answered at their confirmed address; a
 * signed-out visitor may leave an address so we can answer.
 */
export default function SupportRequestForm() {
  const { token, status } = useAuth();
  const signedIn = status === "authenticated" && Boolean(token);
  const idBase = useId();
  const fieldId = (name: string) => `${idBase}-${name}`;
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<SupportFormValues>(EMPTY_SUPPORT_FORM);
  const [errors, setErrors] = useState<SupportFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<SupportRequestReceipt | null>(null);

  const set = <K extends keyof SupportFormValues>(name: K, value: SupportFormValues[K]) =>
    setValues((current) => ({ ...current, [name]: value }));

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const found = validateSupportForm(values);
    setErrors(found);
    setSubmitError(null);
    const firstInvalid = FIELD_ORDER.find((name) => found[name]);
    if (firstInvalid) {
      formRef.current?.querySelector<HTMLElement>(`[data-field="${firstInvalid}"]`)?.focus();
      return;
    }
    if (!values.topic) return;
    setSubmitting(true);
    try {
      const email = values.email.trim();
      setReceipt(
        await sendSupportRequest(
          {
            topic: values.topic,
            message: values.message.trim(),
            ...(email ? { email } : {}),
            ...(values.website ? { website: values.website } : {}),
          },
          signedIn ? token : null,
        ),
      );
    } catch (error) {
      setSubmitError(supportErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  if (receipt) {
    return (
      <section className={styles.done} aria-labelledby={fieldId("done")}>
        <h2 id={fieldId("done")}>Your message was sent</h2>
        <p>
          Reference: <span className={styles.reference}>{shortReference(receipt.id)}</span>
        </p>
        <p>
          {receipt.receiptSent
            ? "We emailed you this reference. We answer by email, usually within a few working days."
            : values.email.trim() || signedIn
              ? "We answer by email, usually within a few working days. Keep this reference if you write again."
              : "You did not leave an email address, so we cannot write back. Keep this reference if you contact us again."}
        </p>
        <p className={styles.hint}>Full reference: {receipt.id}</p>
        <p>
          <Link href="/help">Browse the User Guide</Link>
        </p>
      </section>
    );
  }

  const errorFor = (name: keyof SupportFormErrors) =>
    errors[name] ? (
      <p className={styles.error} id={fieldId(`${name}-error`)}>
        {errors[name]}
      </p>
    ) : null;
  const describedBy = (name: keyof SupportFormErrors, hint?: boolean) =>
    [hint ? fieldId(`${name}-hint`) : null, errors[name] ? fieldId(`${name}-error`) : null].filter(Boolean).join(" ") ||
    undefined;
  const invalid = (name: keyof SupportFormErrors) => (errors[name] ? "true" : "false");

  return (
    <form ref={formRef} className={styles.form} onSubmit={onSubmit} noValidate aria-label="Contact support">
      <div className={styles.field}>
        <label className={styles.label} htmlFor={fieldId("topic")}>
          What is it about?
        </label>
        <select
          id={fieldId("topic")}
          data-field="topic"
          className={styles.select}
          value={values.topic}
          onChange={(e) => set("topic", e.target.value as SupportFormValues["topic"])}
          required
          aria-invalid={invalid("topic")}
          aria-describedby={describedBy("topic")}
        >
          <option value="">Choose a topic</option>
          {SUPPORT_TOPICS.map((topic) => (
            <option key={topic.value} value={topic.value}>
              {topic.label}
            </option>
          ))}
        </select>
        {errorFor("topic")}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={fieldId("message")}>
          Your message
        </label>
        <p className={styles.hint} id={fieldId("message-hint")}>
          Say what you were trying to do and what happened. Please do not include passwords, recovery phrases or card
          numbers.
        </p>
        <textarea
          id={fieldId("message")}
          data-field="message"
          className={styles.textarea}
          value={values.message}
          onChange={(e) => set("message", e.target.value)}
          required
          maxLength={SUPPORT_MESSAGE_MAX}
          aria-invalid={invalid("message")}
          aria-describedby={describedBy("message", true)}
        />
        {errorFor("message")}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={fieldId("email")}>
          {signedIn ? "Reply to a different address (optional)" : "Your email (optional)"}
        </label>
        <p className={styles.hint} id={fieldId("email-hint")}>
          {signedIn
            ? "We answer at the email address in your settings. Add one here only if you want the answer somewhere else."
            : "Leave an address if you would like an answer. We use it only for this request."}
        </p>
        <input
          id={fieldId("email")}
          data-field="email"
          className={styles.input}
          type="email"
          autoComplete="email"
          value={values.email}
          onChange={(e) => set("email", e.target.value)}
          maxLength={254}
          aria-invalid={invalid("email")}
          aria-describedby={describedBy("email", true)}
        />
        {errorFor("email")}
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

      {submitError && (
        <p className={styles.alert} role="alert">
          {submitError}
        </p>
      )}

      <div className={styles.actions}>
        <button className={styles.button} type="submit" disabled={submitting}>
          {submitting ? "Sending…" : "Send message"}
        </button>
        <span className={styles.hint}>You will get a reference.</span>
      </div>
    </form>
  );
}
