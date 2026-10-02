import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "../../lib/api";

const hookState = { config: null as AgentConfig | null, isLoading: false };
const updateConfig = vi.fn(async () => undefined);
const createConfig = vi.fn(async () => undefined);
const addToast = vi.fn();

vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ token: "tok" }) }));
vi.mock("../ui/Toast", () => ({ useToast: () => ({ addToast }) }));
vi.mock("../../lib/productAnalytics", () => ({ recordProductAnalytics: vi.fn(async () => undefined) }));
vi.mock("../../hooks/useAgentConfig", () => ({
  useAgentConfig: () => ({
    config: hookState.config,
    isLoading: hookState.isLoading,
    createConfig,
    updateConfig,
  }),
}));
vi.mock("../agent/AgentSetupWizard", () => ({ default: () => null }));

import AgentDjSettingsPanel, { canSaveDjPreferences, saveDjPreferences } from "./AgentDjSettingsPanel";

function config(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return { id: "agent-1", name: "Night DJ", vibes: ["Focus", "Jazz"], isActive: false, ...overrides } as unknown as AgentConfig;
}

describe("AgentDjSettingsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookState.config = null;
    hookState.isLoading = false;
  });

  it("explains the DJ and offers setup when there is no config", () => {
    const html = renderToStaticMarkup(<AgentDjSettingsPanel />);
    expect(html).toContain("AI DJ");
    expect(html).toContain("Set up your DJ");
    expect(html).not.toContain("Save changes");
  });

  it("renders the name field and vibe chips for an existing DJ", () => {
    hookState.config = config({ vibes: ["Focus", "Underwater Funk"] });
    const html = renderToStaticMarkup(<AgentDjSettingsPanel />);
    expect(html).toContain('aria-label="DJ name"');
    expect(html).toContain("Deep House");
    expect(html).toContain("Save changes");
    // Nothing changed yet, so save is disabled.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save changes<\/button>/);
    // Identity / reputation controls stay out of Settings (ADR-TE-6).
    expect(html).not.toContain("Portable Identity");
  });

  it("only allows saving a valid, changed name or vibe set", () => {
    const stored = { name: "Night DJ", vibes: ["Focus", "Jazz"] };
    expect(canSaveDjPreferences(null, stored)).toBe(false);
    expect(canSaveDjPreferences(stored, { name: "Night DJ", vibes: ["Jazz", "Focus"] })).toBe(false);
    expect(canSaveDjPreferences(stored, { name: "  ", vibes: ["Focus"] })).toBe(false);
    expect(canSaveDjPreferences(stored, { name: "Night DJ", vibes: [] })).toBe(false);
    expect(canSaveDjPreferences(stored, { name: "Day DJ", vibes: ["Focus", "Jazz"] })).toBe(true);
    expect(canSaveDjPreferences(stored, { name: "Night DJ", vibes: ["Focus", "Lo-fi"] })).toBe(true);
  });

  it("save calls updateConfig with the trimmed name and vibes, then toasts success", async () => {
    await expect(
      saveDjPreferences({ draft: { name: " Day DJ ", vibes: ["Lo-fi"] }, updateConfig, addToast }),
    ).resolves.toBe(true);
    expect(updateConfig).toHaveBeenCalledWith({ name: "Day DJ", vibes: ["Lo-fi"] });
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "DJ Updated" }));
  });

  it("toasts an error and resolves false when the update fails", async () => {
    updateConfig.mockRejectedValueOnce(new Error("boom"));
    await expect(
      saveDjPreferences({ draft: { name: "Day DJ", vibes: ["Lo-fi"] }, updateConfig, addToast }),
    ).resolves.toBe(false);
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: "error", message: "boom" }));
  });
});
