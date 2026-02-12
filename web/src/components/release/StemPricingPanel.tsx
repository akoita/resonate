"use client";

import React, { useState, useEffect, useCallback } from "react";
import { PricingTemplates, PricingTemplate } from "./PricingTemplates";
import { PayoutSplitPreview } from "./PayoutSplitPreview";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../ui/Toast";
import "../../styles/stem-pricing.css";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

interface StemForPricing {
  id: string;
  type: string;
}

interface TrackWithStems {
  trackId: string;
  trackTitle: string;
  stems: StemForPricing[];
}

interface StemPricingState {
  basePlayPriceUsd: number;
  remixLicenseUsd: number;
  commercialLicenseUsd: number;
  floorUsd: number;
  ceilingUsd: number;
  listingDurationDays: number | null;
}

const STEM_EMOJI: Record<string, string> = {
  vocals: "🎤",
  drums: "🥁",
  bass: "🎸",
  piano: "🎹",
  guitar: "🎸",
  other: "🎵",
};

const DURATION_OPTIONS = [
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
  { label: "Permanent", value: 0 },
];

const DEFAULT_PRICING: StemPricingState = {
  basePlayPriceUsd: 0.05,
  remixLicenseUsd: 5.0,
  commercialLicenseUsd: 25.0,
  floorUsd: 0.01,
  ceilingUsd: 50.0,
  listingDurationDays: null,
};

interface StemPricingPanelProps {
  releaseId: string;
  tracks: TrackWithStems[];
}

