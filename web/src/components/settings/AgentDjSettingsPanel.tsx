"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { useAgentConfig } from "../../hooks/useAgentConfig";
import { useToast } from "../ui/Toast";
import { recordProductAnalytics } from "../../lib/productAnalytics";
import { useAuth } from "../auth/AuthProvider";
import AgentSetupWizard from "../agent/AgentSetupWizard";
import { PRESET_VIBES } from "../agent/AgentTasteCard";
import type { AgentConfig } from "../../lib/api";

const MAX_NAME_LENGTH = 40;

type ToastFn = (toast: { type: "success" | "error" | "info" | "warning"; title: string; message: string }) => void;

/** True when the draft differs from the stored DJ and is valid to save. */
export function canSaveDjPreferences(
    config: Pick<AgentConfig, "name" | "vibes"> | null,
    draft: { name: string; vibes: string[] },
): boolean {
    if (!config) return false;
    const name = draft.name.trim();
    if (name.length === 0 || draft.vibes.length === 0) return false;
    return (
        name !== config.name ||
        draft.vibes.length !== config.vibes.length ||
        draft.vibes.some((vibe) => !config.vibes.includes(vibe))
    );
}

/** Persist the DJ's name and vibes, toasting the outcome. Resolves true on success. */
export async function saveDjPreferences(args: {
    draft: { name: string; vibes: string[] };
    updateConfig: (input: { name?: string; vibes?: string[] }) => Promise<unknown>;
    addToast: ToastFn;
}): Promise<boolean> {
    try {
        await args.updateConfig({ name: args.draft.name.trim(), vibes: args.draft.vibes });
        args.addToast({ type: "success", title: "DJ Updated", message: "Your DJ's name and vibes have been saved." });
        return true;
    } catch (error) {
        args.addToast({
            type: "error",
            title: "Could not save",
            message: error instanceof Error ? error.message : "Unable to update your DJ.",
        });
        return false;
    }
}

/**
 * Settings → AI DJ: the DJ's name and the vibes its sessions start from.
 * Starting, stopping and following sessions lives in the Home `#ai-dj`
 * section; this panel only holds preferences.
 */
export default function AgentDjSettingsPanel() {
    const { token } = useAuth();
    const { config, isLoading, createConfig, updateConfig } = useAgentConfig();
    const { addToast } = useToast();
    const [wizardOpen, setWizardOpen] = useState(false);
    const [name, setName] = useState("");
    const [vibes, setVibes] = useState<string[]>([]);
    const [customInput, setCustomInput] = useState("");
    const [saving, setSaving] = useState(false);

    // Seed the form whenever the stored config changes (initial load, save).
    const savedName = config?.name;
    const savedVibes = config?.vibes;
    useEffect(() => {
        if (savedName === undefined || savedVibes === undefined) return;
        setName(savedName);
        setVibes([...savedVibes]);
    }, [savedName, savedVibes]);

    const handleWizardComplete = async (data: { name: string; vibes: string[]; monthlyCapUsd: number }) => {
        await createConfig(data);
        setWizardOpen(false);
        void recordProductAnalytics(token, "onboarding.completed", {
            source: "agent_setup",
            subjectType: "agent_config",
            payload: {
                flow: "agent",
                surface: "settings",
                vibeCount: data.vibes.length,
                walletEnabled: false,
                monthlyCapUsd: data.monthlyCapUsd,
            },
        });
        addToast({ type: "success", title: "DJ Activated", message: `${data.name} is ready to curate!` });
    };

    const toggleVibe = (vibe: string) => {
        setVibes((prev) => (prev.includes(vibe) ? prev.filter((v) => v !== vibe) : [...prev, vibe]));
    };

    const addCustomGenre = () => {
        const genre = customInput.trim();
        if (genre && !vibes.includes(genre)) {
            setVibes((prev) => [...prev, genre]);
        }
        setCustomInput("");
    };

    const handleCustomKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            addCustomGenre();
        }
    };

    const canSave = canSaveDjPreferences(config, { name, vibes }) && !saving;

    const handleSave = async () => {
        if (!canSave) return;
        setSaving(true);
        try {
            await saveDjPreferences({ draft: { name, vibes }, updateConfig, addToast });
        } finally {
            setSaving(false);
        }
    };

    const customVibes = vibes.filter((v) => !PRESET_VIBES.includes(v));

    return (
        <div className="settings-section" data-testid="agent-dj-settings">
            <div className="settings-section-header">
                <div>
                    <span className="settings-kicker">Listening sessions</span>
                    <h2 className="settings-section-title">AI DJ</h2>
                    <p className="settings-copy">
                        Your DJ&apos;s name and the vibes it starts from. Start and follow sessions from the AI DJ
                        section on Home.
                    </p>
                </div>
            </div>

            {isLoading && !config ? (
                <p className="settings-copy">Loading your DJ…</p>
            ) : !config ? (
                <div className="aid-empty">
                    <div className="aid-empty-icon">🤖</div>
                    <h2>No DJ yet</h2>
                    <p>Name your DJ and pick the vibes it should start from. You can change them any time here.</p>
                    <button type="button" className="aid-primary-btn" onClick={() => setWizardOpen(true)}>
                        Set up your DJ
                    </button>
                </div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <span className="aid-taste-lbl">DJ name</span>
                        <input
                            className="aid-custom-input"
                            type="text"
                            aria-label="DJ name"
                            maxLength={MAX_NAME_LENGTH}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </label>

                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <span className="aid-taste-lbl">Vibes</span>
                        <div className="aid-vibes-grid">
                            {PRESET_VIBES.map((vibe) => (
                                <button
                                    key={vibe}
                                    type="button"
                                    className={`aid-vibe-chip ${vibes.includes(vibe) ? "aid-vibe-chip--active" : ""}`}
                                    aria-pressed={vibes.includes(vibe)}
                                    onClick={() => toggleVibe(vibe)}
                                >
                                    {vibe}
                                </button>
                            ))}
                            {customVibes.map((vibe) => (
                                <button
                                    key={vibe}
                                    type="button"
                                    className="aid-vibe-chip aid-vibe-chip--active aid-vibe-chip--custom"
                                    aria-pressed
                                    onClick={() => toggleVibe(vibe)}
                                    title="Click to remove"
                                >
                                    {vibe} &times;
                                </button>
                            ))}
                        </div>
                        <div className="aid-custom-row">
                            <input
                                className="aid-custom-input"
                                type="text"
                                aria-label="Add custom genre"
                                placeholder="Add custom genre..."
                                value={customInput}
                                onChange={(e) => setCustomInput(e.target.value)}
                                onKeyDown={handleCustomKeyDown}
                            />
                            <button type="button" className="aid-ghost-btn" onClick={addCustomGenre} disabled={!customInput.trim()}>
                                + Add
                            </button>
                        </div>
                    </div>

                    <div className="aid-edit-actions">
                        <button type="button" className="aid-primary-btn" onClick={handleSave} disabled={!canSave}>
                            {saving ? "Saving..." : "Save changes"}
                        </button>
                    </div>
                </div>
            )}

            {wizardOpen && <AgentSetupWizard onComplete={handleWizardComplete} onClose={() => setWizardOpen(false)} />}
        </div>
    );
}
