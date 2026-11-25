import type { Metadata } from "next";
import Link from "next/link";
import TakedownReportForm from "../../components/takedown/TakedownReportForm";

export const metadata: Metadata = { title: "Report content" };

function single(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.length <= 64 ? first : undefined;
}

/** The public notice channel named in the Terms (#2664): no account, no stake. */
export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <main className="report-page">
      <h1>Report content</h1>
      <p className="report-page__lead">
        Tell us about content on Resonate that uses your work without permission, impersonates someone, or is unlawful.
        You do not need an account. An operator reviews every notice before anything is removed.
      </p>
      <p className="report-page__lead">
        If you uploaded the content and received a notice about it, answer it from{" "}
        <Link href="/report/respond">your notices</Link>.
      </p>
      <TakedownReportForm initialReleaseId={single(params.release)} initialTrackId={single(params.track)} />
    </main>
  );
}
