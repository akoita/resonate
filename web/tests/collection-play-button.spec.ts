import { test, expect, type Page } from '@playwright/test';
import { injectMockAuth } from './auth.setup';

// A collection header's Play button follows playback: Pause while that
// collection plays, Resume (not a restart) once paused, Play again once the
// queue holds something else.

const PLAYLIST_ID = 'collection-play-playlist';

function playlistFixture() {
  const track = (id: string, title: string) => ({
    id, title, artist: 'Test Artist', album: 'Test Album', duration: 30,
    streamPath: `/catalog/tracks/${id}/stream`, artworkPath: null,
    catalogTrackId: id, releaseId: 'test-release', playable: true,
  });
  return {
    id: PLAYLIST_ID, name: 'Header test', visibility: 'public', ownerUserId: 'someone-else',
    ownerDisplayName: 'Curator', isOwner: false, isSaved: false, trackCount: 3, playableTrackCount: 3,
    privateTrackCount: 0, tracks: [track('t1', 'First song'), track('t2', 'Second song'), track('t3', 'Third song')],
    createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
  };
}

async function openPlaylist(page: Page) {
  await injectMockAuth(page);
  // Stand-in audio element: the test controls time and play/pause events.
  await page.addInitScript(() => {
    const testWindow = window as unknown as { sessionAudio: HTMLAudioElement };
    window.Audio = function () {
      const audio = document.createElement('audio');
      let time = 0; let paused = true; let source = '';
      Object.defineProperties(audio, {
        src: { get: () => source, set: (value: string) => { source = value; } },
        duration: { get: () => 30 }, paused: { get: () => paused },
        currentTime: { get: () => time, set: (value: number) => { time = value; queueMicrotask(() => audio.dispatchEvent(new Event('seeked'))); } },
      });
      audio.play = async () => { paused = false; audio.dispatchEvent(new Event('loadedmetadata')); audio.dispatchEvent(new Event('play')); };
      audio.pause = () => { paused = true; audio.dispatchEvent(new Event('pause')); };
      audio.load = () => { time = 0; audio.dispatchEvent(new Event('loadedmetadata')); };
      testWindow.sessionAudio = audio;
      return audio;
    } as unknown as typeof Audio;
  });
  await page.route('**/analytics/**', route => route.fulfill({ json: { productAnalytics: false, decided: true, needsDecision: false } }));
  await page.route(`**/playlists/public/${PLAYLIST_ID}`, route => route.fulfill({ json: playlistFixture() }));
  await page.goto(`/playlist/${PLAYLIST_ID}`);
  await expect(page.getByRole('heading', { name: 'Header test' })).toBeVisible({ timeout: 15000 });
}

const header = (page: Page) => page.locator('.collection-play-btn');

test('playlist header button pauses and resumes the playlist instead of restarting it', async ({ page }) => {
  await openPlaylist(page);
  await expect(header(page)).toHaveAttribute('data-playback-state', 'idle');
  await expect(header(page)).toHaveAccessibleName('Play Header test');

  await header(page).click();
  await expect(header(page)).toHaveAttribute('data-playback-state', 'playing');
  await expect(header(page)).toHaveAccessibleName('Pause Header test');

  // Move into the second track, part way through, then pause from the header.
  await page.locator('.app-player').getByRole('button', { name: /next/i }).first().click();
  await expect(page.locator('.app-player').getByText('Second song').first()).toBeVisible();
  await page.evaluate(() => { (window as unknown as { sessionAudio: HTMLAudioElement }).sessionAudio.currentTime = 12; });
  await header(page).click();
  await expect(header(page)).toHaveAttribute('data-playback-state', 'paused');
  await expect(header(page)).toHaveAccessibleName('Resume Header test');

  // Resume carries on with the same track at the same place.
  await header(page).click();
  await expect(header(page)).toHaveAttribute('data-playback-state', 'playing');
  await expect(page.locator('.app-player').getByText('Second song').first()).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { sessionAudio: HTMLAudioElement }).sessionAudio.currentTime)).toBe(12);

  // The player bar's own pause is reflected too.
  await page.locator('.app-player').getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(header(page)).toHaveAttribute('data-playback-state', 'paused');
});
