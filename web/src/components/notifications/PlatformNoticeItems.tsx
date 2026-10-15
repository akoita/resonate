"use client";

import type { PlatformNotice } from "../../lib/api";
import { NOTICE_CATEGORY_LABELS, formatNoticeEffectiveDate } from "../../lib/platformNotices";

/**
 * #2146: platform notices as rows in the notification bell, each labelled
 * with its category. Presentational so the list can be asserted statically.
 * A notice with a link opens it; one without just marks itself read.
 */
export default function PlatformNoticeItems({
  notices,
  onSelect,
}: {
  notices: readonly PlatformNotice[];
  onSelect: (notice: PlatformNotice) => void;
}) {
  return (
    <>
      {notices.map((notice) => {
        const effective = formatNoticeEffectiveDate(notice.effectiveAt);
        const unread = !notice.readAt;
        return (
          <button
            key={notice.id}
            type="button"
            data-notice-id={notice.id}
            onClick={() => onSelect(notice)}
            style={{
              ...itemStyle,
              background: unread ? "rgba(99, 102, 241, 0.06)" : "transparent",
            }}
          >
            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
              <span style={chipStyle}>{NOTICE_CATEGORY_LABELS[notice.category]}</span>
              <span style={{ fontWeight: 600, fontSize: "12px" }}>{notice.title}</span>
            </div>
            <div style={bodyStyle}>{notice.body}</div>
            {effective ? <div style={metaStyle}>{effective}</div> : null}
            <div style={hintStyle}>
              {notice.link ? "Open →" : unread ? "Mark as read" : notice.kind === "broadcast" ? "Platform notice" : "Notice for you"}
            </div>
            {unread ? <span aria-label="Unread" style={unreadDotStyle} /> : null}
          </button>
        );
      })}
    </>
  );
}

const itemStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  color: "inherit",
  font: "inherit",
  border: "none",
  borderBottom: "1px solid rgba(255,255,255,0.04)",
  padding: "10px 24px 10px 14px",
  position: "relative",
  cursor: "pointer",
};

const chipStyle: React.CSSProperties = {
  padding: "1px 6px",
  borderRadius: "999px",
  border: "1px solid rgba(167, 139, 250, 0.45)",
  color: "#c4b5fd",
  fontSize: "9px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const bodyStyle: React.CSSProperties = {
  fontSize: "11px",
  opacity: 0.7,
  marginTop: "4px",
  lineHeight: "1.4",
  overflowWrap: "anywhere",
  whiteSpace: "pre-line",
};

const metaStyle: React.CSSProperties = { fontSize: "10px", opacity: 0.5, marginTop: "4px" };

const hintStyle: React.CSSProperties = { fontSize: "10px", color: "#a78bfa", marginTop: "6px", fontWeight: 600 };

const unreadDotStyle: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  right: "10px",
  transform: "translateY(-50%)",
  width: "6px",
  height: "6px",
  borderRadius: "50%",
  background: "#6366f1",
};
