import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ setItem: vi.fn(), create: vi.fn(), analytics: vi.fn() }));
vi.mock('localforage', () => ({ default: { createInstance: () => ({ setItem: mocks.setItem }) } }));
vi.mock('./api', () => ({ createPlaylistAPI: mocks.create }));
vi.mock('./productAnalytics', () => ({ recordProductAnalyticsFromBrowser: mocks.analytics }));
import { createQueuePlaylist } from './playlistStore';
const context = { sourceKind: 'ad_hoc' as const, queueCount: 2, omittedCount: 0 };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', { getItem: () => 'token' });
  mocks.setItem.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue({ id: 'saved', name: 'Queue', trackIds: ['b', 'a'], visibility: 'private', createdAt: '', updatedAt: '' });
});
afterEach(() => vi.unstubAllGlobals());
it('creates the full ordered snapshot in one request without a duplicate browser event', async () => {
  await expect(createQueuePlaylist(' Queue ', null, ['b', 'a'], context)).resolves.toMatchObject({ id: 'saved' });
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith('token', { name: 'Queue', folderId: undefined, trackIds: ['b', 'a'], queueContext: { origin: 'player_queue', ...context } });
  expect(mocks.analytics).not.toHaveBeenCalled();
});
it('does not turn an API failure into a silent local save', async () => {
  mocks.create.mockRejectedValueOnce(new Error('Unavailable'));
  await expect(createQueuePlaylist('Queue', null, ['b','a'], context)).rejects.toThrow('Unavailable');
  expect(mocks.setItem).not.toHaveBeenCalled();
});
it('does not report a failed creation after the server commits but the local cache fails', async () => {
  mocks.setItem.mockRejectedValueOnce(new Error('Quota'));
  await expect(createQueuePlaylist('Queue', null, ['b','a'], context)).resolves.toMatchObject({ id: 'saved' });
});
it('preserves signed-out local storage without analytics upload', async () => {
  vi.stubGlobal('localStorage', { getItem: () => null });
  await expect(createQueuePlaylist('Queue', null, ['b','a'], context)).resolves.toMatchObject({ trackIds: ['b','a'], visibility: 'private' });
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.analytics).not.toHaveBeenCalled();
});
