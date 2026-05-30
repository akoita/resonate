"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getTasteMemory,
  removeTasteSignalControl,
  resetTasteMemory,
  updateTasteMemorySettings,
  upsertTasteSignalControl,
  type TasteMemoryResponse,
  type TasteMemorySettings,
  type TasteSignalControl,
} from "../../lib/api";
import { recordProductAnalytics } from "../../lib/productAnalytics";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";

type ToastFn = (toast: { type: "success" | "error" | "info" | "warning"; title: string; message: string }) => void;

type Props = {
  token: string | null | undefined;
  addToast: ToastFn;
};

const SIGNAL_TYPES: TasteSignalControl["signalType"][] = ["genre", "mood", "artist", "scene", "intent"];

export default function TasteMemorySettingsPanel({ token, addToast }: Props) {
  const [memory, setMemory] = useState<TasteMemoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [newSignalType, setNewSignalType] = useState<TasteSignalControl["signalType"]>("genre");
  const [newSignalValue, setNewSignalValue] = useState("");
  const [newSignalAction, setNewSignalAction] = useState<TasteSignalControl["action"]>("hidden");
  const [confirmReset, setConfirmReset] = useState(false);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      setMemory(await getTasteMemory(token));
    } catch {
      addToast({
        type: "error",
        title: "Taste memory unavailable",
        message: "Could not load your taste memory controls.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- token changes are the reload boundary.
  }, [token]);

  const summaryItems = useMemo(() => {
    const summary = memory?.summary;
    if (!summary) return [];
    return [
      { label: "Genres", values: summary.favoredGenres },
      { label: "Moods", values: summary.favoredMoods },
      { label: "Artists", values: summary.favoredArtists },
      { label: "Recent intents", values: summary.recentIntents },
      { label: "Novelty", values: [summary.noveltyPattern] },
      { label: "Commerce", values: [summary.commercePreference] },
    ];
  }, [memory]);

  const updateSetting = async <K extends keyof Omit<TasteMemorySettings, "resetAt">>(
    key: K,
    value: TasteMemorySettings[K],
  ) => {
    if (!token || !memory) return;
    setSavingKey(key);
    const previous = memory;
    setMemory({ ...memory, settings: { ...memory.settings, [key]: value } });
    try {
      const settings = await updateTasteMemorySettings(token, { [key]: value });
      setMemory({ ...previous, settings });
      void recordProductAnalytics(token, "taste_memory.settings_updated", {
        source: "settings",
        subjectType: "taste_memory",
        payload: { setting: key, enabled: typeof value === "boolean" ? value : undefined },
      });
    } catch {
      setMemory(previous);
      addToast({ type: "error", title: "Setting not saved", message: "Please try again." });
    } finally {
      setSavingKey(null);
    }
  };

  const addControl = async () => {
    if (!token || !newSignalValue.trim()) return;
    setSavingKey("signal");
    try {
      const control = await upsertTasteSignalControl(token, {
        signalType: newSignalType,
        value: newSignalValue,
        action: newSignalAction,
        source: "settings",
      });
      setMemory((current) =>
        current
          ? {
              ...current,
              controls: [control, ...current.controls.filter((entry) => entry.id !== control.id)],
            }
          : current,
      );
      setNewSignalValue("");
      void recordProductAnalytics(token, "taste_memory.signal_hidden", {
        source: "settings",
        subjectType: "taste_signal",
        payload: { signalType: control.signalType, action: control.action },
      });
      addToast({ type: "success", title: "Taste signal updated", message: "Recommendations will respect this." });
    } catch {
      addToast({ type: "error", title: "Signal not saved", message: "Check the value and try again." });
    } finally {
      setSavingKey(null);
    }
  };

  const restoreControl = async (control: TasteSignalControl) => {
    if (!token) return;
    setSavingKey(control.id);
    try {
      await removeTasteSignalControl(token, control.id);
      setMemory((current) =>
        current
          ? { ...current, controls: current.controls.filter((entry) => entry.id !== control.id) }
          : current,
      );
      void recordProductAnalytics(token, "taste_memory.signal_restored", {
        source: "settings",
        subjectType: "taste_signal",
        payload: { signalType: control.signalType, action: control.action },
      });
    } catch {
      addToast({ type: "error", title: "Signal not restored", message: "Please try again." });
    } finally {
      setSavingKey(null);
    }
  };

  const confirmResetMemory = async () => {
    if (!token || !memory) return;
    setSavingKey("reset");
    try {
      const settings = await resetTasteMemory(token);
      setMemory({
        ...memory,
        settings,
        summary: {
          ...memory.summary,
          favoredGenres: [],
          favoredMoods: [],
          favoredArtists: [],
          recentIntents: [],
          noveltyPattern: "Balanced discovery",
          commercePreference: "Listening first",
        },
      });
      void recordProductAnalytics(token, "taste_memory.reset", {
        source: "settings",
        subjectType: "taste_memory",
        payload: { reset: true },
      });
      addToast({ type: "success", title: "Taste memory reset", message: "New signals will build from here." });
    } catch {
      addToast({ type: "error", title: "Reset failed", message: "Please try again." });
    } finally {
      setSavingKey(null);
      setConfirmReset(false);
    }
  };

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <div>
          <h3 className="settings-section-title">Taste Memory</h3>
          <p className="home-subtitle">
            Inspect and govern the safe taste signals used for recommendations and AI DJ behavior.
          </p>
        </div>
        <Button variant="ghost" onClick={load} disabled={loading || !token}>
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      <div className="taste-memory-grid">
        {summaryItems.map((item) => (
          <div className="taste-memory-stat" key={item.label}>
            <span>{item.label}</span>
            <strong>{item.values.length ? item.values.join(", ") : "Not enough signal yet"}</strong>
          </div>
        ))}
      </div>

      <div className="taste-memory-controls">
        <TasteToggle
          label="Taste-based social matching"
          description="Allow future community matching to use governed taste summaries."
          checked={memory?.settings.socialMatchingEnabled ?? false}
          disabled={!memory || savingKey === "socialMatchingEnabled"}
          onChange={(checked) => updateSetting("socialMatchingEnabled", checked)}
        />
        <TasteToggle
          label="City and scene discovery"
          description="Allow recommendations to lean on city or scene discovery when those features mature."
          checked={memory?.settings.citySceneDiscoveryEnabled ?? false}
          disabled={!memory || savingKey === "citySceneDiscoveryEnabled"}
          onChange={(checked) => updateSetting("citySceneDiscoveryEnabled", checked)}
        />
        <TasteToggle
          label="AI DJ playback trains taste"
          description="Let AI DJ-originated playback update your listener taste memory."
          checked={memory?.settings.agentPlaybackTrainingEnabled ?? true}
          disabled={!memory || savingKey === "agentPlaybackTrainingEnabled"}
          onChange={(checked) => updateSetting("agentPlaybackTrainingEnabled", checked)}
        />
      </div>

      <div className="taste-memory-row">
        <label className="taste-memory-field">
          <span>Recommendation explanations</span>
          <select
            value={memory?.settings.recommendationExplanationPreference ?? "balanced"}
            disabled={!memory || savingKey === "recommendationExplanationPreference"}
            onChange={(event) =>
              updateSetting("recommendationExplanationPreference", event.target.value as TasteMemorySettings["recommendationExplanationPreference"])
            }
          >
            <option value="compact">Compact</option>
            <option value="balanced">Balanced</option>
            <option value="detailed">Detailed</option>
          </select>
        </label>
      </div>

      <div className="taste-memory-editor">
        <div className="taste-memory-editor-inputs">
          <select value={newSignalType} onChange={(event) => setNewSignalType(event.target.value as typeof newSignalType)}>
            {SIGNAL_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <select value={newSignalAction} onChange={(event) => setNewSignalAction(event.target.value as typeof newSignalAction)}>
            <option value="hidden">Hide</option>
            <option value="downranked">Downrank</option>
          </select>
          <input
            value={newSignalValue}
            onChange={(event) => setNewSignalValue(event.target.value)}
            placeholder="Signal value, e.g. Techno"
          />
          <Button onClick={addControl} disabled={!newSignalValue.trim() || savingKey === "signal"}>
            Add
          </Button>
        </div>

        {memory?.controls.length ? (
          <ul className="taste-memory-signal-list">
            {memory.controls.map((control) => (
              <li key={control.id}>
                <div>
                  <strong>{control.value}</strong>
                  <span>{control.action} {control.signalType}</span>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => restoreControl(control)}
                  disabled={savingKey === control.id}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="taste-memory-empty">No hidden or downranked signals.</div>
        )}
      </div>

      <div className="taste-memory-danger">
        <div>
          <strong>Reset taste memory</strong>
          <p>Keep the audit trail, but stop using older signals for recommendations and AI DJ learning.</p>
        </div>
        <Button variant="ghost" onClick={() => setConfirmReset(true)} disabled={!memory || savingKey === "reset"}>
          Reset
        </Button>
      </div>

      <ConfirmDialog
        isOpen={confirmReset}
        title="Reset taste memory?"
        message="Recommendations and AI DJ learning will ignore older taste signals. New listening choices can train a fresh profile."
        confirmLabel="Reset"
        variant="warning"
        onConfirm={confirmResetMemory}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}

function TasteToggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="taste-memory-toggle">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </label>
  );
}
