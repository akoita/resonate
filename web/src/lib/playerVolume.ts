export interface PlayerVolumeState {
  volume: number;
  muted: boolean;
  previousNonZeroVolume: number;
}

export function setPlayerVolume(
  state: PlayerVolumeState,
  value: number,
): PlayerVolumeState {
  const volume = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return {
    volume,
    muted: volume === 0,
    previousNonZeroVolume: volume > 0 ? volume : state.previousNonZeroVolume,
  };
}

export function togglePlayerMute(state: PlayerVolumeState): PlayerVolumeState {
  return state.muted || state.volume === 0
    ? setPlayerVolume(state, state.previousNonZeroVolume || 0.8)
    : setPlayerVolume(state, 0);
}
