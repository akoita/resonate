import type { Metadata } from "next";
import { ConfirmEmailClient } from "../../../components/email/EmailLinkPages";
import { privateMetadata } from "../../../lib/seo";
import { tokenFromSearchParams } from "../../../lib/contactEmail";

// The link carries a single-use token: keep it out of Referer headers.
export const metadata: Metadata = {
  ...privateMetadata({ title: "Confirm your email" }),
  referrer: "no-referrer",
};

/** #2169: the page the confirmation email links to. `searchParams` is a promise in this Next.js. */
export default async function ConfirmEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const token = tokenFromSearchParams(await searchParams);
  return <ConfirmEmailClient token={token} />;
}
