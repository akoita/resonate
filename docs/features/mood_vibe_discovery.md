---
title: "Mood And Vibe Discovery"
status: in-progress
owner: "@akoita"
issue: 279
---

# Mood And Vibe Discovery

Mood and vibe discovery turns Home filter chips into a listener action instead
of decoration. Listeners can select a mood or genre, see matching catalog
recommendations, and start an AI DJ session that queues tracks from that vibe.
Artists can tag uploaded releases with moods so discovery has explicit catalog
signals instead of relying only on titles and genres.

## Who Uses It

| Audience | Use |
| --- | --- |
| Listener | Starts playback from mood and genre chips on Home. |
| Artist | Adds mood tags during upload to improve listener discovery. |
| Backend developer | Uses recommendation overrides and release mood tags to test ranking behavior. |

## Current Status

Status: `in-progress`

Available in this branch:

- Home mood and genre chips pass request-scoped preference overrides to
  `GET /recommendations/:userId`.
- Home exposes a vibe session action for active mood or genre chips. It queues
  matching tracks, updates the listener AI DJ config, starts an agent session,
  and records an `agent.track_selected` signal with `source:
  "home_vibe_session"` metadata.
- Artist upload exposes mood tags and forwards them through ingestion metadata.
- Catalog releases persist `moods` as normalized string arrays and include them
  in published, owner, release-detail, artist, and MCP catalog search results.
- Recommendation scoring includes release mood tags and returns `moods` on
  recommendation items.

Known follow-up work:

- Dedicated analytics for the success metric: 30 percent of playback sessions
  start from mood selection.
- Broader artist-side mood taxonomy, validation, and import paths for existing
  catalog releases.

## End-User Flow

1. Open Home (`/`).
2. Select a mood chip such as Focus, Hype, Chill, or Late Night.
3. Review the personalized recommendation row and matching catalog rows.
4. Start the vibe session to queue tracks and continue in `/agent`.

## Artist Flow

1. Open `/artist/upload`.
2. Fill the release metadata.
3. Select one or more mood tags before uploading.
4. Publish the processed release so the mood tags become available to Home and
   recommendation ranking.

## API And Data Surfaces

| Surface | Detail |
| --- | --- |
| Prisma | `Release.moods String[] @default([])` |
| Upload metadata | `StemsUploadedEvent.metadata.moods` |
| Catalog create | `POST /catalog` accepts `moods?: string[]` |
| Recommendations | `GET /recommendations/:userId?mood=Focus&energy=low&genres=Ambient,Electronic` |
| Home session signal | `recordAgentSignal` metadata includes `source`, `vibe`, `filterKind`, and `autoQueuedTracks` |

## Verification

- Backend controller/unit coverage checks request-scoped recommendation
  overrides.
- Backend integration coverage verifies release mood tags contribute to ranking
  and are returned with recommendation items.
- Web API coverage verifies recommendation override query serialization.
