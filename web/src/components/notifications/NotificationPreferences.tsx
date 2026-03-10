"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../auth/AuthProvider";

interface Preferences {
  disputeFiled: boolean;
  disputeResolved: boolean;
  disputeAppealed: boolean;
  evidenceSubmitted: boolean;
}

export default function NotificationPreferences() {
  const { address } = useAuth();
  const [prefs, setPrefs] = useState<Preferences>({
    disputeFiled: true,
    disputeResolved: true,
    disputeAppealed: true,
    evidenceSubmitted: true,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fetchPrefs = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`/api/metadata/notifications/${address}/preferences`);
      if (res.ok) setPrefs(await res.json());
    } catch {
      // silent
    }
  }, [address]);

  useEffect(() => {
    fetchPrefs();
  }, [fetchPrefs]);

  const toggle = async (key: keyof Preferences) => {
    if (!address) return;
    const updated = { ...prefs, [key]: !prefs[key] };
    setPrefs(updated);
    setSaving(true);
    setSaved(false);
    try {
      await fetch(`/api/metadata/notifications/${address}/preferences`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: updated[key] }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  if (!address) return null;

  const items: { key: keyof Preferences; label: string; icon: string; description: string }[] = [
    { key: "disputeFiled", label: "Content Flagged", icon: "📣", description: "When someone flags your content" },
    { key: "disputeResolved", label: "Dispute Resolved", icon: "⚖️", description: "When a dispute you're involved in is resolved" },
    { key: "disputeAppealed", label: "Dispute Appealed", icon: "🔄", description: "When a decision is appealed" },
    { key: "evidenceSubmitted", label: "New Evidence", icon: "📎", description: "When evidence is submitted to a dispute" },
  ];

  return (
    <div style={{ maxWidth: "500px" }}>
      <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "16px" }}>
        🔔 Notification Preferences
      </h3>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {items.map(({ key, label, icon, description }) => (
          <div key={key} style={rowStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1 }}>
              <span style={{ fontSize: "16px" }}>{icon}</span>
              <div>
                <div style={{ fontWeight: 500, fontSize: "13px" }}>{label}</div>
                <div style={{ fontSize: "11px", opacity: 0.4 }}>{description}</div>
              </div>
            </div>
            <button
              onClick={() => toggle(key)}
              disabled={saving}
              style={{
                ...toggleStyle,
                background: prefs[key] ? "#6366f1" : "rgba(255,255,255,0.1)",
              }}
            >
              <span
                style={{
                  ...toggleKnobStyle,
                  transform: prefs[key] ? "translateX(18px)" : "translateX(0)",
                }}
              />
            </button>
          </div>
        ))}
      </div>

      {saved && (
        <div style={{ fontSize: "12px", color: "#10b981", marginTop: "10px", textAlign: "right" }}>
          ✓ Saved
        </div>
      )}
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 14px",
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "10px",
};

const toggleStyle: React.CSSProperties = {
  width: "40px",
  height: "22px",
  borderRadius: "11px",
  border: "none",
  cursor: "pointer",
  position: "relative",
  transition: "background 0.2s",
  flexShrink: 0,
};

const toggleKnobStyle: React.CSSProperties = {
  position: "absolute",
  top: "2px",
  left: "2px",
  width: "18px",
  height: "18px",
  borderRadius: "50%",
  background: "#fff",
  transition: "transform 0.2s",
};
