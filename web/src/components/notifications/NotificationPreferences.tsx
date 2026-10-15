"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../auth/AuthProvider";
import {
  fetchNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreferenceValues,
} from "../../lib/walletNotifications";

type Preferences = NotificationPreferenceValues;

export default function NotificationPreferences() {
  const { address, status, token } = useAuth();
  const sessionToken = status === "authenticated" ? token : null;
  const [prefs, setPrefs] = useState<Preferences>({
    disputeFiled: true,
    disputeResolved: true,
    disputeAppealed: true,
    evidenceSubmitted: true,
    listingExpiringSoon: true,
    listingExpired: true,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fetchPrefs = useCallback(async () => {
    if (!address || !sessionToken) return;
    // Never throws; signed out, refused or failed keeps the defaults.
    const loaded = await fetchNotificationPreferences(address, sessionToken);
    if (loaded) setPrefs(loaded);
  }, [address, sessionToken]);

  useEffect(() => {
    fetchPrefs();
  }, [fetchPrefs]);

  const toggle = async (key: keyof Preferences) => {
    if (!address || !sessionToken) return;
    const updated = { ...prefs, [key]: !prefs[key] };
    setPrefs(updated);
    setSaving(true);
    setSaved(false);
    try {
      const ok = await updateNotificationPreferences(address, sessionToken, { [key]: updated[key] });
      if (ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  };

  if (!address || !sessionToken) return null;

  const items: { key: keyof Preferences; label: string; shortLabel: string; description: string }[] = [
    { key: "disputeFiled", label: "Content Flagged", shortLabel: "CF", description: "When someone flags your content" },
    { key: "disputeResolved", label: "Dispute Resolved", shortLabel: "DR", description: "When a dispute you're involved in is resolved" },
    { key: "disputeAppealed", label: "Dispute Appealed", shortLabel: "DA", description: "When a decision is appealed" },
    { key: "evidenceSubmitted", label: "New Evidence", shortLabel: "NE", description: "When evidence is submitted to a dispute" },
    { key: "listingExpiringSoon", label: "Listing Ending Soon", shortLabel: "LS", description: "When your marketplace listing is close to expiry" },
    { key: "listingExpired", label: "Listing Expired", shortLabel: "LE", description: "When your marketplace listing expires" },
  ];

  return (
    <div className="notification-preferences">
      <div className="notification-preferences__header">
        <h3>Notification preferences</h3>
        {saved ? <span>Saved</span> : saving ? <span>Saving</span> : null}
      </div>

      <div className="notification-preferences__list">
        {items.map(({ key, label, shortLabel, description }) => (
          <div key={key} className="notification-preference-row">
            <div className="notification-preference-row__copy">
              <span className="notification-preference-row__mark">{shortLabel}</span>
              <div>
                <strong>{label}</strong>
                <small>{description}</small>
              </div>
            </div>
            <button
              onClick={() => toggle(key)}
              disabled={saving}
              className={`notification-toggle ${prefs[key] ? "active" : ""}`}
              type="button"
              aria-label={`${prefs[key] ? "Disable" : "Enable"} ${label}`}
              aria-pressed={prefs[key]}
            >
              <span />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
