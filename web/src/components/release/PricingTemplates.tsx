"use client";

import React from "react";

export interface PricingTemplate {
  id: string;
  name: string;
  description: string;
  pricing: {
    basePlayPriceUsd: number;
    remixSurchargeMultiplier: number;
    commercialMultiplier: number;
    floorUsd: number;
    ceilingUsd: number;
  };
}

interface PricingTemplatesProps {
  templates: PricingTemplate[];
  activeTemplateId: string | null;
  onApply: (template: PricingTemplate) => void;
}

export function PricingTemplates({ templates, activeTemplateId, onApply }: PricingTemplatesProps) {
  return (
    <div className="pricing-templates-row">
      {templates.map((t) => (
        <button
          key={t.id}
          className={`pricing-template-card ${activeTemplateId === t.id ? "active" : ""}`}
          onClick={() => onApply(t)}
        >
          <div className="template-name">{t.name}</div>
          <div className="template-desc">{t.description}</div>
          <div className="template-price">
            {t.pricing.basePlayPriceUsd === 0
              ? "Free"
              : `$${t.pricing.basePlayPriceUsd.toFixed(2)}`}
          </div>
        </button>
      ))}
    </div>
  );
}
