import type { Metadata } from "next";
import Link from "next/link";
import SupportRequestForm from "../../components/support/SupportRequestForm";
import { operatorContactEmail } from "../../lib/legalDocuments";

export const metadata: Metadata = { title: "Contact support" };

/** Contact support (#2667): a short form for everyone, signed in or not. */
export default function SupportPage() {
  const contact = operatorContactEmail();
  return (
    <main className="report-page">
      <h1>Contact support</h1>
      <p className="report-page__lead">
        Tell us what went wrong or what you need. A person on the Resonate team reads every message. Many answers are
        already in the <Link href="/help">User Guide</Link>.
      </p>
      <p className="report-page__lead">
        To report content that uses your work without permission, use the <Link href="/report">report form</Link>{" "}
        instead.
        {contact ? (
          <>
            {" "}
            You can also write to <a href={`mailto:${contact}`}>{contact}</a>.
          </>
        ) : null}
      </p>
      <SupportRequestForm />
    </main>
  );
}
