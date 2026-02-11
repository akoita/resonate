"use client";

import React from "react";

interface LicenseBadgesProps {
  remixLicenseUsd?: number;
  commercialLicenseUsd?: number;
}

function formatUsd(n: number): string {
  if (n === 0) return "Free";
  if (n >= 1) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
}

/**
 * Inline pill badges showing remix/commercial license prices.
 * Rendered on marketplace listing cards.
 * RFC #310 §1 — surfaces Personal ⊂ Remix ⊂ Commercial hierarchy.
 */
export function LicenseBadges({ remixLicenseUsd, commercialLicenseUsd }: LicenseBadgesProps) {
  if (remixLicenseUsd == null && commercialLicenseUsd == null) return null;

  return (
    <div className="license-badges">
      {remixLicenseUsd != null && (
        <span className="license-badge license-badge--remix">
          <span className="license-badge__icon">🔄</span>
          <span className="license-badge__price">{formatUsd(remixLicenseUsd)}</span>
        </span>
      )}
      {commercialLicenseUsd != null && (
        <span className="license-badge license-badge--commercial">
          <span className="license-badge__icon">💼</span>
          <span className="license-badge__price">{formatUsd(commercialLicenseUsd)}</span>
        </span>
      )}
    </div>
  );
}
