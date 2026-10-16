import type { Metadata } from "next";
import { UnsubscribeClient } from "../../../components/email/EmailLinkPages";
import { privateMetadata } from "../../../lib/seo";
import { tokenFromSearchParams } from "../../../lib/contactEmail";

// The link carries a token: keep it out of Referer headers.
export const metadata: Metadata = {
  ...privateMetadata({ title: "Unsubscribe from notice emails" }),
  referrer: "no-referrer",
};

/**
 * #2169: the page a notice email's unsubscribe link opens. It only shows a
 * button; nothing is changed until the person clicks it.
 */
export default async function UnsubscribeEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const token = tokenFromSearchParams(await searchParams);
  return <UnsubscribeClient token={token} />;
}
