"use client";

import React from "react";

/** License type enum matching RFC #310 License NFT Schema */
export type LicenseType = "personal" | "remix" | "commercial";

interface LicenseTypeSelectorProps {
  selected: LicenseType;
  onSelect: (type: LicenseType) => void;
  personalPriceUsd: number;
  remixPriceUsd: number;
  commercialPriceUsd: number;
  availability?: Partial<Record<LicenseType, {
    enabled: boolean;
    reason?: string;
  }>>;
}

const LICENSE_OPTIONS: {
  type: LicenseType;
  label: string;
  desc: string;
  includes?: string;
}[] = [
  {
    type: "personal",
    label: "Personal (NFT)",
    desc: "Stream & collect — personal listening",
  },
  {
    type: "remix",
    label: "Remix License",
    desc: "Use in derivative works, publish remixes",
    includes: "Includes personal rights",
  },
  {
    type: "commercial",
    label: "Commercial License",
    desc: "Ads, films, products, monetized content",
    includes: "Includes remix + personal rights",
  },
];

function formatUsd(n: number): string {
  if (n === 0) return "Free";
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(2)}`;
}

/**
 * Radio card group for the buy flow.
 * Maps to RFC #310 §1 rights matrix: Personal ⊂ Remix ⊂ Commercial.
 * Selected value stored as licenseType for future LicenseRegistry.mintLicense() (Phase 2).
 */
export function LicenseTypeSelector({
  selected,
  onSelect,
  personalPriceUsd,
  remixPriceUsd,
  commercialPriceUsd,
  availability,
}: LicenseTypeSelectorProps) {
  const priceMap: Record<LicenseType, number> = {
    personal: personalPriceUsd,
    remix: remixPriceUsd,
    commercial: commercialPriceUsd,
  };

  return (
    <div className="license-selector">
      <span className="license-selector__label">License Type</span>
      {LICENSE_OPTIONS.map((opt) => {
        const optionAvailability = availability?.[opt.type];
        const disabled = optionAvailability?.enabled === false;
        return (
        <label
          key={opt.type}
          className={`license-option ${selected === opt.type ? "license-option--selected" : ""}${disabled ? " license-option--disabled" : ""}`}
          title={optionAvailability?.reason}
          onClick={() => {
            if (!disabled) onSelect(opt.type);
          }}
        >
          <input
            type="radio"
            name="licenseType"
            value={opt.type}
            checked={selected === opt.type}
            disabled={disabled}
            onChange={() => {
              if (!disabled) onSelect(opt.type);
            }}
          />
          <span className="license-option__radio" />
          <div className="license-option__content">
            <div className="license-option__name">{opt.label}</div>
            <div className="license-option__desc">
              {disabled ? optionAvailability?.reason ?? "No active listing for this license" : opt.desc}
            </div>
            {opt.includes && (
              <div className="license-option__includes">✓ {opt.includes}</div>
            )}
          </div>
          <div className="license-option__price">
            {formatUsd(priceMap[opt.type])}
            <small>USD</small>
          </div>
        </label>
        );
      })}
    </div>
  );
}
