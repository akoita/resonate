import { describe, expect, it, vi } from "vitest";
import {
  clampListeningLevel,
  DEFAULT_LISTENING_VOLUME,
  gainToListeningLevel,
  LISTENING_VOLUME_FLOOR_DB,
  LISTENING_VOLUME_STORAGE_KEY,
  listeningGain,
  listeningLevelToDb,
  listeningLevelToGain,
  listeningVolumeAfterMuteToggle,
  listeningVolumeAfterSlider,
  readListeningVolume,
  writeListeningVolume,
} from "./remixListeningVolume";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
    data,
  };
}

function throwingStorage() {
  return {
    getItem: vi.fn(() => {
      throw new Error("SecurityError");
    }),
    setItem: vi.fn(() => {
      throw new Error("QuotaExceededError");
    }),
  };
}

describe("listening volume mapping (#1910)", () => {
  it("clamps the slider to 0..1 and falls back to unity for junk", () => {
    expect(clampListeningLevel(0.4)).toBe(0.4);
    expect(clampListeningLevel(-1)).toBe(0);
    expect(clampListeningLevel(3)).toBe(1);
    expect(clampListeningLevel(Number.NaN)).toBe(1);
    expect(clampListeningLevel("0.5")).toBe(1);
  });

  it("maps the slider linearly in dB from the floor to unity", () => {
    expect(listeningLevelToDb(1)).toBe(-0);
    expect(listeningLevelToDb(0.5)).toBe(LISTENING_VOLUME_FLOOR_DB / 2);
    expect(listeningLevelToDb(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(listeningLevelToGain(1)).toBe(1);
    expect(listeningLevelToGain(0)).toBe(0);
    expect(listeningLevelToGain(0.5)).toBeCloseTo(0.1, 6); // -20 dB
    expect(listeningLevelToGain(2)).toBe(1); // never boosts
  });

  it("inverts gain back to the slider position", () => {
    for (const level of [0.1, 0.25, 0.5, 0.9, 1]) {
      expect(gainToListeningLevel(listeningLevelToGain(level))).toBeCloseTo(level, 6);
    }
    expect(gainToListeningLevel(0)).toBe(0);
    expect(gainToListeningLevel(4)).toBe(1);
  });

  it("plays silent while muted", () => {
    expect(listeningGain({ level: 1, muted: true })).toBe(0);
    expect(listeningGain({ level: 1, muted: false })).toBe(1);
  });

  it("unmutes when the slider moves and restores unity when unmuting at 0", () => {
    expect(listeningVolumeAfterSlider({ level: 1, muted: true }, 0.6)).toEqual({
      level: 0.6,
      muted: false,
    });
    expect(listeningVolumeAfterSlider({ level: 1, muted: true }, 0)).toEqual({
      level: 0,
      muted: true,
    });
    expect(listeningVolumeAfterMuteToggle({ level: 0.6, muted: false })).toEqual({
      level: 0.6,
      muted: true,
    });
    expect(listeningVolumeAfterMuteToggle({ level: 0.6, muted: true })).toEqual({
      level: 0.6,
      muted: false,
    });
    expect(listeningVolumeAfterMuteToggle({ level: 0, muted: false })).toEqual({
      level: 1,
      muted: false,
    });
  });
});

describe("listening volume storage (#1910)", () => {
  it("round-trips through storage", () => {
    const storage = memoryStorage();
    writeListeningVolume({ level: 0.3, muted: true }, storage);
    expect(storage.setItem).toHaveBeenCalledWith(
      LISTENING_VOLUME_STORAGE_KEY,
      expect.any(String),
    );
    expect(readListeningVolume(storage)).toEqual({ level: 0.3, muted: true });
  });

  it("returns the default when unset, corrupt, or out of shape", () => {
    expect(readListeningVolume(memoryStorage())).toEqual(DEFAULT_LISTENING_VOLUME);
    expect(
      readListeningVolume(
        memoryStorage({ [LISTENING_VOLUME_STORAGE_KEY]: "{not json" }),
      ),
    ).toEqual(DEFAULT_LISTENING_VOLUME);
    expect(
      readListeningVolume(memoryStorage({ [LISTENING_VOLUME_STORAGE_KEY]: "[1]" })),
    ).toEqual(DEFAULT_LISTENING_VOLUME);
    expect(
      readListeningVolume(
        memoryStorage({
          [LISTENING_VOLUME_STORAGE_KEY]: JSON.stringify({ level: 7, muted: "yes" }),
        }),
      ),
    ).toEqual({ level: 1, muted: false });
  });

  it("never throws when storage does", () => {
    const storage = throwingStorage();
    expect(readListeningVolume(storage)).toEqual(DEFAULT_LISTENING_VOLUME);
    expect(() => writeListeningVolume({ level: 0.5, muted: false }, storage)).not.toThrow();
  });

  it("is a no-op without storage (server render)", () => {
    expect(readListeningVolume(null)).toEqual(DEFAULT_LISTENING_VOLUME);
    expect(() => writeListeningVolume(DEFAULT_LISTENING_VOLUME, null)).not.toThrow();
    // No window in the node test environment: the default storage is null.
    expect(readListeningVolume()).toEqual(DEFAULT_LISTENING_VOLUME);
  });
});
