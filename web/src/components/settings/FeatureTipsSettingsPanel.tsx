"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "../ui/Button";
import {
    FEATURE_TIPS_UNAVAILABLE,
    getFeatureTipsSnapshot,
    parseFeatureTipsState,
    resetFeatureTips,
    setFeatureTipsOff,
    subscribeFeatureTips,
} from "../../lib/featureTips";

/** Before hydration nothing has been read yet. */
const NOT_READ = "not-read";

/**
 * Settings › Help & tips: turn the occasional feature tips off or on, and bring back the ones
 * already shown. The choice lives in this browser only.
 */
export default function FeatureTipsSettingsPanel() {
    const raw = useSyncExternalStore(subscribeFeatureTips, getFeatureTipsSnapshot, () => NOT_READ);
    const [message, setMessage] = useState("");
    const loaded = raw !== NOT_READ;
    const unavailable = raw === FEATURE_TIPS_UNAVAILABLE;
    const state = loaded && !unavailable ? parseFeatureTipsState(raw) : null;

    return (
        <div className="settings-source">
            <label className="settings-toggle">
                <input
                    type="checkbox"
                    checked={state ? !state.off : false}
                    disabled={!state}
                    onChange={(event) => {
                        const nextOff = !event.target.checked;
                        if (setFeatureTipsOff(nextOff)) setMessage(nextOff ? "Tips are off." : "Tips are on.");
                    }}
                />
                <span>
                    <strong>Show feature tips</strong>
                    <small>
                        Now and then, a small tip points out something that is easy to miss, right where you
                        can use it. Each tip appears once, and never more than one a day.
                    </small>
                </span>
            </label>
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <Button
                    variant="ghost"
                    disabled={!state || (state.seen.length === 0 && !state.off)}
                    onClick={() => {
                        if (resetFeatureTips()) setMessage("Tips you have seen can appear again, one a day.");
                    }}
                >
                    Show tips again
                </Button>
                <span className="settings-copy" role="status">
                    {unavailable ? "This browser is not keeping site data, so tips stay hidden." : message}
                </span>
            </div>
        </div>
    );
}
