"use client";

import React from "react";
import { LicenseTermsPreview } from "../marketplace/LicenseTermsPreview";
import "../../styles/license-terms.css";

/**
 * Public-facing licensing info — release-level, not per-track.
 * Shows the 3 license tiers (Personal / Remix / Commercial) with
 * descriptions, rights hierarchy, and expandable legal terms.
 */
export function LicensingInfoSection() {
  return (
    <div className="licensing-info">
      <div className="licensing-info__header">
        <span className="licensing-info__icon">📜</span>
        <span className="licensing-info__title">Licensing</span>
      </div>

      <div className="licensing-info__grid">
        {/* Personal */}
        <div className="licensing-tier licensing-tier--personal">
          <div className="licensing-tier__name">Personal</div>
          <div className="licensing-tier__desc">
            Stream &amp; collect — personal listening only.
            Non-transferable, non-commercial.
          </div>
          <LicenseTermsPreview licenseType="personal" />
        </div>

        {/* Remix */}
        <div className="licensing-tier licensing-tier--remix">
          <div className="licensing-tier__name">Remix</div>
          <div className="licensing-tier__desc">
            Use in derivative works, publish remixes with attribution.
            Non-commercial distribution permitted.
          </div>
          <div className="licensing-tier__includes">
            ✓ Includes personal rights
          </div>
          <LicenseTermsPreview licenseType="remix" />
        </div>

        {/* Commercial */}
        <div className="licensing-tier licensing-tier--commercial">
          <div className="licensing-tier__name">Commercial</div>
          <div className="licensing-tier__desc">
            Ads, films, products, monetized content.
            Full commercial exploitation rights.
          </div>
          <div className="licensing-tier__includes">
            ✓ Includes remix + personal rights
          </div>
          <LicenseTermsPreview licenseType="commercial" />
        </div>
      </div>
    </div>
  );
}
