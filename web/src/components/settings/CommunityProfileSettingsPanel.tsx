"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getMyCommunityProfile,
  updateMyCommunityProfile,
  type CommunityProfileResponse,
  type CommunityProfileVisibility,
  type CommunityVisibilitySettings,
} from "../../lib/api";
import { recordProductAnalytics } from "../../lib/productAnalytics";
import { Button } from "../ui/Button";

type ToastFn = (toast: { type: "success" | "error" | "info" | "warning"; title: string; message: string }) => void;

type Props = {
  token: string | null | undefined;
  addToast: ToastFn;
};

const VISIBILITY_OPTIONS: { value: CommunityProfileVisibility; label: string; description: string }[] = [
  { value: "private", label: "Private", description: "Only you can manage the profile." },
  { value: "community", label: "Community", description: "Prepared for future in-network visibility." },
  { value: "followers", label: "Followers", description: "Prepared for future follower-scoped visibility." },
  { value: "public", label: "Public", description: "Anyone with the profile route can view enabled sections." },
];

const SHOWCASE_TOGGLES: {
  key: keyof CommunityVisibilitySettings;
  label: string;
  description: string;
}[] = [
  {
    key: "showTasteBadges",
    label: "Taste badges",
    description: "Allow future badges from governed taste summaries to appear.",
  },
  {
    key: "showOwnedItems",
    label: "Owned marketplace items",
    description: "Show selected ownership-based profile items without changing benefit eligibility.",
  },
  {
    key: "showCampaignSupport",
    label: "Campaign support",
    description: "Allow future campaign support proofs to appear on your profile.",
  },
  {
    key: "showShowAttendance",
    label: "Show attendance",
    description: "Allow future attendance proofs and city show moments to appear.",
  },
  {
    key: "showPlaylists",
    label: "Playlists",
    description: "Allow public playlist showcase sections when playlist profiles mature.",
  },
  {
    key: "showWalletAddress",
    label: "Wallet address",
    description: "Expose your wallet address on public profile reads.",
  },
  {
    key: "allowTasteMatching",
    label: "Community taste matching",
    description: "Allow future community matching to use governed taste summaries.",
  },
  {
    key: "allowCityScenes",
    label: "City and scene community",
    description: "Allow future scene matching to use declared coarse city or scene preferences.",
  },
];

export default function CommunityProfileSettingsPanel({ token, addToast }: Props) {
  const [profileState, setProfileState] = useState<CommunityProfileResponse | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await getMyCommunityProfile(token);
      setProfileState(response);
      setDisplayName(response.profile.displayName);
      setBio(response.profile.bio ?? "");
      setAvatarUrl(response.profile.avatarUrl ?? "");
    } catch {
      addToast({
        type: "error",
        title: "Community profile unavailable",
        message: "Could not load your community profile controls.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- token changes are the reload boundary.
  }, [token]);

  const saveProfile = async () => {
    if (!token || !profileState || !displayName.trim()) return;
    setSavingKey("profile");
    try {
      const response = await updateMyCommunityProfile(token, {
        displayName,
        bio: bio || null,
        avatarUrl: avatarUrl || null,
      });
      setProfileState(response);
      void recordProductAnalytics(token, "community.profile_updated", {
        source: "settings",
        subjectType: "community_profile",
        payload: { hasBio: Boolean(bio.trim()), hasAvatarUrl: Boolean(avatarUrl.trim()) },
      });
      addToast({ type: "success", title: "Community profile saved", message: "Your profile foundation is up to date." });
    } catch {
      addToast({ type: "error", title: "Profile not saved", message: "Check the fields and try again." });
    } finally {
      setSavingKey(null);
    }
  };

  const updateVisibility = async (profileVisibility: CommunityProfileVisibility) => {
    if (!token || !profileState) return;
    const previous = profileState;
    setSavingKey("profileVisibility");
    setProfileState({
      ...profileState,
      profile: { ...profileState.profile, profileVisibility },
    });
    try {
      const response = await updateMyCommunityProfile(token, { profileVisibility });
      setProfileState(response);
      void recordProductAnalytics(token, "community.profile_visibility_updated", {
        source: "settings",
        subjectType: "community_profile",
        payload: { profileVisibility },
      });
    } catch {
      setProfileState(previous);
      addToast({ type: "error", title: "Visibility not saved", message: "Please try again." });
    } finally {
      setSavingKey(null);
    }
  };

  const updateShowcase = async (key: keyof CommunityVisibilitySettings, value: boolean) => {
    if (!token || !profileState) return;
    const previous = profileState;
    setSavingKey(key);
    setProfileState({
      ...profileState,
      visibility: { ...profileState.visibility, [key]: value },
    });
    try {
      const response = await updateMyCommunityProfile(token, {
        visibility: { [key]: value },
      });
      setProfileState(response);
      void recordProductAnalytics(token, "community.profile_showcase_updated", {
        source: "settings",
        subjectType: "community_profile",
        payload: { setting: key, enabled: value },
      });
    } catch {
      setProfileState(previous);
      addToast({ type: "error", title: "Showcase setting not saved", message: "Please try again." });
    } finally {
      setSavingKey(null);
    }
  };

  const selectedVisibility = profileState?.profile.profileVisibility ?? "private";
  const publicProfileHref = profileState
    ? `/community/profile/${encodeURIComponent(profileState.profile.userId)}`
    : null;

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <div>
          <h3 className="settings-section-title">Community Profile</h3>
          <p className="home-subtitle">
            Shape what future listener, holder, and artist community surfaces may show about you.
          </p>
        </div>
        <Button variant="ghost" onClick={load} disabled={loading || !token}>
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      <div className="community-profile-form">
        <label className="taste-memory-field">
          <span>Display name</span>
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={80}
            placeholder="Community display name"
          />
        </label>
        <label className="taste-memory-field">
          <span>Bio</span>
          <textarea
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            maxLength={280}
            placeholder="A short listener, collector, or curator note"
          />
        </label>
        <label className="taste-memory-field">
          <span>Avatar URL</span>
          <input
            value={avatarUrl}
            onChange={(event) => setAvatarUrl(event.target.value)}
            maxLength={500}
            placeholder="https://..."
          />
        </label>
        <div className="settings-source-actions">
          <Button onClick={saveProfile} disabled={!displayName.trim() || savingKey === "profile" || !profileState}>
            Save profile
          </Button>
          {selectedVisibility === "public" && publicProfileHref ? (
            <Link href={publicProfileHref} className="community-profile-public-link">
              View public profile
            </Link>
          ) : null}
        </div>
      </div>

      <div className="community-visibility-options">
        {VISIBILITY_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`community-visibility-option ${selectedVisibility === option.value ? "active" : ""}`}
            disabled={!profileState || savingKey === "profileVisibility"}
            onClick={() => updateVisibility(option.value)}
          >
            <strong>{option.label}</strong>
            <span>{option.description}</span>
          </button>
        ))}
      </div>

      <div className="taste-memory-controls">
        {SHOWCASE_TOGGLES.map((toggle) => (
          <CommunityToggle
            key={toggle.key}
            label={toggle.label}
            description={toggle.description}
            checked={profileState?.visibility[toggle.key] ?? false}
            disabled={!profileState || savingKey === toggle.key}
            onChange={(checked) => updateShowcase(toggle.key, checked)}
          />
        ))}
      </div>
    </div>
  );
}

function CommunityToggle({
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
