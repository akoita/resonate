# Local Audio Library

**Status:** `implemented` — epic [#2503](https://github.com/akoita/resonate/issues/2503)
(slices [#2504](https://github.com/akoita/resonate/issues/2504),
[#2505](https://github.com/akoita/resonate/issues/2505),
[#2506](https://github.com/akoita/resonate/issues/2506),
[#2507](https://github.com/akoita/resonate/issues/2507),
[#2508](https://github.com/akoita/resonate/issues/2508))

Listeners can add folders of their own music and use those files in their
library, playlists and queue next to Resonate tracks. A local file is private
and **device-only**: it plays only on the device where its folder was added,
it is never uploaded or copied, and it never behaves like a release. Putting
music on Resonate for others stays an artist operation (release upload).

## Who it's for

- **Listeners** — play their own collection alongside the catalog.
- **Frontend/backend developers** — the boundary between device files and
  platform tracks, which share one client type and one table.

## How it works

| Piece | Where it lives |
| --- | --- |
| Library row (title, tags, track/disc numbers, credits, duration, `sourcePath`, `fileSize`, `sourceFolder`) | `LibraryTrack` with `source: "local"`, via `/library/tracks` |
| Link to the file on disk | `FileSystemFileHandle` in IndexedDB (`fileHandles` store), this device only |
| Cover art | Thumbnail (≤ 320 px) in IndexedDB, this device only |
| Audio | **Stays on disk.** Read with `handle.getFile()` when it plays |

- **Adding.** Settings › Library › Add Folder stores a directory handle; the
  scanner (`libraryScanner.ts`) walks it and saves one row per new file
  (dedup by relative path + size). A file already in the library is linked to
  this device instead of being imported again, so adding the same folder on a
  second device makes those rows playable there. `/import`, which copied files
  into the browser, now redirects to Settings › Library.
- **Playing.** `resolveTrackPlayback()` returns a URL or a reason:
  `other_device`, `needs_permission` (browser read permission lapsed after a
  restart; pressing play asks again) or `missing` (moved, renamed, deleted).
  The player shows a message for each. Only a few object URLs are kept alive.
- **Across devices.** The library list follows the account; the audio does
  not. A file plays on any device that can reach it: adding a folder there
  links every row whose path inside the folder and size match (or file name
  and size, for a parent or subfolder), and those rows become playable on that
  device. Rows with no link on this device resolve to `available: false`.
  They are **hidden by default**; *Show them greyed out* (in the library
  notice, and *Show files that are not on this device* in Settings › Library,
  stored per device as `showUnreachableFiles`) shows them greyed out as
  **On another device**. The older `showOtherDeviceTracks` setting, which
  defaulted to on, is retired so every device starts hidden.
- **Which folder to add.** Each row records `sourceFolder`, the name of the
  library folder it was found in (a name only: browsers never reveal where a
  folder sits on disk, and the server drops anything before the last path
  separator). The library and Settings › Library show a notice listing the
  folders this device is missing with an *Add “Caravelle” here* button
  (`otherDeviceFolders.ts`, `OtherDeviceFilesNotice`), which opens the folder
  picker, adds and scans the folder, and reports how many files now play here.
  Browsers cannot open a folder by name, so the listener still picks it.
  Rows imported before `sourceFolder` existed get it on their device's next
  scan. Playlists keep unreachable rows in place, greyed out, so their order
  and length never change by device.
- **Telling them apart.** Every own file shows a **My file** badge, and the
  Tracks tab has an *All / Resonate / My files* filter once the library holds
  any (`matchesLibraryOriginFilter`, `isOwnFileTrack` in `trackIdentity.ts`).
- **Untagged files and folder covers.** When a file has no tags the scanner
  names it from the file name (track number and slug hyphens removed) and
  takes the album and artist from its folders (`…/Artist/Album/`, disc
  folders such as `CD2` skipped, generic names such as `Music` ignored). With
  no embedded cover it uses a sidecar image in the same folder (`cover.jpg`,
  `Folder.jpg`, `front.jpg`, `AlbumArt*_Large.jpg`, `AlbumArtSmall.jpg`, or a
  folder's only image). See `localFileNaming.ts`. Rows imported before this
  are repaired on the next scan, unless the listener edited them.
- **Duplicates.** A file reached from two added folders (a parent and its
  subfolder) is matched by file name + size as well as by path, and a folder
  inside another added folder is scanned only from the outer one.
- **Tags read on import.** Besides title, artist, album artist, album, year
  and genre, the scanner reads track and disc numbers, label, ISRC, the ℗/©
  line, composer and producer (`tagsFromCommon` in `metadataExtractor.ts`,
  shared with release upload). The year falls back to the release and
  original dates. These columns exist on `LibraryTrack` for local rows only;
  the server rejects them on catalog rows. Files imported before a tag was
  read get it on the next scan of their folder: each device re-reads an older
  file once (`tagsVersion` in the device cache, `LOCAL_TAGS_VERSION`) and
  fills only fields that are still empty (`fillMissingTags`), so nothing the
  listener edited is replaced. A file that has no year tag (common for CD rips)
  still shows *Unknown year* until the listener sets it.
- **Album order.** A local album plays and lists in disc, then track order
  (`sortByAlbumPosition`); tracks without a number follow in their usual order.
- **Editing.** *Edit details* on a track, *Edit album* on a local album, and
  *Edit N files* on a multi-selection open one editor (`EditLocalDetailsDialog`)
  grouped as Track (title, artist, track, disc), Album (album, album artist,
  year, genre) and Credits (composer, producer, label, ℗/©, ISRC). Each mode
  shows only the fields that make sense for it (no track number or ISRC on an
  album). With several tracks, fields that differ show *Mixed* and are kept
  per track unless the listener types a value; only changed fields are saved,
  in one batch (`updateLocalTracks`, which refuses catalog rows).
- **Look up details (#2538).** In *Edit album*, *Look up details* asks
  MusicBrainz for releases matching the album artist, album title and track
  count, and lists up to five (title, artist, year, country, label, track
  count; releases with the same number of tracks first). Picking one fills
  only the year, genre (the most-voted genre of the release, or of its release
  group) and label fields that are empty for the whole album; a typed value, a
  file tag or a *Mixed* field is never replaced, and nothing is saved until
  the listener presses Save. Privacy: nothing is sent before the click; the
  request goes through the backend (`GET /library/lookup/releases`,
  `GET /library/lookup/releases/:id`, signed in, 20 per minute per account),
  so MusicBrainz sees only the server, the three search values and a
  descriptive User-Agent, never the listener's address or account. The server
  keeps MusicBrainz's one request per second for the whole process, shared
  with artist enrichment (`shared/musicbrainz_queue.ts`), and caches answers
  for six hours in memory. `album_lookup.service.ts`, `AlbumLookup.tsx`,
  `albumLookup.ts`; tests `album-lookup.service.spec.ts`, `albumLookup.test.ts`.
- **Edits stay in Resonate.** Edits are saved to the account's library rows
  and follow it to every device; the files on disk are never written, so a
  rescan does not undo an edit and nothing can damage a file. The cover stays
  on the device. Writing tags back into files could become an opt-in for the
  desktop app later; the browser cannot do it safely.
- **File location.** The track menu shows the file's path starting at the
  added folder (browsers never expose the drive or the folders above it),
  copies it, and *Open folder* opens the system file picker in that folder
  (`showOpenFilePicker({ startIn })`).
- **Legacy copies.** Audio copied into IndexedDB before #2503 still plays; a
  rescan that links the file on disk deletes the copy.

## The boundary (server)

`LibraryService.saveTrack` enforces it (#2505):

- `source` is required, `"local"` or `"remote"`.
- A local row cannot carry `catalogTrackId`, `remoteUrl`, `remoteArtworkUrl`,
  `previewUrl`, `stemType`, `tokenId`, `listingId`, `purchaseDate` or
  `isOwned`, and its id must start with `local_`.
- A remote row needs a catalog reference and cannot carry `sourcePath` or
  `fileSize`.
- A local row's `sourcePath` must start at the added folder. A full path
  (drive letter, leading `/` or `\`, `~`, a URL) or a `..` segment is
  refused (`isFolderRelativePath`): it would name the folders above, which
  usually include the person's user name.
- The primary key is always server-generated. Ids a client names (device files,
  owned stems) are stored as `clientKey`, unique per user, and returned as the
  row's `id`. Every lookup is scoped to the owner.
- Availability, public playlist resolution and takedown cleanup derive catalog
  identity from `source`, never from URL fields on a local row.
- On a remote stem row, `isOwned`, `tokenId`, `listingId` and `purchaseDate`
  come from the account's holdings, never from the client (#2511,
  `library_holdings.ts`): its `StemPurchase` rows and its active `StemListing`
  rows, across the same addresses the collection endpoint reads (wallet,
  smart-account owner, agent-purchase buyers). They are written on save and
  recomputed on every read, so a stem sold on stops reading as owned.

Outside the library:

- **Public and saved playlists** leave local files out for non-owners
  (`privateTrackCount`) — see [Public Playlists](public_playlists.md).
- **Analytics and learning** drop playback with `source: "web_player_local"`
  (`LOCAL_FILE_NOT_COUNTED`); the web player never attaches a catalog id to a
  local file (`catalogTrackIdOf`) and sends no playback event for one. AI DJ
  learning no longer counts local plays.
- **Product events never name a device file.** Player controls (segment loop,
  repeat count) on a local file are still counted, without the track
  (`getPlayerControlSubject`), and adding one file to a playlist reports no
  `trackId` (`isLocalFileTrackId`). The server strips a `local_` track id
  from any product event before it is stored (`withoutLocalFileTrack`), so it
  never reaches artist attribution or an `AgentSignal`.
- **AI DJ playlist seeds** skip `local_` entries before sampling the
  playlist (`isLocalFileClientId`, `catalog.playlist_seed`), so a playlist
  full of the listener's files still seeds from its catalog tracks.
- **Community cohorts** read only `source: "remote"` library rows.
- **Release, stem, mint, remix and upload flows** have no entry point that
  accepts a local file; uploading stays artist-only.

`web/src/lib/trackIdentity.ts` (`isLocalFileTrack`, `catalogTrackIdOf`,
`isCatalogTrack`) is the single client-side answer to "is this a catalog
track?". Use it for anything that leaves the device.

## Browser support

Adding folders needs the File System Access API (Chrome, Edge, other
Chromium browsers, the desktop app). In other browsers only the Library
section of Settings explains this; the rest of Settings works.

## Tests

- `web/src/lib/localLibraryDevice.test.ts` — handles, device availability,
  playback problems, legacy copies.
- `web/src/lib/libraryScanner.test.ts`, `web/src/lib/trackIdentity.test.ts`.
- `backend/src/tests/library.integration.spec.ts` (`local vs. catalog boundary`),
  `library.controller.http.spec.ts`, `playlist-public.integration.spec.ts`,
  `playlist-discovery.integration.spec.ts`,
  `community_cohort_generation.integration.spec.ts`,
  `analytics_instrumentation.spec.ts`, `library-source-folder.spec.ts`,
  `agent_dj_playlist_pattern.integration.spec.ts`.

## Manual test

1. In Chrome, Settings › Library › Add Folder, pick a folder with a few songs.
2. Library: the songs play. DevTools › Application › IndexedDB: `fileHandles`
   has entries, `audioBlobs` has none.
3. Sign in on a second browser profile: the songs appear greyed out, *On another
   device*; the toggle hides them. Add the same folder there: they play.
4. Add a local song and a catalog track to a playlist, make it public, open it
   signed out: only the catalog track is listed, with "1 personal file … not
   shown".

## Related

- [Removing music from My Library](library_removal.md)
- [Public Playlists](public_playlists.md)
