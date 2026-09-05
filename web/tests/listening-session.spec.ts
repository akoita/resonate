import { test, expect, type Page } from '@playwright/test';
import { injectMockAuth } from './auth.setup';

async function seedPlayer(page: Page, source = false, local = false) {
  await injectMockAuth(page);
  await page.addInitScript(() => {
    const testWindow = window as unknown as { sessionAudio: HTMLAudioElement };
    window.Audio = function () {
      const audio = document.createElement('audio');
      let time = 0; let paused = true; let source = "";
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
  await page.route('**/analytics/**', route => route.fulfill({ json: { status: 'ok', eventId: 'test-event', ingested: 1 } }));
  await page.route('**/playlists/folders', route => route.fulfill({ json: [] }));
  await page.goto('/player');
  await expect(page.getByText('Queue Manifest', { exact: true })).toBeVisible();
  await page.addScriptTag({ path: require.resolve('localforage/dist/localforage.js') });
  await page.evaluate(async options => {
    const queue = ['a', 'b', 'c'].map(id => ({ id, catalogTrackId: id, title: `Test ${id}`, artist: 'Test Artist', album: null, albumArtist: null, genre: null, year: null, duration: 30, createdAt: '', source: 'remote', remoteUrl: `${location.origin}/test-${id}.wav` }));
    if (options.local) Object.assign(queue[2], { catalogTrackId: null, source: 'local', blobKey: 'local-file' });
    const storage = (window as unknown as { localforage: { createInstance(options: object): { setItem(key: string, value: unknown): Promise<unknown> } } }).localforage.createInstance({ name: 'resonate', storeName: 'player' });
    await storage.setItem('current_state', { queue, currentIndex: 0, volume: .5, shuffle: false, repeatMode: 'none', queueSource: options.source ? { playlistId: 'source-playlist', trackIds: ['a','b','c'] } : null });
  }, { source, local });
  await page.reload();
  await expect(page.getByRole('main').getByText('Test a', { exact: true }).first()).toBeVisible();
  await page.getByRole('main').getByRole('button', { name: 'Play', exact: true }).click();
}
async function endTrack(page: Page) {
  await page.evaluate(() => { const audio = (window as unknown as { sessionAudio: HTMLAudioElement }).sessionAudio; audio.currentTime = 30; });
  await page.evaluate(() => (window as unknown as { sessionAudio: HTMLAudioElement }).sessionAudio.dispatchEvent(new Event('ended')));
}

test('queue snapshot saves once in manifest order and preserves active playback', async ({ page }) => {
  await seedPlayer(page);
  const requests: unknown[] = [];
  await page.route('**/playlists', async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: [] });
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: { id: 'saved-playlist', name: 'Saved queue', trackIds: ['a','b','c'], createdAt: '', updatedAt: '' } });
  });
  await page.getByRole('button', { name: 'Save queue as playlist' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save queue as playlist' });
  await dialog.getByLabel('Name', { exact: true }).fill('Saved queue');
  await dialog.getByRole('button', { name: 'Create playlist' }).dblclick();
  await expect(page.getByRole('link', { name: 'Open playlist' })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ trackIds: ['a','b','c'], queueContext: { origin: 'player_queue', sourceKind: 'ad_hoc', queueCount: 3 } });
  await expect(page.getByRole('main').getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
});

