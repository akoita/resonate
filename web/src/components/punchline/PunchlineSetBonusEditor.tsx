"use client";

import React, { useState } from "react";
import {
  removePunchlineDropUnlock,
  setPunchlineDropUnlock,
  type PunchlineDrop,
  type PunchlineUnlockReward,
} from "../../lib/api";
import {
  PunchlineClipSelector,
  formatClipDuration,
  formatClipTime,
  type ClipRange,
} from "./PunchlineClipSelector";

/**
 * "Set bonus" editor inside the drop builder (#488): the artist attaches ONE
 * optional complete-set reward — a bonus vocal clip (same selector as moments)
 * plus an optional note. The clip is extracted at publish time; fans see only
 * that a bonus exists until they complete the set.
 */

const MAX_BONUS_MESSAGE_LEN = 500;

export interface PunchlineSetBonusEditorProps {
  token: string;
  drop: PunchlineDrop;
  stemId: string;
  durationSeconds: number;
  minMs: number;
  maxMs: number;
  onDropChange: (drop: PunchlineDrop) => void;
  addToast: (toast: {
    type: "success" | "error" | "info";
    title: string;
    message?: string;
  }) => void;
}

export function PunchlineSetBonusEditor({
  token,
  drop,
  stemId,
  durationSeconds,
  minMs,
  maxMs,
  onDropChange,
  addToast,
}: PunchlineSetBonusEditorProps) {
  const reward: PunchlineUnlockReward | null = drop.unlock?.reward ?? null;

  const [editing, setEditing] = useState(false);
  const [range, setRange] = useState<ClipRange>({
    startMs: reward?.startMs ?? 0,
    endMs: reward?.endMs ?? Math.min(minMs, Math.round(durationSeconds * 1000)),
  });
  const [message, setMessage] = useState(reward?.message ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEditing = () => {
    setRange({
      startMs: reward?.startMs ?? 0,
      endMs:
        reward?.endMs ?? Math.min(maxMs, Math.round(durationSeconds * 1000)),
    });
    setMessage(reward?.message ?? "");
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await setPunchlineDropUnlock(
        drop.id,
        {
          startMs: range.startMs,
          endMs: range.endMs,
          message: message.trim() || null,
        },
        token,
      );
      onDropChange({
        ...drop,
        unlock: saved
          ? { unlockType: saved.unlockType, reward: saved.reward }
          : null,
      });
      setEditing(false);
      addToast({
        type: "success",
        title: "Set bonus saved",
        message: "Fans who collect the whole set will unlock it.",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the bonus.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    setError(null);
    try {
      await removePunchlineDropUnlock(drop.id, token);
      onDropChange({ ...drop, unlock: null });
      setEditing(false);
      addToast({ type: "info", title: "Set bonus removed" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the bonus.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="punchline-bonus">
      <div className="punchline-bonus-head">
        <div>
          <h5 className="punchline-bonus-title">🎁 Set bonus (optional)</h5>
          <p className="punchline-hint">
            Reward fans who collect every moment with a bonus vocal clip and a
            note. Revealed only when they complete the set.
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            className="punchline-btn-secondary"
            onClick={startEditing}
          >
            {reward ? "Edit bonus" : "Add bonus"}
          </button>
        )}
      </div>

      {!editing && reward && (
        <div className="punchline-bonus-summary">
          <span>
            {formatClipTime(reward.startMs)} → {formatClipTime(reward.endMs)} ·{" "}
            {formatClipDuration(reward.endMs - reward.startMs)}
          </span>
          {reward.message && (
            <span className="punchline-bonus-message">“{reward.message}”</span>
          )}
        </div>
      )}

      {editing && (
        <div className="punchline-bonus-editor">
          <PunchlineClipSelector
            stemId={stemId}
            durationSeconds={durationSeconds}
            minMs={minMs}
            maxMs={maxMs}
            value={range}
            onChange={setRange}
          />
          <div className="punchline-field">
            <label htmlFor="punchline-bonus-message">
              Note to completers (optional)
              <span className="punchline-char-count">
                {message.length}/{MAX_BONUS_MESSAGE_LEN}
              </span>
            </label>
            <textarea
              id="punchline-bonus-message"
              rows={2}
              maxLength={MAX_BONUS_MESSAGE_LEN}
              value={message}
              placeholder="Say something only your realest fans will read…"
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          {error && (
            <p className="punchline-error" role="alert">
              {error}
            </p>
          )}
          <div className="punchline-bonus-actions">
            <button
              type="button"
              className="punchline-btn-primary"
              onClick={save}
              disabled={saving}
              aria-disabled={saving}
            >
              {saving ? "Saving…" : "Save bonus"}
            </button>
            <button
              type="button"
              className="punchline-btn-secondary"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              Cancel
            </button>
            {reward && (
              <button
                type="button"
                className="punchline-btn-secondary punchline-bonus-remove"
                onClick={remove}
                disabled={saving}
              >
                Remove bonus
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default PunchlineSetBonusEditor;
