"use client";

import React, { useEffect, useState } from "react";
import { LicenseTermsPreview } from "../marketplace/LicenseTermsPreview";
import "../../styles/license-terms.css";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

interface StemPricing {
  stemId: string;
  stemTitle?: string;
  basePlayPriceUsd: number;
  remixLicenseUsd: number;
  commercialLicenseUsd: number;
  computed: {
    personal: number;
    remix: number;
    commercial: number;
  };
}

interface LicensingInfoSectionProps {
  /** Array of stem objects with IDs and titles */
  stems: Array<{ id: string; title: string }>;
}

function formatUsd(n: number): string {
  if (n === 0) return "Free";
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(2)}`;
}

/**
 * Public-facing licensing info section for the release detail page.
 * Shows a 3-column grid (Personal / Remix / Commercial) per stem.
 * Visible to ALL users, not just the owner.
 * Uses RFC #310 §1 rights descriptions and hierarchy.
 */
export function LicensingInfoSection({ stems }: LicensingInfoSectionProps) {
  const [pricingMap, setPricingMap] = useState<Record<string, StemPricing>>({});
  const [loading, setLoading] = useState(stems.length > 0);

  useEffect(() => {
    if (stems.length === 0) return;

    const stemIds = stems.map((s) => s.id).join(",");
    fetch(`${API_BASE}/api/stem-pricing/batch-get?stemIds=${stemIds}`)
      .then((res) => res.json())
      .then((data) => setPricingMap(data))
      .catch((err) => console.error("Failed to fetch licensing info:", err))
      .finally(() => setLoading(false));
  }, [stems]);

  if (loading) return null;
  if (Object.keys(pricingMap).length === 0) return null;

  return (
    <div className="licensing-info">
      <div className="licensing-info__header">
        <span className="licensing-info__icon">📜</span>
        <span className="licensing-info__title">Licensing</span>
      </div>

      {stems.map((stem) => {
        const pricing = pricingMap[stem.id];
        if (!pricing) return null;

        return (
          <div key={stem.id} className="licensing-info__stem-group">
            {stems.length > 1 && (
              <div className="licensing-info__stem-name">{stem.title}</div>
            )}
            <div className="licensing-info__grid">
              {/* Personal */}
              <div className="licensing-tier licensing-tier--personal">
                <div className="licensing-tier__name">Personal</div>
                <div className="licensing-tier__price">
                  {formatUsd(pricing.computed.personal)}
                  <small> USD</small>
                </div>
                <div className="licensing-tier__desc">
                  Stream &amp; collect — personal listening only
                </div>
                <LicenseTermsPreview licenseType="personal" />
              </div>

              {/* Remix */}
              <div className="licensing-tier licensing-tier--remix">
                <div className="licensing-tier__name">Remix</div>
                <div className="licensing-tier__price">
                  {formatUsd(pricing.computed.remix)}
                  <small> USD</small>
                </div>
                <div className="licensing-tier__desc">
                  Use in derivative works, publish remixes with attribution
                </div>
                <div className="licensing-tier__includes">
                  ✓ Includes personal rights
                </div>
                <LicenseTermsPreview licenseType="remix" />
              </div>

              {/* Commercial */}
              <div className="licensing-tier licensing-tier--commercial">
                <div className="licensing-tier__name">Commercial</div>
                <div className="licensing-tier__price">
                  {formatUsd(pricing.computed.commercial)}
                  <small> USD</small>
                </div>
                <div className="licensing-tier__desc">
                  Ads, films, products, monetized content
                </div>
                <div className="licensing-tier__includes">
                  ✓ Includes remix + personal rights
                </div>
                <LicenseTermsPreview licenseType="commercial" />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