test('source provenance survives reload and queue removal makes a new snapshot eligible', async ({ page }) => {
  await seedPlayer(page, true);
  await expect(page.getByRole('link', { name: 'View playlist' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save queue as playlist' })).toHaveCount(0);
  await page.getByRole('button', { name: /Remove Test c/ }).click();
  await expect(page.getByRole('button', { name: 'Save queue as playlist' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Save queue as playlist' })).toBeVisible();
});

test('passage loop holds finite counts, then natural ends consume exact additional repeats', async ({ page }) => {
  await seedPlayer(page);
  const events: string[] = [];
  await page.route('**/analytics/product/event', async route => {
    events.push(route.request().postDataJSON().eventName);
    await route.fulfill({ json: { status: 'ok', ingested: 1 } });
  });
  const controls = page.getByRole('main').locator('.listening-controls').filter({ has: page.locator('summary') });
  await controls.locator('summary').click();
  await controls.getByLabel('A (seconds)', { exact: true }).fill('5');
  await controls.getByLabel('B (seconds)', { exact: true }).fill('10');
  await controls.getByRole('button', { name: 'Loop passage', exact: true }).click();
  await controls.getByLabel('Additional repeats').fill('1');
  await controls.getByRole('button', { name: 'Set repeats', exact: true }).click();
  await page.evaluate(() => { const a = (window as unknown as { sessionAudio: HTMLAudioElement }).sessionAudio; a.currentTime = 11; });
  await page.evaluate(() => (window as unknown as { sessionAudio: HTMLAudioElement }).sessionAudio.dispatchEvent(new Event('timeupdate')));
  expect(await page.evaluate(() => (window as unknown as { sessionAudio: HTMLAudioElement }).sessionAudio.currentTime)).toBe(5);
  await expect(controls.getByText(/1 remaining/)).toBeVisible();
  if (process.env.CAPTURE_LISTENING_HELP === 'true') {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await controls.scrollIntoViewIfNeeded();
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await page.screenshot({ path: 'public/help/screenshots/player-listening-controls.png', animations: 'disabled' });
  }
  await controls.getByRole('button', { name: 'Clear passage' }).click();
  await endTrack(page);
  await expect(controls.getByText(/0 remaining/)).toBeVisible();
  await endTrack(page);
  await expect(page.getByRole('main').getByText('Test b', { exact: true }).first()).toBeVisible();
  await expect(controls.getByText(/remaining/)).toHaveCount(0);
  await expect.poll(() => events.filter(name => name.startsWith('player.'))).toEqual([
    'player.segment_loop_enabled', 'player.repeat_count_set', 'player.segment_loop_disabled',
  ]);
});

test('finite queue repeats finish after the last full pass on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedPlayer(page);
  const controls = page.getByRole('main').locator('details.listening-controls');
  await controls.locator('summary').click();
  await controls.getByLabel('Repeat target').selectOption('queue');
  await controls.getByRole('button', { name: 'Set repeats', exact: true }).click();
  for (const expected of ['b', 'c', 'a', 'b', 'c']) {
    await endTrack(page);
    await expect(page.getByRole('main').getByText(`Test ${expected}`, { exact: true }).first()).toBeVisible();
  }
  await endTrack(page);
  await expect(page.getByRole('main').getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(controls.getByText(/remaining/)).toHaveCount(0);
});

test('a failed save leaves the dialog and queue available for retry', async ({ page }) => {
  await seedPlayer(page);
  await page.route('**/playlists', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 400, json: { message: 'Some tracks are no longer available', invalidTrackIds: ['b'] } }) : route.fulfill({ json: [] }));
  await page.getByRole('button', { name: 'Save queue as playlist' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save queue as playlist' });
  await dialog.getByLabel('Name', { exact: true }).fill('Retry queue');
  await dialog.getByRole('button', { name: 'Create playlist' }).click();
  await expect(dialog.getByRole('alert')).toContainText('no longer available');
  await expect(dialog.getByText('Test b', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Create playlist' })).toBeDisabled();
  await dialog.getByLabel('Save without these tracks').check();
  await expect(dialog.getByRole('button', { name: 'Create playlist' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('main').getByText('Test a', { exact: true }).first()).toBeVisible();
});


test('omitting a local-only track requires explicit confirmation', async ({ page }) => {
  await seedPlayer(page, false, true);
  await page.getByRole('button', { name: 'Save queue as playlist' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save queue as playlist' });
  await dialog.getByLabel('Name', { exact: true }).fill('Supported tracks');
  await expect(dialog.getByText('Test c', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Create playlist' })).toBeDisabled();
  await dialog.getByLabel('Save without these tracks').check();
  await expect(dialog.getByRole('button', { name: 'Create playlist' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('finite plans survive navigation and seeking but track selection cancels them', async ({ page }) => {
  await seedPlayer(page);
  const controls = page.getByRole('main').locator('details.listening-controls');
  await controls.locator('summary').click();
  await controls.getByLabel('Additional repeats').fill('2');
  await controls.getByRole('button', { name: 'Set repeats', exact: true }).click();
  await page.getByRole('main').getByRole('slider', { name: 'Playback position' }).fill('50');
  await expect(controls.getByText(/2 remaining/)).toBeVisible();
  await page.getByRole('link', { name: 'User Guide', exact: true }).first().click();
  await page.getByRole('link', { name: 'Player', exact: true }).first().click();
  await expect(controls.locator('summary')).toContainText('2 repeats left');
  await page.getByRole('main').getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('main').getByText('Test b', { exact: true }).first()).toBeVisible();
  await expect(controls.locator('summary')).not.toContainText('repeats left');
});
