---
title: "Removing music from My Library"
status: implemented
audiences: [listeners, frontend/backend developers]
issues: ["https://github.com/akoita/resonate/issues/1837"]
---

# Removing music from My Library

Listeners can remove saved tracks from the row menu or right-click menu in
My Library. Artist and album card menus remove the saved tracks in that group.
Checkbox selection exposes a bulk action. Each action shows a confirmation
with the number of tracks before removal. An owned stem stays in the library
while the listener holds it; its menu explains why it cannot be removed.

The server confirms deletion before the client removes cached metadata or
shows success. A failed request leaves the library visible and shows an error.
For a device-local scanned file, removal records its path and size in that
device's library exclusions so a later automatic folder scan does not re-add
it; the file itself stays on disk.
Removing a saved track also removes it from the current playback queue, skipping
to the next item if it was playing. Purchases, licences, owned stems, playlists,
and payouts are unchanged. The backend routes static batch and local-clear
requests before the single-track route.

The UI lives at `/library`, with server routes `DELETE /library/tracks/:id`,
`DELETE /library/tracks/batch`, and `DELETE /library/tracks/local`. Focused
checks are `web/src/lib/localLibrary.test.ts`, the browser removal flow, the
library grouping and scanner tests, `backend/src/tests/library.controller.http.spec.ts`,
and `backend/src/tests/library.integration.spec.ts`.

Successful removals emit the consent-gated `library.removed` product event with
only the count and surface. Track titles and IDs are not sent in the event.

This is vision-neutral library quality under ADR-BM-6. It does not change the
ADR-BM-4 artist share or any money-bearing entitlement.