export function StemPricingPanel({ releaseId, tracks }: StemPricingPanelProps) {
  const { token } = useAuth();
  const { addToast } = useToast();

  const [templates, setTemplates] = useState<PricingTemplate[]>([]);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [stemPricing, setStemPricing] = useState<Record<string, StemPricingState>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [expandedTracks, setExpandedTracks] = useState<Set<string>>(() =>
    new Set(tracks.length === 1 ? [tracks[0].trackId] : [])
  );

  const allStems = tracks.flatMap((t) => t.stems);

  // Fetch templates
  useEffect(() => {
    fetch(`${API_BASE}/api/stem-pricing/templates`)
      .then((r) => r.json())
      .then(setTemplates)
      .catch(console.error);
  }, []);

  // Fetch per-stem pricing
  useEffect(() => {
    const fetchAll = async () => {
      const result: Record<string, StemPricingState> = {};
      for (const stem of allStems) {
        try {
          const r = await fetch(`${API_BASE}/api/stem-pricing/${stem.id}`);
          const data = await r.json();
          result[stem.id] = {
            basePlayPriceUsd: data.basePlayPriceUsd ?? DEFAULT_PRICING.basePlayPriceUsd,
            remixLicenseUsd: data.remixLicenseUsd ?? DEFAULT_PRICING.remixLicenseUsd,
            commercialLicenseUsd: data.commercialLicenseUsd ?? DEFAULT_PRICING.commercialLicenseUsd,
            floorUsd: data.floorUsd ?? DEFAULT_PRICING.floorUsd,
            ceilingUsd: data.ceilingUsd ?? DEFAULT_PRICING.ceilingUsd,
            listingDurationDays: data.listingDurationDays ?? null,
          };
        } catch {
          result[stem.id] = { ...DEFAULT_PRICING };
        }
      }
      setStemPricing(result);
    };
    if (allStems.length > 0) fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks]);

  const updateStem = useCallback(
    (stemId: string, patch: Partial<StemPricingState>) => {
      setStemPricing((prev) => ({
        ...prev,
        [stemId]: { ...(prev[stemId] || DEFAULT_PRICING), ...patch },
      }));
      setDirty(true);
      setActiveTemplateId(null);
    },
    [],
  );

  // Apply template to a specific track's stems
  const applyTemplateToTrack = useCallback(
    (template: PricingTemplate, trackStems: StemForPricing[]) => {
      setStemPricing((prev) => {
        const next = { ...prev };
        for (const stem of trackStems) {
          next[stem.id] = {
            ...(next[stem.id] || DEFAULT_PRICING),
            ...template.pricing,
          };
        }
        return next;
      });
      setDirty(true);
    },
    [],
  );

  // Apply template to ALL tracks
  const applyTemplate = useCallback(
    (template: PricingTemplate) => {
      setActiveTemplateId(template.id);
      setStemPricing((prev) => {
        const next = { ...prev };
        for (const stem of allStems) {
          next[stem.id] = {
            ...(next[stem.id] || DEFAULT_PRICING),
            ...template.pricing,
          };
        }
        return next;
      });
      setDirty(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tracks],
  );

  const saveAll = useCallback(async () => {
    if (!token) return;
    setSaving(true);
    try {
      // Build per-stem pricing map
      const pricingMap: Record<string, StemPricingState> = {};
      for (const stem of allStems) {
        pricingMap[stem.id] = stemPricing[stem.id] || DEFAULT_PRICING;
      }

      // Try batch-upsert first, fall back to per-stem PUT
      let success = false;
      try {
        const res = await fetch(`${API_BASE}/api/stem-pricing/batch-upsert`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ releaseId, pricingMap }),
        });
        if (res.ok) {
          success = true;
          const data = await res.json();
          addToast({
            type: "success",
            title: "Pricing Saved",
            message: `Updated pricing for ${data.updated} stems`,
          });
        }
      } catch {
        // batch-upsert not available, fall through
      }

      if (!success) {
        // Fallback: individual per-stem PUT calls
        const results = await Promise.all(
          Object.entries(pricingMap).map(([stemId, dto]) =>
            fetch(`${API_BASE}/api/stem-pricing/${stemId}`, {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify(dto),
            }),
          ),
        );
        const allOk = results.every((r) => r.ok);
        if (!allOk) throw new Error("Some stems failed to save");
        addToast({
          type: "success",
          title: "Pricing Saved",
          message: `Updated pricing for ${results.length} stems`,
        });
      }

      setDirty(false);
    } catch (err) {
      console.error(err);
      addToast({
        type: "error",
        title: "Save Failed",
        message: "Could not save pricing. Please try again.",
      });
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, stemPricing, tracks, releaseId, addToast]);

  const toggleTrack = useCallback((trackId: string) => {
    setExpandedTracks((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) {
        next.delete(trackId);
      } else {
        next.add(trackId);
      }
      return next;
    });
  }, []);

  // Use the first stem's pricing for global preview
  const previewPricing = stemPricing[allStems[0]?.id] || DEFAULT_PRICING;

  return (
    <section className="stem-pricing-section glass-panel">
      <div className="stem-pricing-header">
        <div>
          <h3>💰 Stem Pricing &amp; Licensing</h3>
          <p>Set per-play pricing and one-time license fees for remix &amp; commercial use</p>
        </div>
      </div>

      {/* Quick Templates — applies to ALL tracks */}
      <PricingTemplates
        templates={templates}
        activeTemplateId={activeTemplateId}
        onApply={applyTemplate}
      />

      {/* Per-track accordion */}
      <div className="stem-pricing-tracks">
        {tracks.map((track) => {
          const isExpanded = expandedTracks.has(track.trackId);

          return (
            <div
              key={track.trackId}
              className={`stem-pricing-track-group ${isExpanded ? "expanded" : ""}`}
            >
              <button
                className="stem-pricing-track-header"
                onClick={() => toggleTrack(track.trackId)}
              >
                <div className="stem-pricing-track-left">
                  <span className="stem-pricing-chevron">
                    {isExpanded ? "▼" : "▶"}
                  </span>
                  <span className="stem-pricing-track-title">
                    {track.trackTitle}
                  </span>
                </div>
                <span className="stem-pricing-track-count">
                  {track.stems.length} stems
                </span>
              </button>

              {isExpanded && (
                <div className="stem-pricing-track-body">
                  {/* Per-track template quick-apply */}
                  {tracks.length > 1 && templates.length > 0 && (
                    <div className="stem-pricing-track-templates">
                      <span className="track-template-label">Apply template:</span>
                      {templates.map((t) => (
                        <button
                          key={t.id}
                          className="track-template-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            applyTemplateToTrack(t, track.stems);
                          }}
                        >
                          {t.name}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="stem-pricing-grid">
                    {track.stems.map((stem) => {
                      const p = stemPricing[stem.id] || DEFAULT_PRICING;

                      return (
                        <div key={stem.id} className="stem-pricing-row">
                          <div className="stem-label">
                            <span className="stem-emoji">
                              {STEM_EMOJI[stem.type] || "🎵"}
                            </span>
                            <span>
                              {stem.type.charAt(0).toUpperCase() + stem.type.slice(1)}
                            </span>
                          </div>

                          <div className="pricing-control">
                            <label>Per-Play (USD)</label>
                            <input
                              type="number"
                              min={0}
                              max={5}
                              step={0.01}
                              value={p.basePlayPriceUsd}
                              onChange={(e) =>
                                updateStem(stem.id, {
                                  basePlayPriceUsd: parseFloat(e.target.value) || 0,
                                })
                              }
                            />
                            <input
                              type="range"
                              min={0}
                              max={1}
                              step={0.01}
                              value={p.basePlayPriceUsd}
                              onChange={(e) =>
                                updateStem(stem.id, {
                                  basePlayPriceUsd: parseFloat(e.target.value),
                                })
                              }
                            />
                          </div>

                          <div className="pricing-control">
                            <label>Remix License (USD)</label>
                            <input
                              type="number"
                              min={0}
                              max={500}
                              step={1}
                              value={p.remixLicenseUsd}
                              onChange={(e) =>
                                updateStem(stem.id, {
                                  remixLicenseUsd: parseFloat(e.target.value) || 0,
                                })
                              }
                            />
                          </div>

                          <div className="pricing-control">
                            <label>Commercial License (USD)</label>
                            <input
                              type="number"
                              min={0}
                              max={5000}
                              step={5}
                              value={p.commercialLicenseUsd}
                              onChange={(e) =>
                                updateStem(stem.id, {
                                  commercialLicenseUsd: parseFloat(e.target.value) || 0,
                                })
                              }
                            />
                          </div>

                          <div className="computed-prices-inline">
                            <span className="computed-price-chip personal">
                              🎧 ${p.basePlayPriceUsd.toFixed(2)}/play
                            </span>
                            <span className="computed-price-chip remix">
                              🔄 ${p.remixLicenseUsd.toFixed(0)}
                            </span>
                            <span className="computed-price-chip commercial">
                              💼 ${p.commercialLicenseUsd.toFixed(0)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Listing Duration */}
      <div className="duration-control-wrapper">
        <span className="duration-icon">⏱️</span>
        <div className="pricing-control" style={{ flex: 1, maxWidth: 260 }}>
          <label>Listing Duration</label>
          <select
            value={previewPricing.listingDurationDays ?? 0}
            onChange={(e) => {
              const val = parseInt(e.target.value);
              const days = val === 0 ? null : val;
              for (const stem of allStems) {
                updateStem(stem.id, { listingDurationDays: days });
              }
            }}
          >
            {DURATION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Payout Split Preview */}
      <PayoutSplitPreview priceUsd={previewPricing.basePlayPriceUsd} />

      {/* Save */}
      <div className="pricing-save-bar">
        <button
          className="btn-save-pricing"
          disabled={!dirty || saving}
          onClick={saveAll}
        >
          {saving ? "Saving..." : "Save Pricing"}
        </button>
      </div>
    </section>
  );
}
