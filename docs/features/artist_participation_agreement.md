# Artist Participation Agreement and Consent Record

**Status:** partial (#2666). The agreement, consent choices, history and
upload gate are built. An approval step for AI-assisted remixes does not
exist yet, so "ask me first" keeps other people's remixes to private drafts
(see [What is not built yet](#what-is-not-built-yet)).
**Audience:** artists, operators

## What it does

Before an artist uploads, they read the artist participation agreement and
choose how their music may be used. Both the acceptance and every later
change of a choice are recorded with a date, so the platform can show what
each use of an artist's work was allowed under.

- **Step 2 of artist onboarding** (`/artist/onboarding`) shows the agreement
  and the choices. An artist who already has a profile but has not accepted
  the current version sees the same step when they open the upload page.
- **Settings → Artist → Agreement and consent** shows the version accepted
  and its date, the text, the choices (editable at any time) and the change
  history. It replaces the earlier single remix switch.
- **Admin → Users → a user → Participation agreement** shows operators the
  accepted versions, current choices and history. Opening it is recorded in
  the admin audit log (`artist_participation.viewed`).

## The agreement text

The operator supplies the text as a Markdown file:

- `PARTICIPATION_AGREEMENT_FILE` names the file and
  `PARTICIPATION_AGREEMENT_VERSION` its version (up to 64 characters).
- Until both are set, a clearly marked placeholder is served. A test or
  staging deployment lets artists accept it to try the flow; a production
  deployment does not (`503 participation_agreement_unavailable`), so artist
  uploads stay closed there until the real text is published.
- The server stores the SHA-256 of the exact text the artist accepted. An
  acceptance sent with another version or hash than the one served is
  refused (`409 participation_agreement_changed`) and the page reloads the
  new text.
- Publishing a new version asks every artist to accept again before their
  next upload. Earlier acceptances are kept.

## The choices

| Choice | Stored as | Safe default at sign-up | What it does |
| --- | --- | --- | --- |
| Let listeners remix my music in Remix Studio | `Artist.remixConsent` | on | Off denies new remixes and holds published ones, as before (#2601). |
| Offer my stems as collectibles | `Artist.stemListing` | off | Off disables Mint & List on the artist's release pages. It is the artist's own preference; nobody else can list their stems. |
| Ask me before AI-assisted remixes of my music are shared | `Artist.aiRemixApproval` | on | On keeps other people's remixes of this artist's work to private drafts: no publishing and no export (`limits: artist_approval_required` in the eligibility answer). |
| Allow AI-assisted tools to use my music | `Artist.aiSourceUse` | off | Off denies Remix Studio, which is AI-assisted, to anyone but the artist (`artist_ai_use_disabled`). |

The artist's own choices never limit the artist themself. Rows that existed
before this change keep today's behaviour (remixing on, no approval, AI use
on, stems allowed) until the artist accepts and chooses. A change applies to
new uses from the moment it is saved.

## Records

- `ParticipationAcceptance`: artist, accepting account, version, text hash,
  date; one row per artist and version.
- `ArtistConsentChange`: artist, account, setting, previous and new value,
  source (`onboarding` or `settings`), date. The remix switch in the artist
  settings route writes here too.
- Both are in the personal data export and are retained on erasure (the
  account id follows the rotated id).

## Upload gate

Every upload checks that the artist accepted the current version
(`403 participation_agreement_required` otherwise). The gate is on by
default; `PARTICIPATION_AGREEMENT_REQUIRED=false` turns it off. Test runs
default to off so older upload suites keep working.

## What is not built yet

- An approval step where the artist approves or declines a specific
  AI-assisted remix. Until it exists, "ask me first" means "private drafts
  only" for others.
- The final agreement text, which is the operator's to publish.
