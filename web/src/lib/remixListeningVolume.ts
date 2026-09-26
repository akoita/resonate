/**
 * Remix Studio listening volume (#1910): how loud the preview and draft
 * playback sound on THIS device. It is a viewer convenience, never part of
 * the remix — renders are loudness-normalized and ignore it. Remembered per
 * viewer in localStorage; every storage access fails silently.
 */

export type ListeningVolume = {
  /** Slider position 0..1 (1 = unity, 0 = silent). */
  level: number;
  muted: boolean;
};

export const LISTENING_VOLUME_STORAGE_KEY = "resonate.remixStudio.listeningVolume";

export const DEFAULT_LISTENING_VOLUME: ListeningVolume = {
  level: 1,
  muted: false,
};

/**
 * Attenuation at the bottom of the slider's audible range: the slider maps
 * linearly in dB from this floor (just above 0) to 0 dB at the top, which
 * sounds even to the ear. 0 is silence. Never boosts above unity, so the
 * limiter's ceiling still holds.
 */
export const LISTENING_VOLUME_FLOOR_DB = -40;

/** Slider position on 0..1; non-finite values fall back to unity. */
export function clampListeningLevel(level: unknown): number {
  if (typeof level !== "number" || !Number.isFinite(level)) {
    return DEFAULT_LISTENING_VOLUME.level;
  }
  return Math.min(1, Math.max(0, level));
}

/** Slider position → dB (-Infinity at 0). */
export function listeningLevelToDb(level: number): number {
  const clamped = clampListeningLevel(level);
  if (clamped <= 0) return Number.NEGATIVE_INFINITY;
  return LISTENING_VOLUME_FLOOR_DB * (1 - clamped);
}

/** Slider position → linear gain 0..1. */
export function listeningLevelToGain(level: number): number {
  const db = listeningLevelToDb(level);
  if (db === Number.NEGATIVE_INFINITY) return 0;
  return Math.min(1, Math.pow(10, db / 20));
}

/** Linear gain → slider position (the inverse of `listeningLevelToGain`). */
export function gainToListeningLevel(gain: number): number {
  if (!Number.isFinite(gain) || gain <= 0) return 0;
  if (gain >= 1) return 1;
  const db = 20 * Math.log10(gain);
  return clampListeningLevel(1 - db / LISTENING_VOLUME_FLOOR_DB);
}

/** The linear output gain a volume state plays at. */
export function listeningGain(volume: ListeningVolume): number {
  return volume.muted ? 0 : listeningLevelToGain(volume.level);
}

/** Moving the slider sets the level and unmutes (unless moved to 0). */
export function listeningVolumeAfterSlider(
  volume: ListeningVolume,
  level: number,
): ListeningVolume {
  const next = clampListeningLevel(level);
  return { level: next, muted: next <= 0 ? volume.muted : false };
}

/** Mute toggle; unmuting a slider at 0 brings it back to unity. */
export function listeningVolumeAfterMuteToggle(
  volume: ListeningVolume,
): ListeningVolume {
  if (volume.muted || volume.level <= 0) {
    return {
      level: volume.level <= 0 ? DEFAULT_LISTENING_VOLUME.level : volume.level,
      muted: false,
    };
  }
  return { ...volume, muted: true };
}

type VolumeStorage = Pick<Storage, "getItem" | "setItem">;

/** window.localStorage, or null where it is missing or access throws. */
function defaultStorage(): VolumeStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The remembered volume; the default when unavailable, unset or corrupt. */
export function readListeningVolume(
  storage: VolumeStorage | null = defaultStorage(),
): ListeningVolume {
  try {
    const raw = storage?.getItem(LISTENING_VOLUME_STORAGE_KEY);
    if (!raw) return DEFAULT_LISTENING_VOLUME;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return DEFAULT_LISTENING_VOLUME;
    }
    const { level, muted } = parsed as { level?: unknown; muted?: unknown };
    return { level: clampListeningLevel(level), muted: muted === true };
  } catch {
    return DEFAULT_LISTENING_VOLUME;
  }
}

/** Remembers the volume; a no-op when storage is unavailable or full. */
export function writeListeningVolume(
  volume: ListeningVolume,
  storage: VolumeStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(
      LISTENING_VOLUME_STORAGE_KEY,
      JSON.stringify({
        level: clampListeningLevel(volume.level),
        muted: volume.muted === true,
      }),
    );
  } catch {
    // Convenience only: the page works without storage.
  }
}
