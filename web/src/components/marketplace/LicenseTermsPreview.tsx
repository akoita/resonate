"use client";

import { useState } from "react";

export type LicenseKey = "personal" | "remix" | "commercial";

interface TermRow {
  term: string;
  value: string;
}

interface LicenseTermsData {
  title: string;
  purpose: string;
  summary: string;
  terms: TermRow[];
  /** Template file name (will be on IPFS once deployed) */
  templateName: string;
}

const LICENSE_TERMS: Record<LicenseKey, LicenseTermsData> = {
  personal: {
    title: "Personal Streaming License",
    purpose: "Stream and listen for personal, non-commercial use.",
    summary:
      "The Licensor grants the Licensee a non-exclusive, non-transferable, revocable license to stream the Work for personal, non-commercial listening purposes through the Resonate platform. This license does not grant any right to download, copy, distribute, modify, or publicly perform the Work.",
    terms: [
      { term: "Grant", value: "Non-exclusive, non-transferable" },
      { term: "Territory", value: "Worldwide" },
      { term: "Duration", value: "Session-based (revocable)" },
      { term: "Attribution", value: "Not required" },
      { term: "Modification", value: "None permitted" },
      { term: "Sub-licensing", value: "Not permitted" },
      { term: "Revenue", value: "Per-play micro-payment" },
    ],
    templateName: "resonate-personal-streaming-v1",
  },
  remix: {
    title: "Remix License",
    purpose: "Use in derivative works — remixes, mashups, new compositions.",
    summary:
      "The Licensor grants the Licensee a non-exclusive, transferable license to incorporate the Work into derivative musical compositions (\"Remixes\"). The Licensee must credit the original artist in all published metadata. The Licensee may not re-release the Work in its unmodified form. An ongoing royalty is paid to the Licensor via automated on-chain distribution.",
    terms: [
      { term: "Grant", value: "Non-exclusive, transferable" },
      { term: "Territory", value: "Worldwide" },
      { term: "Duration", value: "Perpetual (default)" },
      { term: "Attribution", value: "Required — credit original artist" },
      { term: "Modification", value: "Remix only (no re-release of original)" },
      { term: "Sub-licensing", value: "Not permitted" },
      { term: "Revenue", value: "Ongoing royalty (5% on-chain split)" },
    ],
    templateName: "resonate-remix-license-v1",
  },
  commercial: {
    title: "Commercial License",
    purpose: "Use in monetized content — ads, films, products, live shows.",
    summary:
      "The Licensor grants the Licensee a license to use the Work in commercial productions, including advertisements, films, podcasts, live performances, and branded content. The Licensee shall pay a one-time license fee and an optional ongoing royalty on revenue attributable to the Work.",
    terms: [
      { term: "Grant", value: "Exclusive or non-exclusive (artist choice)" },
      { term: "Territory", value: "Worldwide or restricted" },
      { term: "Duration", value: "Fixed term (12 months), renewable" },
      { term: "Attribution", value: "Required — per agreed format" },
      { term: "Modification", value: "Full (may alter, edit, arrange)" },
      { term: "Sub-licensing", value: "Optional (if exclusive)" },
      { term: "Revenue", value: "One-time fee + optional royalty" },
    ],
    templateName: "resonate-commercial-license-v1",
  },
};

interface LicenseTermsPreviewProps {
  licenseType: LicenseKey;
  /** Compact mode hides the summary paragraph (used in modal) */
  compact?: boolean;
}

export function LicenseTermsPreview({ licenseType, compact }: LicenseTermsPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const data = LICENSE_TERMS[licenseType];

  return (
    <div className={`license-terms ${expanded ? "license-terms--expanded" : ""}`}>
      <button
        className="license-terms__toggle"
        onClick={() => setExpanded(v => !v)}
        type="button"
      >
        <span className="license-terms__toggle-icon">{expanded ? "▾" : "▸"}</span>
        <span className="license-terms__toggle-text">
          {expanded ? "Hide" : "View"} License Terms
        </span>
        <span className="license-terms__toggle-badge">📄</span>
      </button>

      {expanded && (
        <div className="license-terms__content">
          <p className="license-terms__purpose">{data.purpose}</p>

          <table className="license-terms__table">
            <tbody>
              {data.terms.map((row) => (
                <tr key={row.term} className="license-terms__row">
                  <td className="license-terms__term">{row.term}</td>
                  <td className="license-terms__value">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {!compact && (
            <blockquote className="license-terms__summary">
              {data.summary}
            </blockquote>
          )}

          <div className="license-terms__full-link" title="Full legal template stored on IPFS">
            <span className="license-terms__full-link-icon">📋</span>
            {data.templateName}.md
            <span className="license-terms__ipfs-badge">IPFS</span>
          </div>

          <p className="license-terms__disclaimer">
            ⚠️ Framework outline — full legal template will be linked to the License NFT covenant on IPFS.
          </p>
        </div>
      )}
    </div>
  );
}
