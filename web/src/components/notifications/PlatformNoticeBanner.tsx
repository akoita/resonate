"use client";

import { useState } from "react";
import Link from "next/link";
import { useToast } from "../ui/Toast";
import { usePlatformNotices } from "../../hooks/usePlatformNotices";
import {
  NOTICE_CATEGORY_LABELS,
  formatNoticeEffectiveDate,
  selectBannerNotice,
} from "../../lib/platformNotices";
import type { PlatformNotice } from "../../lib/api";

/**
 * #2146: a policy, terms or incident broadcast is announced at the top of the
 * app until the person dismisses it (which marks it read). In normal flow
 * under the topbar, like the account-deletion notice, so it never covers the
 * consent banner's corner or the content underneath. Also drives the shared
 * notices poll, since the shell is always mounted. Signed-out: renders nothing.
 */
export default function PlatformNoticeBanner() {
  const { notices, markRead } = usePlatformNotices({ poll: true });
  const { addToast } = useToast();
  const [dismissing, setDismissing] = useState(false);
  const notice = selectBannerNotice(notices);
  if (!notice) return null;

  const dismiss = async () => {
    if (dismissing) return;
    setDismissing(true);
    try {
      await markRead(notice.id);
    } catch {
      addToast({ type: "error", title: "Could not dismiss", message: "Please try again in a moment." });
    } finally {
      setDismissing(false);
    }
  };

  return <PlatformNoticeBannerView notice={notice} dismissing={dismissing} onDismiss={() => void dismiss()} />;
}

/** Presentational, so the copy and the dismiss control can be asserted without a session. */
export function PlatformNoticeBannerView({
  notice,
  dismissing,
  onDismiss,
}: {
  notice: PlatformNotice;
  dismissing: boolean;
  onDismiss: () => void;
}) {
  const effective = formatNoticeEffectiveDate(notice.effectiveAt);
  const isIncident = notice.category === "incident";
  return (
    <section
      role="region"
      aria-labelledby="platform-notice-banner-title"
      data-notice-id={notice.id}
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "12px",
        padding: "10px 16px",
        borderBottom: `1px solid ${isIncident ? "rgba(245, 158, 11, 0.32)" : "rgba(99, 102, 241, 0.32)"}`,
        background: isIncident ? "rgba(245, 158, 11, 0.12)" : "rgba(99, 102, 241, 0.12)",
        color: "var(--color-text, #fff)",
        fontSize: "0.85rem",
        lineHeight: 1.5,
      }}
    >
      <div style={{ margin: 0, flex: "1 1 320px", minWidth: "220px" }}>
        <span style={categoryChipStyle}>{NOTICE_CATEGORY_LABELS[notice.category]}</span>{" "}
        <strong id="platform-notice-banner-title">{notice.title}</strong>
        {effective ? <span style={{ opacity: 0.75 }}> · {effective}</span> : null}
        <p style={{ margin: "4px 0 0", opacity: 0.85, whiteSpace: "pre-line" }}>{notice.body}</p>
      </div>
      <span style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
        {notice.link ? (
          <Link href={notice.link} style={{ textDecoration: "underline" }}>
            Read more
          </Link>
        ) : null}
        <button type="button" className="ui-btn ui-btn-ghost" onClick={onDismiss} disabled={dismissing}>
          {dismissing ? "Dismissing..." : "Dismiss"}
        </button>
      </span>
    </section>
  );
}

const categoryChipStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "1px 8px",
  borderRadius: "999px",
  border: "1px solid rgba(255,255,255,0.2)",
  fontSize: "0.7rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};
