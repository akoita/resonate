import type { HelpArticle } from "./types";

/**
 * The Resonate User Guide.
 *
 * Plain-language, end-user content — no contract names, API routes, or
 * database details. Each article maps to one or more shipped features in
 * `docs/features/`. When a user-facing feature changes, update the matching
 * article here in the same PR (see CLAUDE.md → Feature Catalog rules).
 *
 * Screenshots live in `web/public/help/screenshots/` and are captured from
 * staging, or from a local public preview before a new route is first deployed,
 * with `scripts/capture-help-screenshots.mjs`.
 */

const SHOT = "/help/screenshots";
const STAGING = "Staging";
const LOCAL_PUBLIC = "Local preview";
// Authenticated-only screens, captured from a local instance in a signed-in
// preview state (sample data), since signed-in screens aren't publicly reachable.
const LOCAL = "Signed-in preview";

export const HELP_ARTICLES: HelpArticle[] = [
  // ───────────────────────────── Get started ─────────────────────────────
  {
    slug: "getting-started",
    title: "Create your account & sign in",
    summary:
      "Resonate uses a passkey instead of a password — set it up once and your device unlocks everything, including a built-in wallet.",
    category: "get-started",
    audiences: ["everyone"],
    keywords: ["sign up", "log in", "passkey", "password", "register", "account", "connect wallet", "face id", "fingerprint"],
    sections: [
      {
        id: "what-you-need",
        heading: "What you need",
        blocks: [
          {
            kind: "paragraph",
            text: "You do not need a password, a seed phrase, or any crypto to start. Resonate signs you in with a passkey — the same Face ID, fingerprint, or device PIN you already use to unlock your phone or laptop.",
          },
          {
            kind: "callout",
            tone: "note",
            title: "Your passkey stays on your device",
            text: "The passkey lives in your device's secure authenticator. Resonate never sees it and can never delete it — it always controls any account it created.",
          },
        ],
      },
      {
        id: "create-account",
        heading: "Create your account",
        blocks: [
          {
            kind: "steps",
            items: [
              "Open Resonate and select Sign Up in the top-right corner.",
              "When your device prompts you, approve the passkey with Face ID, your fingerprint, or your device PIN.",
              "That's it — your account and a personal wallet (your 'smart account') are created together.",
            ],
          },
          {
            kind: "figure",
            figure: {
              src: `${SHOT}/connect-wallet.png`,
              alt: "A Resonate page showing a single 'Connect Wallet' button under a 'Connect' heading, with Log In and Sign Up buttons in the top-right.",
              caption: "Most personal features ask you to connect first. Sign Up creates your account; Log In returns to an existing one.",
              width: 1440,
              height: 900,
              source: STAGING,
            },
          },
        ],
      },
      {
        id: "sign-in-again",
        heading: "Signing in again",
        blocks: [
          {
            kind: "paragraph",
            text: "Choose Log In and approve the same passkey. On a brand-new device, sign in with the passkey you saved (most phones and browsers sync passkeys for you), then continue where you left off.",
          },
          {
            kind: "callout",
            tone: "tip",
            title: "Browse before you sign in",
            text: "You can explore Discover, the catalog, the Marketplace, and Shows campaigns without signing in. You'll be asked to connect only when you save, buy, pledge, or upload.",
          },
        ],
      },
    ],
    appLinks: [
      { label: "Open Resonate", href: "/", description: "The Discover home page." },
      { label: "Your wallet", href: "/wallet", description: "See the account that was created for you." },
    ],
    related: ["smart-wallet", "troubleshooting"],
  },
  {
    slug: "legal-privacy-refunds",
    title: "Terms, privacy & refunds",
    summary:
      "Read who operates this Resonate instance, what you agree to, how your data is handled, and when an escrow pledge is refundable.",
    category: "account",
    audiences: ["everyone"],
    keywords: ["terms", "privacy", "refund", "imprint", "contact", "legal", "data", "escrow", "pledge"],
    sections: [
      {
        id: "before-signing-up",
        heading: "Before signing up",
        blocks: [
          {
            kind: "paragraph",
            text: "The sign-up area links the Terms, Privacy Policy and Refund Policy. You can open every document without an account. The Imprint identifies and provides contact details for the operator of the instance you are using.",
          },
        ],
      },
      {
        id: "privacy-controls",
        heading: "Your privacy controls",
        blocks: [
          {
            kind: "paragraph",
            text: "Optional product analytics are your choice. No answer means no optional collection. Settings under Privacy lets you change that choice, download your data, or request account deletion with a 30-day period to change your mind.",
          },
          {
            kind: "callout",
            tone: "warning",
            title: "Some public records are permanent",
            text: "Resonate cannot erase a confirmed public-blockchain transaction or guarantee deletion of content already published to IPFS. The Privacy Policy explains these limits before you publish or transact.",
          },
        ],
      },
      {
        id: "escrow-refunds",
        heading: "Escrow pledge refunds",
        blocks: [
          {
            kind: "paragraph",
            text: "A campaign that misses its goal, or is cancelled before any artist release, makes your full pledge refundable with no platform fee deducted. If a deposit was already released, the refund is your proportional share of what remains in escrow. You claim it from the campaign with the wallet that pledged.",
          },
        ],
      },
    ],
    appLinks: [
      { label: "Terms of Service", href: "/terms", description: "The agreement for using this Resonate instance." },
      { label: "Privacy Policy", href: "/privacy", description: "Collection, retention, rights and permanent-data limits." },
      { label: "Refund Policy", href: "/refunds", description: "Refund conditions for pledges and other purchases." },
      { label: "Imprint & contact", href: "/imprint", description: "Operator identity, hosting and contact details." },
    ],
    related: ["getting-started", "settings-privacy", "download-your-data"],
  },
  {
    slug: "smart-wallet",
    title: "Your wallet & smart account",
    summary:
      "Every account comes with a built-in 'smart account' wallet for payouts, purchases, and stakes — funded with stablecoins and protected by your passkey.",
    category: "account",
    audiences: ["everyone", "listener", "artist"],
    keywords: ["wallet", "smart account", "balance", "usdc", "stablecoin", "gas", "funding", "deposit", "recovery", "passkey", "budget cap", "erc-4337"],
    sections: [
      {
        id: "overview",
        heading: "What the wallet is for",
        blocks: [
          {
            kind: "paragraph",
            text: "Your smart account is the wallet Resonate created with your passkey. It holds your balance, receives artist payouts, pays for stems and pledges, and tracks any stakes you have placed. You approve each action with your passkey — there are no separate keys to back up.",
          },
          {
            kind: "figure",
            figure: {
              src: `${SHOT}/wallet.png`,
              alt: "The Wallet page showing a Smart Account Balance of 0.000000, account details, and a Security & Recovery panel listing Passkey Signer, Kernel Account, and Gas Sponsorship.",
              caption: "The Wallet page: balance at the top, account details on the left, and Security & Recovery on the right.",
              width: 1440,
              height: 900,
              source: STAGING,
            },
          },
        ],
      },
      {
        id: "funding",
        heading: "Adding funds",
        blocks: [
          {
            kind: "paragraph",
            text: "Resonate settles payments in stablecoins (a digital dollar such as USDC) so prices stay steady. Add funds from the Wallet page, then your balance is ready for Marketplace purchases and Shows pledges.",
          },
          {
            kind: "callout",
            tone: "note",
            title: "Network fees are usually covered",
            text: "Resonate sponsors the small network fee ('gas') for most actions, so you can transact without holding a separate fee token.",
          },
        ],
      },
      {
        id: "security",
        heading: "Security & recovery",
        blocks: [
          {
            kind: "list",
            items: [
              "Passkey signer — your passkey is what authorizes transactions.",
              "Recovery — you can add trusted recovery options so you never lose access if a device is gone.",
              "Spending caps — when you let an AI agent spend on your behalf, you set a budget cap it can never exceed.",
            ],
          },
        ],
      },
      {
        id: "stakes",
        heading: "Stakes",
        blocks: [
          {
            kind: "paragraph",
            text: "If you are an artist, the Wallet also surfaces stakes tied to content protection — funds you lock to back the authenticity of your releases. Each row shows the deposit, when it was placed, and whether its escrow period is still running. Resonate returns the deposit once that period ends; there is no withdraw button to press. See Rights & content protection for how stakes and trust tiers work.",
          },
        ],
      },
    ],
    appLinks: [
      { label: "Open your wallet", href: "/wallet", description: "Balance, funding, security, and stakes." },
    ],
    related: ["getting-started", "marketplace-buy", "shows-back", "rights-protection"],
  },

  // ─────────────────────────── Discover & listen ──────────────────────────
  {
    slug: "discover-music",
    title: "Discover & browse music",
    summary:
      "Find new releases and stems from the home page, by mood, or in the full catalog — with personalized picks and clear AI-contribution labels.",
    category: "discover",
    audiences: ["listener"],
    status: "partial",
    keywords: ["discover", "home", "browse", "catalog", "trending", "top artists", "charts", "mood", "vibe", "search", "recommended", "feed", "personalized", "explore", "exploration", "genre", "playlists", "stems", "recently added", "cover art", "ai-assisted", "ai-generated", "ai disclosure", "badge", "tuner", "energy", "stem lab", "mixer", "solo", "live events", "shows", "studio"],
    sections: [
      {
        id: "home",
        heading: "The Discover home page",
        blocks: [
          {
            kind: "paragraph",
            text: "Home is your starting point. A featured Shows campaign sits at the top (when none is open for pledges, you'll see an invitation to start one instead), followed by the Tuner — genre and mood chips with a small energy meter — then your personalized feed as a set of shelves like \"Because you save a lot of Afrobeat\", \"New from artists you play\", and \"Trending in your genre\". Each shelf says in plain words why it's there, and the reasons are always about your taste in general (a genre you save, artists you play), never a list of exactly what you played and when.",
          },
          {
            kind: "paragraph",
            text: "Every section below the top banner is a shelf: swipe it sideways on a phone, or use the arrow buttons that appear on a computer when there's more to see. On a personalized pick, the round AI DJ button starts a session seeded by that track (on a phone it's always shown; on a computer it appears when you point at the cover).",
          },
          {
            kind: "paragraph",
            text: "Every visit also includes a small \"Step outside your lanes\" row of fresh, barely-played tracks so your feed never becomes an echo chamber, and rows rotate between visits instead of repeating the same picks. If you're new and we don't know your taste yet, the feed says \"Catalog signal\" honestly — play a few tracks or save a genre and it gets personal.",
          },
          {
            kind: "figure",
            figure: {
              src: `${SHOT}/discover-home.png`,
              alt: "The Discover home page with a featured 'Aya Nakamura in Montréal' campaign over its banner artwork, a rail of other campaigns with their funding progress, a row of trending and mood chips, and the Recently Added grid of release cover art.",
              caption: "Discover while signed out: a featured Shows campaign, trending and mood chips, and the Recently Added catalog snapshot. Signed in, your personalized rows appear under the chips.",
              width: 1440,
              height: 1200,
              source: STAGING,
            },
          },
        ],
      },
      {
        id: "trending",
        heading: "Trending Now & Top Artists",
        blocks: [
          {
            kind: "paragraph",
            text: "The Trending Now and Top Artists rails rank tracks and artists by what listeners actually played over the last 7 days — completed listens and playlist saves, not upload dates. Each card shows its chart position and how many people listened.",
          },
          {
            kind: "paragraph",
            text: "These charts are honest: if not enough different people have listened yet (overall or in a genre you selected), the rail says \"not enough listening yet\" instead of showing a made-up ranking. Charts fill in as the community listens more.",
          },
          {
            kind: "paragraph",
            text: "Artist links follow the credited profile when the music has a clear artist identity. If a credit could refer to more than one artist, it opens a catalog page for the credited name until the identity is reviewed.",
          },
        ],
      },
      {
        id: "mood",
        heading: "Browse by mood & vibe",
        blocks: [
          {
            kind: "paragraph",
            text: "Use the Tuner near the top of Home: tap a genre chip (Electronic, Hip-Hop, Jazz, and more) or a mood chip (Focus, Hype, Chill, Late Night, and more). The Tuner tells you how many catalog releases match, its energy meter shows the pace of that pick, and the Start session button begins a vibe session that queues matching tracks and hands off to your AI DJ. With \"All Trending\" selected, the same spot opens the AI DJ instead. Genre chips also re-rank Trending Now and Top Artists for that genre, and the shelves below retune to your pick.",
          },
        ],
      },
      {
        id: "home-sections",
        heading: "Stem Lab, live events & your studio",
        blocks: [
          {
            kind: "paragraph",
            text: "Stem Lab shows real releases whose tracks have been split into separate layers. Each release has a small channel strip — Vocals, Drums, Bass, and so on, only the layers that actually exist. Select a channel to open the release in the mixer with just that layer playing, or choose Open mixer to hear everything and balance it yourself. The mixer needs a connected wallet; signed out, the link opens the release page.",
          },
          {
            kind: "paragraph",
            text: "Upcoming Live Events lists fan-funded shows as ticket-style cards: the show date, the venue or city, a funding bar with the percentage raised, the number of backers, and the days left to pledge. Selecting a card opens the campaign page, where you can review the terms before backing it. Pledges are held in escrow and refunded if the goal isn't met.",
          },
          {
            kind: "paragraph",
            text: "Further down, Recently Added lets you browse and search the newest catalog releases, artists, stems, and playlists, and Your studio shows the artists and releases you manage once your wallet is connected.",
          },
        ],
      },
      {
        id: "catalog",
        heading: "The full catalog",
        blocks: [
          {
            kind: "paragraph",
            text: "Open Catalog to browse the latest public releases, their stems, and public playlists curated by other listeners. Switch between Releases, Artists, Stems, and Playlists, and search by title, artist, stem, or playlist name. Opening a playlist card lets you press Play or add the whole playlist to your library.",
          },
          {
            kind: "paragraph",
            text: "Releases appear as a grid of cover art with the title, the credited artist, and the release type, genre, and when it was added. Hover over a cover and press its play button to start listening right away (on a phone the play button is always shown); select the title to open the full release page. Any AI-contribution label stays visible under each release. Use the genre chips above the grid to narrow releases to one genre — they work together with search.",
          },
          {
            kind: "paragraph",
            text: "Artists show their latest cover, how many releases and stems they have, and their main genre. Stems are grouped by track: each row lists the parts that track offers (Full mix, Vocals, Drums, Bass, and so on) and opens the release mixer. The Recently Added section on the home page shows a smaller preview with the same cards, plus buttons to add a release to a playlist or save it to your library.",
          },
          {
            kind: "figure",
            figure: {
              src: `${SHOT}/catalog.png`,
              alt: "The catalog page titled 'Browse recent catalog' with a search field, tabs for Releases, Artists, Stems, and Playlists, a row of genre chips, and a grid of release cover art.",
              caption: "Catalog: search and filter recent releases, artists, stems, and public playlists.",
              width: 1440,
              height: 900,
              source: STAGING,
            },
          },
        ],
      },
      {
        id: "ai-disclosure",
        heading: "Understanding AI labels",
        blocks: [
          {
            kind: "definitions",
            items: [
              {
                term: "AI-assisted",
                description: "The artist declared that AI contributed to part of the track, such as vocals, instruments, writing, production, or post-production.",
              },
              {
                term: "AI-generated",
                description: "The artist or Resonate's own creation tools declared that the track was fully AI-generated.",
              },
              {
                term: "AI disclosure unavailable",
                description: "The track is older or its declaration is incomplete. This does not mean Resonate verified it as human-made.",
              },
            ],
          },
          {
            kind: "paragraph",
            text: "Fully AI-generated tracks stay available through the catalog, search, artist pages, playlists, direct links, playback, and the Marketplace. They are not placed in personalized recommendations, AI DJ picks, Trending, or the activity used to rank Top Artists. AI-assisted tracks remain eligible for those discovery surfaces and keep their label.",
          },
          {
            kind: "callout",
            tone: "note",
            title: "Labels are declarations",
            text: "A label records the disclosed creative process. Automated detection, declaration disputes, enforcement, and appeals are still being developed.",
          },
        ],
      },
    ],
    appLinks: [
      { label: "Discover", href: "/", description: "Featured, trending, and recommended music." },
      { label: "Browse the catalog", href: "/catalog", description: "Recent releases, artists, stems, and public playlists." },
    ],
    related: ["playing-music", "ai-dj", "library-playlists"],
  },
  {
    slug: "playing-music",
    title: "Playing music & the Now Playing console",
    summary:
      "Play any track and use the Now Playing console to manage a fair persistent queue, mute or go immersive, save tracks, inspect stems, and take available actions.",
    category: "discover",
    audiences: ["listener"],
    keywords: ["A–B", "passage", "finite repeats", "save queue", "play", "player", "now playing", "queue", "shuffle", "mute", "fullscreen", "immersive", "controls", "keyboard", "screen reader", "accessibility", "stem", "listen", "playback", "saved", "live sync", "shows", "campaign", "support a show", "ai-assisted", "ai-generated", "ai disclosure", "badge", "share", "broadcast signal"],
    sections: [
      {
        id: "playing",
        heading: "Start playing",
        blocks: [
          {
            kind: "paragraph",
            text: "Press play on any track in Discover, the catalog, a release page, or your library. The Player opens a Now Playing console with full transport controls and your live queue.",
          },
          {
            kind: "figure",
            figure: {
              src: `${SHOT}/player.png`,
              alt: "The Player page with a large play control, progress and output sliders, a 'Queue Manifest' panel, and broadcast/sharing actions.",
              caption: "The Now Playing console: transport controls, queue, and per-track actions.",
              width: 1440,
              height: 900,
              source: STAGING,
            },
          },
        ],
      },
      {
        id: "queue-controls",
        heading: "Build and control your listening session",
        blocks: [
          {
            kind: "figure",
            figure: {
              src: `${SHOT}/player-listening-controls.png`,
              alt: "The player with queue saving, a five-to-ten-second passage loop, and one additional track repeat configured.",
              caption: "Loop and repeat controls with a sample listening queue.",
              width: 1440,
              height: 1100,
              source: LOCAL,
            },
          },
          {
            kind: "list",
            items: [
              "Use Play next or Add to queue on a track, selected tracks, an album, or a playlist. Multi-track additions keep their displayed order and already-queued tracks are skipped.",
              "Shuffle plays every eligible queued track once before Repeat All begins another cycle. Tracks added during shuffle join the current cycle.",
              "Choose Save queue as playlist beside Queue Manifest to keep the whole queue in its displayed order, including tracks already played. Give it a name and folder. An unchanged playlist offers View playlist instead; changing its queue lets you save a new playlist without overwriting the original. Review any tracks that cannot be saved before confirming.",
              "Open Loop and repeat in the player bar or full player. Set A and B in seconds, or mark your current position with Set A here and Set B here, then choose Loop passage. Seeking stays within that passage until you clear it; changing tracks clears the loop.",
              "Choose Current track or Entire queue and a number of additional repeats. One additional repeat means one replay after the current pass. The remaining count changes only at a natural track end or complete queue cycle. Passage loops pause that count. You can update or cancel repeats, and selecting an infinite repeat mode replaces the finite plan.",
              "Skipping to another track cancels a track repeat plan. Replacing or clearing the queue cancels a queue repeat plan. Repeat plans stay active while navigating the app, but do not carry into a new browser session.",
              "Select the sound icon to mute; select it again to restore your previous volume. The slider stays synchronized.",
              "With a keyboard, use Tab to reach named playback controls and the position or volume sliders, then use the arrow keys to adjust a slider. A Skip to main content link appears when it receives focus, and the current navigation page and open playlist panel are announced to assistive technology.",
              "Open immersive mode from the Player for artwork, track details, controls, volume, and queue access. Use the visible control or Escape to leave it without losing your place.",
              "Signed-in listeners see Saved in green when the current track is already in their library. Select Saved to remove it again.",
            ],
          },
        ],
      },
      {
        id: "actions",
        heading: "Actions while you listen",
        blocks: [
          {
            kind: "list",
            items: [
              "Save the track to your library or add it to a playlist.",
              "Inspect the track's stems to hear the individual parts.",
              "Check the AI-contribution badge without leaving the player.",
              "Open licensing actions when a stem is available to collect or license in the Marketplace.",
              "Support a show when the playing artist has a live campaign; the chip opens the campaign page so you can review the details before pledging.",
              "Share what you are playing from Broadcast Signal. The link opens the track's release page, with its cover in the preview. Only tracks published on Resonate can be shared; files from your device cannot.",
            ],
          },
          {
            kind: "callout",
            tone: "note",
            title: "Live sync & AI DJ",
            text: "When the console shows it is an active device, a trusted AI DJ session can queue and start playback for you — and you always confirm before sound starts.",
          },
          {
            kind: "callout",
            tone: "note",
            title: "Fully AI-generated music",
            text: "You can still open and play fully AI-generated tracks directly. The AI DJ does not choose them as its next promoted pick.",
          },
        ],
      },
    ],
    appLinks: [
      { label: "Open the Player", href: "/player", description: "The Now Playing console." },
    ],
    related: ["discover-music", "ai-dj", "marketplace-buy", "shows-back", "library-playlists"],
  },
  {
    slug: "ai-dj",
    title: "AI DJ & Sonic Radar",
    summary:
      "Let an AI DJ build a continuous session around a mood or goal, and use Sonic Radar to surface fresh, AI-curated discoveries.",
    category: "discover",
    audiences: ["listener"],
    status: "partial",
    keywords: ["ai dj", "agent", "session", "sonic radar", "recommendations", "neural flow", "pulse raid", "taste", "discovery", "next pick", "ai-generated", "ai disclosure"],
    sections: [
      {
        id: "sessions",
        heading: "AI DJ sessions",
        blocks: [
          {
            kind: "paragraph",
            text: "The AI DJ plays a continuous set tailored to you. Pick a session intent — for example a focused flow for deep work or a high-energy set — and the DJ keeps choosing what comes next, explaining why each pick fits.",
          },
          {
            kind: "steps",
            items: [
              "Open AI DJ and connect if you haven't already.",
              "The first time, give your DJ a name to set up your agent.",
              "Choose a session intent or a mood to set the direction.",
              "Press play — use Next AI Pick to skip ahead, and your feedback shapes future picks.",
            ],
          },
          {
            kind: "callout",
            tone: "note",
            title: "What the AI DJ promotes",
            text: "The AI DJ can recommend human-made and AI-assisted tracks. Tracks declared fully AI-generated stay available for direct listening but are not selected as promoted AI DJ picks.",
          },
          {
            kind: "figure",
            figure: {
              src: `${SHOT}/ai-dj.png`,
              alt: "The AI DJ setup dialog headed 'Name Your DJ' with a text field and a Next button, explaining the DJ will curate, negotiate, and remix tracks for you in real time.",
              caption: "Setting up your AI DJ the first time you open it.",
              width: 1440,
              height: 900,
              source: LOCAL,
            },
          },
        ],
      },
      {
        id: "sonic-radar",
        heading: "Sonic Radar",
        blocks: [
          {
            kind: "paragraph",
            text: "Sonic Radar is your discovery dashboard — AI-curated releases and stems chosen from across the catalog so you keep finding music outside your usual rotation.",
          },
          {
            kind: "figure",
            figure: {
              src: `${SHOT}/sonic-radar.png`,
              alt: "The Sonic Radar page with a radar icon, the heading 'Sonic Radar', a description of AI-curated discoveries, and a 'No discoveries yet' empty state with a 'Launch AI DJ' button.",
              caption: "Sonic Radar before your first session — launch the AI DJ to start filling it.",
              width: 1440,
              height: 900,
              source: LOCAL,
            },
          },
          {
            kind: "callout",
            tone: "tip",
            title: "You control what trains your taste",
            text: "Whether AI DJ playback trains your taste profile is up to you. Manage it any time under Settings → privacy. See Settings & privacy controls.",
          },
        ],
      },
    ],
    appLinks: [
      { label: "AI DJ", href: "/agent", description: "Start an AI-guided listening session." },
      { label: "Sonic Radar", href: "/sonic-radar", description: "AI-curated discoveries." },
    ],
    related: ["discover-music", "playing-music", "settings-privacy"],
  },
  {
    slug: "library-playlists",
    title: "Your library & playlists",
    summary:
      "Save tracks to your library, organize them into playlists, and share a playlist publicly — by link or in the global catalog.",
    category: "library",
    audiences: ["listener"],
    keywords: ["library", "playlist", "save", "remove", "bulk remove", "collection", "share", "public playlist", "folders", "favorites", "discover", "catalog"],
    sections: [
      {
        id: "library",
        heading: "Your library",
        blocks: [
          {
            kind: "paragraph",
            text: "Your library is everything you have saved. Save a track from Discover, a release page, the catalog, or the Player, and it appears here ready to play.",
          },
          {
            kind: "paragraph",
            text: "To remove saved music, open a track's More actions menu, or the menu on an artist or album card. Confirm the number of tracks to remove. You can also select several tracks and use Remove from library. If removal fails, your library stays as it was and shows an error. A track you remove also leaves your play queue. A removed local file stays on your device but will not return on the next folder scan. Owned stems stay in your library while you hold them; removing saved music does not affect purchases or playlists.",
          },
          {
            kind: "paragraph",
            text: "Artist and album pages inside My Library are private groupings built from your saved or device-local music metadata. Their My Library label distinguishes them from public Resonate profiles and catalog-credit pages, even when the names happen to match.",
          },
          {
            kind: "paragraph",
            text: "For music saved from Resonate, use View catalog release or View Resonate profile to move from your private grouping to its public page. Public releases you have saved show Open in My Library. Device-only or mixed artist groupings use Explore in catalog, so a matching name is never presented as proof that two artists are the same person.",
          },
          {
            kind: "figure",
            figure: {
              src: `${SHOT}/library.png`,
              alt: "My Library with saved tracks and an open More actions menu offering Remove from library.",
              caption: "Open a saved track's menu to remove it, or select several tracks for bulk removal.",
              width: 1440,
              height: 900,
              source: LOCAL,
            },
          },
        ],
      },
      {
        id: "playlists",
        heading: "Building playlists",
        blocks: [
          {
            kind: "steps",
            items: [
              "Open the Add to playlist action on any track.",
              "Create a new playlist or add the track to an existing one.",
              "Reorder and manage tracks from the Playlists tab in your library.",
            ],
          },
        ],
      },
      {
        id: "sharing",
        heading: "Sharing a playlist",
        blocks: [
          {
            kind: "paragraph",
            text: "Playlists are private by default. Flip a playlist to public and anyone with the link can listen and save it to their own library as a live reference — when you edit the playlist, their copy updates too.",
          },
          {
            kind: "paragraph",
            text: "Public playlists are also discoverable: once a public playlist has at least one track that's available in the catalog, it appears in the Playlists tab of the global catalog so other listeners can find it without a link. Flip it back to private and it leaves the catalog again.",
          },
          {
            kind: "callout",
            tone: "note",
            title: "Private stays private",
            text: "Making one playlist public never exposes your other playlists or how you've organized your library. Device-only files in a shared playlist show as unavailable to others and don't make a playlist eligible for the catalog on their own.",
          },
        ],
      },
      {
        id: "unavailable-tracks",
        heading: "When a track is greyed out",
        blocks: [
          {
            kind: "paragraph",
            text: "A track in your library or a playlist can show as unavailable — most often because the artist has withdrawn it from streaming. It stays where you put it, greyed out and labelled with the reason, instead of disappearing on you. It cannot be played and it is skipped when you play the playlist, and it starts working again if the artist puts it back.",
          },
          {
            kind: "callout",
            tone: "note",
            title: "What you bought stays yours",
            text: "Purchases are not affected. A stem or a moment you own stays playable whatever happens to the streaming version.",
          },
        ],
      },
    ],
    appLinks: [
      { label: "Your library", href: "/library", description: "Saved tracks and folders." },
      { label: "Playlists", href: "/library?tab=playlists", description: "Create, manage, and share playlists." },
      { label: "Browse the catalog", href: "/catalog", description: "Find public playlists from other listeners." },
    ],
    related: ["playing-music", "discover-music", "withdraw-a-release"],
  },

  // ─────────────────────────── Collect & sell ─────────────────────────────
  {
    slug: "marketplace-buy",
    title: "Browse & collect stems",
    summary:
      "Preview and collect licensed audio stems from artists worldwide, choosing the license tier that fits how you'll use them.",
    category: "marketplace",
    audiences: ["listener", "producer"],
    keywords: ["marketplace", "buy", "collect", "stem", "license", "personal", "remix", "commercial", "purchase", "checkout", "x402", "receipt", "nft"],
    sections: [
      {
        id: "browse",
        heading: "Browsing the Marketplace",
        blocks: [
          {
            kind: "paragraph",
            text: "The Marketplace lists individual stems — vocals, drums, bass, melody, and more — that artists have put up for sale. Filter by part or artist, sort, and preview before you buy.",
          },
          {
            kind: "figure",
            figure: {
              src: `${SHOT}/marketplace.png`,
              alt: "The Marketplace titled 'Own the stems.' with a search bar, part filters (Vocals, Drums, Bass, Melody, Guitar, Piano), and a grid of stem listing cards.",
              caption: "Marketplace: filter by part or artist and preview a stem before collecting it.",
              width: 1440,
              height: 900,
              source: STAGING,
            },
          },
        ],
      },
      {
        id: "license-tiers",
        heading: "Choosing a license tier",
        blocks: [
          {
            kind: "paragraph",
            text: "Each listing is sold under a license tier that defines what you may do with it:",
          },
          {
            kind: "definitions",
            items: [
              { term: "Personal", description: "Listen and enjoy the stem for your own private use." },
              { term: "Remix", description: "Use the stem to create a remix — this is the tier that unlocks Remix Studio for that stem." },
              { term: "Commercial", description: "Broader rights for commercial projects, where the artist offers it — this tier also lets you export and download a remix you build from the stem in Remix Studio." },
            ],
          },
          {
            kind: "callout",
            tone: "tip",
            title: "Buying to remix?",
            text: "Pick the Remix tier. A remix-tier purchase is what gives you permission to open the stem in Remix Studio.",
          },
        ],
      },
      {
        id: "checkout",
        heading: "Paying",
        blocks: [
          {
            kind: "steps",
            items: [
              "Open a listing and choose its license tier.",
              "Choose x402 or direct wallet checkout when both are available. In x402 checkout, review the platform fee marked as included and the unchanged stablecoin total.",
              "Confirm the total and pay from your wallet balance. Resonate disables payment if it cannot verify the current quote details.",
              "Approve with your passkey — your collected stem and receipt appear in your wallet and library.",
            ],
          },
        ],
      },
    ],
    appLinks: [
      { label: "Open the Marketplace", href: "/marketplace", description: "Browse and collect stems." },
    ],
    related: ["smart-wallet", "remix-studio", "marketplace-sell"],
  },
  {
    slug: "marketplace-sell",
    title: "List & manage your stems",
    summary:
      "Put your stems up for sale, choose a license tier and price, and manage active, expiring, sold, and relistable listings from one workspace.",
    category: "marketplace",
    audiences: ["artist"],
    status: "partial",
    keywords: ["sell", "list", "listing", "mint", "manage listings", "relist", "expire", "price", "license tier", "marketplace", "payout", "verified human", "eligible for payouts"],
    sections: [
      {
        id: "listing",
        heading: "Listing a stem",
        blocks: [
          {
            kind: "steps",
            items: [
              "From a stem on one of your releases, choose List for sale (or use Mint & list in the Marketplace).",
              "Pick the license tier buyers will receive — personal, remix, or commercial.",
              "Set the price (prefilled from your catalog price when available) and confirm.",
            ],
          },
          {
            kind: "paragraph",
            text: "Before you confirm, Resonate estimates what you receive after the current marketplace platform fee and the stem royalty. Those percentages come from the marketplace and listing data shown in the app.",
          },
          {
            kind: "callout",
            tone: "note",
            title: "Remix-tier listings power Remix Studio",
            text: "When you list a stem at the remix tier, buyers of that listing can open it in Remix Studio.",
          },
          {
            kind: "callout",
            tone: "note",
            title: "Payouts need a verified-human account",
            text: "Because a sale sends money to you, minting a stem for sale requires your account to be human-verified and your catalog rights to allow payouts. Run the human-verification check on your artist profile first; if you're not eligible yet, the app tells you exactly what's missing.",
          },
        ],
      },
      {
        id: "manage",
        heading: "Managing your listings",
        blocks: [
          {
            kind: "paragraph",
            text: "Open Manage listings for a seller workspace that shows active, expiring, expired, sold, and cancelled listings with artwork and inventory summaries. You'll get reminders before listings expire.",
          },
          {
            kind: "list",
            items: [
              "Relist an eligible expired or cancelled listing in one step.",
              "Use batch relist to bring several listings back at once.",
              "Search your inventory and review what has sold.",
            ],
          },
        ],
      },
    ],
    appLinks: [
      { label: "Marketplace", href: "/marketplace", description: "Public listings and the Mint & list flow." },
      { label: "Manage listings", href: "/marketplace/manage", description: "Your seller workspace." },
    ],
    related: ["marketplace-buy", "upload-music", "artist-analytics"],
  },

  // ─────────────────────────── Create & remix ─────────────────────────────
  {
    slug: "create-ai-music",
    title: "Create music with AI",
    summary:
      "Generate original tracks from a text prompt and publish them to your catalog, with AI provenance recorded automatically.",
    category: "create",
    audiences: ["artist"],
    keywords: ["create", "generate", "ai music", "lyria", "prompt", "text to music", "publish", "generation", "credits"],
    sections: [
      {
        id: "generate",
        heading: "Generating a track",
        blocks: [
          {
            kind: "steps",
            items: [
              "Open Create and connect if needed.",
              "Describe the music you want — genre, mood, instruments, tempo.",
              "Pick a duration and an optional style preset.",
              "Generate, preview the result, and refine your prompt until you're happy.",
            ],
          },
          {
            kind: "figure",
            figure: {
              src: `${SHOT}/create.png`,
              alt: "The 'Create with AI' page with a prompt text area describing a track, duration options (30s, 1 min, 2 min, 3 min), and style presets such as Lo-fi Chill, Afrobeat, Ambient, Funk, and Jazz.",
              caption: "Create: describe the track, choose a length and style, and generate.",
              width: 1440,
              height: 900,
              source: LOCAL,
            },
          },
          {
            kind: "callout",
            tone: "note",
            title: "Generating uses credits",
            text: "AI generation runs on prepaid credits — longer tracks cost more. The Credits meter above the Generate button shows roughly how much generation you have left (in minutes and tracks) and updates after each track. New accounts start with a small free allowance so you can try it right away. Once that runs out, generation is blocked with a message; ask an operator for a credit grant to top up. Refined-away or failed generations are not charged.",
          },
          {
            kind: "callout",
            tone: "tip",
            title: "Out of credits? Ask an operator",
            text: "When generation is blocked for low credits, the message includes a Request credits from an operator button. Tap it to notify an operator, who can top up your balance — you'll get a confirmation that they've been notified.",
          },
        ],
      },
      {
        id: "publish",
        heading: "Publishing",
        blocks: [
          {
            kind: "paragraph",
            text: "When you publish, the track becomes a release in your catalog. Because Resonate generated it, the AI provenance is recorded for you — you don't need to provide separate proof-of-ownership evidence.",
          },
          {
            kind: "callout",
            tone: "note",
            title: "Honest AI labelling",
            text: "AI-generated and AI-assisted music is labelled as such on its release page so listeners always know what they're hearing.",
          },
        ],
      },
    ],
    appLinks: [
      { label: "Create", href: "/create", description: "Generate music with AI." },
      { label: "Your catalog", href: "/artist/catalog", description: "Where published tracks appear." },
    ],
    related: ["upload-music", "remix-studio", "rights-protection"],
  },
  {
    slug: "remix-studio",
    title: "Remix Studio",
    summary:
      "Turn stems you're licensed to remix into something new — mix the source parts, add AI-generated layers, and publish a credited remix.",
    category: "create",
    audiences: ["producer", "artist", "listener"],
    status: "partial",
    keywords: ["remix", "studio", "stems", "license", "generate", "mix", "publish", "derivative", "ai", "sell", "list", "marketplace"],
    sections: [
      {
        id: "eligibility",
        heading: "What you need to remix",
        blocks: [
          {
            kind: "paragraph",
            text: "Remix Studio opens for a stem only when you have the right to remix it. In practice that means you bought the stem at the remix license tier (or settled a remix-tier listing), the source is in good standing, and the artist allows remixing.",
          },
          {
            kind: "callout",
            tone: "tip",
            title: "If the Remix button is greyed out",
            text: "It will tell you why — usually that a remix license is required. Collect the stem at the remix tier in the Marketplace to unlock it.",
          },
        ],
      },
      {
        id: "studio",
        heading: "Working in the studio",
        blocks: [
          {
            kind: "list",
            items: [
              "Your session opens with every stem of the track you're licensed for — the one you started from plays, and the rest wait muted until you bring them in.",
              "Each stem gets one row in the Session view: mute, solo, and level on the left, and its waveform across the song on the right. The track's measured tempo and key show once, next to the title.",
              "Switch a stem on or off per section of the song by clicking the cells over its waveform \u2014 or drag across several cells to paint them at once. Drop the drums out for a verse, bring them back for the chorus.",
              "Use the transport bar to play and stop, click the timeline to jump, and click a section's number to loop it while you work on it. Your changes are heard right away.",
              "The transport's source switch plays your Arrangement, your latest Draft, or the Original track, so you can compare them at the same point in the song.",
              "If the track's full original mix is in your session, it stays out of the mix (it already contains every part) and is used only for that comparison.",
              "Your edits save automatically. The preview runs through a limiter so stacking many stems doesn't distort, and starting it pauses the main player.",
              "Shortcuts: Space plays or stops, M and S mute or solo the row you're on, and Esc clears a loop.",
              "The \"Also on this track\" list shows the track's remaining stems: licensed ones join your session with one click, and the others link to their license page.",
              "Write a prompt describing the direction you want.",
              "In Variation mode, pick an AI target: reshape the whole track, add one new layer on top, or replace a single stem with an AI-generated part while the rest of your mix stays untouched.",
              "Generate a draft that keeps your licensed stems and layers new AI-generated parts on top, clearly labelled as AI-assisted.",
              "The first AI draft after a quiet period may take a few minutes while the generation service wakes up; later drafts are usually much faster.",
              "Preview drafts and keep refining; your work saves as a private draft. Regenerating keeps your previous drafts \u2014 play any version to compare before you publish.",
            ],
          },
        ],
      },
      {
        id: "publish",
        heading: "Publishing a remix",
        blocks: [
          {
            kind: "paragraph",
            text: "When a draft is ready, publish it as a remix release in your catalog. Resonate re-checks your rights at publish time and attaches the source lineage (which tracks and stems it came from) plus the AI-provenance label to the new release.",
          },
        ],
      },
      {
        id: "sell",
        heading: "Listing your remix for sale",
        blocks: [
          {
            kind: "paragraph",
            text: "A published remix can become a sellable item in the Marketplace, so the remix you created can earn — you keep the artist's share, just like any other sale. On the \"Published\" panel in the studio, use \"List this remix for sale\" to jump to your release page, where you protect the release and then mint and list it as an ownership item other people can buy.",
          },
          {
            kind: "callout",
            tone: "tip",
            title: "If “List this remix for sale” is locked",
            text: "Selling a remix needs the commercial license tier on every source stem you used (or you own the source artist). The button tells you when a commercial license is what's missing — collect those stems at the commercial tier in the Marketplace to unlock it.",
          },
        ],
      },
      {
        id: "export",
        heading: "Exporting your remix",
        blocks: [
          {
            kind: "paragraph",
            text: "Once a draft is finished and saved, you can download it as an audio file to use off Resonate. Export needs the commercial license tier on the stems you're remixing — a remix license lets you make private drafts and publish inside Resonate, and the commercial tier adds the right to download and use the audio elsewhere.",
          },
          {
            kind: "callout",
            tone: "tip",
            title: "If the Export button is locked",
            text: "It will tell you why — usually that a commercial license is required. Collect the stems at the commercial tier in the Marketplace to unlock downloading.",
          },
          {
            kind: "callout",
            tone: "note",
            title: "What's still rolling out",
            text: "In-app remixing, publishing, commercial-licensed export, and listing a published remix for sale are all live. Recursive royalties that also pay the original artist when your remix resells are on the way; voice or likeness cloning is intentionally not supported.",
          },
        ],
      },
    ],
    appLinks: [
      { label: "Browse the catalog", href: "/catalog", description: "Open a release or stem to find its Remix button." },
      { label: "Marketplace", href: "/marketplace", description: "Collect a remix-tier stem to get started." },
    ],
    related: ["marketplace-buy", "marketplace-sell", "create-ai-music", "rights-protection"],
  },

  // ───────────────────────────── For artists ──────────────────────────────
  {
    slug: "upload-music",
    title: "Upload & publish your music",
    summary:
      "Upload tracks, declare how AI contributed to each one, credit the right artists, and publish with content protection.",
    category: "artists",
    audiences: ["artist"],
    status: "partial",
    keywords: ["upload", "publish", "release", "stems", "separation", "credits", "featured artist", "mood tags", "metadata", "demucs", "ai-assisted", "ai-generated", "ai disclosure", "human-made", "contribution"],
    sections: [
      {
        id: "upload",
        heading: "Uploading a track",
        blocks: [
          {
            kind: "steps",
            items: [
              "Open Upload and connect your account.",
              "Add your audio file and cover art.",
              "Resonate processes the track and separates it into stems (vocals, drums, bass, and more) automatically.",
            ],
          },
          {
            kind: "figure",
            figure: {
              src: `${SHOT}/upload.png`,
              alt: "The Upload page with a 'Drop audio files here or browse' drop zone supporting MP3/WAV/FLAC/AIFF, and a Release Settings panel with release type, artwork, release title, primary artist, and genre fields plus a Publish release button.",
              caption: "The upload studio: drop your audio on the left, fill in release details on the right.",
              width: 1440,
              height: 900,
              source: LOCAL,
            },
          },
        ],
      },
      {
        id: "ai-disclosure",
        heading: "Declare AI involvement for each track",
        blocks: [
          {
            kind: "paragraph",
            text: "Before publishing a new upload, choose Human-made, AI-assisted, or Fully AI-generated for every track. For a multi-track release, you can apply one choice to all tracks and then adjust individual tracks.",
          },
          {
            kind: "definitions",
            items: [
              {
                term: "Human-made",
                description: "Choose this when you are declaring that AI did not contribute to the track.",
              },
              {
                term: "AI-assisted",
                description: "Choose this when AI contributed to part of the track, then select at least one affected area: vocals, instruments, writing, production, or post-production.",
              },
              {
                term: "Fully AI-generated",
                description: "Choose this when the whole recording was generated with AI.",
              },
            ],
          },
          {
            kind: "callout",
            tone: "note",
            title: "What a fully AI-generated declaration changes",
            text: "The track can still appear in the catalog and Marketplace and can still be opened and played directly. It will carry an AI-generated label and will not be promoted in recommendations, AI DJ, Trending, or Top Artists.",
          },
          {
            kind: "callout",
            tone: "tip",
            title: "Resonate-created music is labeled automatically",
            text: "When Resonate's own creation tools already know the track's origin, they record the AI declaration for you. Published remixes derive their label from how the remix was created.",
          },
        ],
      },
      {
        id: "credits",
        heading: "Crediting artists",
        blocks: [
          {
            kind: "paragraph",
            text: "Add the primary artist, track artist, and any featured artists. Choose the exact existing profile when Resonate suggests one, especially if several artists share a name. If several artists share the name, the list shows how many and a short ID beside each one — pick the right one, or add a new artist, which is held for review before it links to a profile. Your selected primary artist stays linked to that exact profile when you upload.",
          },
          {
            kind: "callout",
            tone: "tip",
            title: "Tag the mood",
            text: "Add mood tags so your release surfaces in mood browsing and the AI DJ can match it to the right sessions.",
          },
        ],
      },
      {
        id: "publish",
        heading: "Rights & publishing",
        blocks: [
          {
            kind: "paragraph",
            text: "Publishing uses a release-specific route. You may self-attest provenance for an upload, but self-attestation is not independent rights verification. Depending on account trust and release signals, Resonate may publish with limited monitoring, request evidence, or route the release for review. Marketplace access and payout eligibility remain gated by the release's rights state; account verification alone does not clear release rights.",
          },
          {
            kind: "paragraph",
            text: "After publishing, open Your catalog to follow processing. Release and track statuses update while the page is open, including failures. The catalog checks again when you return to the tab, so you do not need to reload it to see the latest result.",
          },
          {
            kind: "figure",
            figure: {
              src: `${SHOT}/artist-catalog.png`,
              alt: "The Managed Catalog page for Test Artist showing one ready release, one track, three resources, and a release inventory row for Test Release.",
              caption: "Managed Catalog: review release status, track counts, resources, and rights routing after publishing.",
              width: 1440,
              height: 900,
              source: LOCAL,
            },
          },
        ],
      },
    ],
    appLinks: [
      { label: "Upload", href: "/artist/upload", description: "Upload and publish a release." },
      { label: "Your catalog", href: "/artist/catalog", description: "Manage your releases and tracks." },
    ],
    related: ["rights-protection", "marketplace-sell", "artist-analytics", "create-ai-music"],
  },
  {
    slug: "artist-profile",
    title: "Your artist page",
    summary:
      "Edit a profile you manage, or request access to a credited artist profile from Artist management.",
    category: "artists",
    audiences: ["artist", "operator"],
    status: "available",
    keywords: ["artist", "profile", "page", "bio", "image", "avatar", "social", "links", "website", "edit", "AI suggestions", "MusicBrainz", "claim", "claim review", "evidence", "manager", "invite", "notification", "transfer", "recovery", "replace audio", "track audio", "audio replacement"],
    sections: [
      {
        id: "edit",
        heading: "Editing your profile",
        blocks: [
          {
            kind: "paragraph",
            text: "Open your artist page and, when you have access, you'll see an \"Edit profile\" button. Use it to set your profile image, a short bio, your website, and links to your social accounts (X, Instagram, TikTok, YouTube, SoundCloud). Other visitors see the page read-only.",
          },
          {
            kind: "callout",
            tone: "tip",
            title: "Use full web addresses",
            text: "Paste complete links (for example https://instagram.com/yourname). Anything that isn't a normal web address is rejected so your page stays safe to click.",
          },
        ],
      },
      {
        id: "suggest",
        heading: "Suggesting profile information",
        blocks: [
          {
            kind: "paragraph",
            text: "While editing a profile you manage, choose \"Find suggestions\" to look up your artist in public music databases (MusicBrainz and Wikidata). Pick the exact artist from the results and choose \"Review suggestions\"; artists with the same name can have separate profiles, so check the details and source link first. Each proposed field shows its source and confidence, and the bio is marked \"AI draft\" because it is written by AI from public facts. Edit any suggested text and select only the fields you want. If a field already contains information, you'll see its current value and must confirm that you want to replace it. Choose \"Add … to form\" to fill the edit form; added fields are marked \"Suggested\" until you edit them. If you change a suggestion after adding it, add it to the form again before saving. Nothing is published until you choose \"Save changes\". Closing the panel before adding suggestions changes nothing, and canceling the editor discards staged changes.",
          },
          {
            kind: "figure",
            figure: {
              src: `${SHOT}/artist-enrichment.png`,
              alt: "Profile suggestions panel on the review step, showing the selected artist and a selected AI-drafted bio with its source.",
              caption: "Check the selected artist, each source, and the fields you select before adding them to the form.",
              width: 1440,
              height: 1200,
              source: LOCAL,
            },
          },
          {
            kind: "callout",
            tone: "tip",
            title: "Check sources before saving",
            text: "Suggestions can be incomplete or mistaken. Open the linked sources and check the artist identity, links, and any image-use details. If no result matches, choose \"None of these match\" and keep editing by hand, or search again. A temporary source or AI error will not change your existing profile.",
          },
        ],
      },
      {
        id: "claim",
        heading: "Claiming a credited artist page",
        blocks: [
          {
            kind: "paragraph",
            text: "Sign in and open Artist management, then search for the credited artist. Select the exact profile and check its releases, especially when artists share a name. Eligible profiles let you submit evidence that you represent the artist — for example a distributor or label reference, a rights document, or an official account that links to the page. An operator reviews each request; a matching name, release credit, or upload does not grant access. Your requests and their pending, approved, rejected, or revoked status appear in Artist management. After rejection or revocation, you can submit new evidence if the profile still accepts requests.",
          },
          {
            kind: "figure",
            figure: {
              src: `${SHOT}/artist-claim-request.png`,
              alt: "Artist management page with a credited-profile search, selected catalog, and evidence request step.",
              caption: "Choose the exact credited profile and review its catalog before requesting access.",
              width: 1440,
              height: 1100,
              source: LOCAL,
            },
          },
          {
            kind: "paragraph",
            text: "An approved claim lets you edit the public page. It does not transfer release management, rights, payouts, or private analytics from another account.",
          },
        ],
      },
      {
        id: "management",
        heading: "Sharing management access",
        blocks: [
          {
            kind: "figure",
            figure: {
              src: `${SHOT}/artist-management.png`,
              alt: "Artist management page showing release permissions, including replacing track audio, and controls to reduce a manager's access.",
              caption: "Choose the permissions a release manager needs, including track audio replacement for eligible releases.",
              width: 1440,
              height: 1900,
              source: LOCAL,
            },
          },
          {
            kind: "paragraph",
            text: "Open Artist management from Your catalog to invite a registered account to help with one profile or release. Choose the permissions they need and an optional expiry date. The invitation gives them no access until they accept it. You can later remove permissions or shorten their access, or revoke it entirely. Reducing access ends other pending invitations for that manager and resource. To add permissions or extend access, send a new invitation for them to accept.",
          },
          {
            kind: "paragraph",
            text: "When someone invites you to manage a profile or release, the notification bell shows the pending invitation while you are signed in. Open it to review the exact access and accept or decline on Artist management. The alert disappears after the invitation is resolved or expires.",
          },
          {
            kind: "figure",
            figure: {
              src: `${SHOT}/artist-management-invitation.png`,
              alt: "Notification bell showing a pending artist management invitation and a link to review it.",
              caption: "A pending invitation stays in notifications until you respond or it expires.",
              width: 1440,
              height: 900,
              source: LOCAL,
            },
          },
          {
            kind: "paragraph",
            text: "On a ready release that has not been published yet, the owner or an accepted manager with Replace track audio permission can choose one audio file for a track, unless a current stem has already been minted. Supported formats are MP3, WAV, FLAC, AIFF (.aif or .aiff), M4A, AAC, and OGG; files can be up to 100 MiB. The existing audio stays playable while the replacement is processed; if it fails, the existing audio remains active. After a successful replacement, earlier stems remain available to purchases and remix projects that already use them.",
          },
          {
            kind: "paragraph",
            text: "To hand over management, send a transfer invitation for a profile, a selected release, or all releases you currently manage. The recipient must accept before your management access ends. Existing manager invitations for transferred resources end too, so the new owner can choose whom to invite. Profile and release management transfer separately; credits, rights, and payouts do not move with either transfer.",
          },
          {
            kind: "paragraph",
            text: "If you sent a transfer that was accepted by mistake, open Artist management and request recovery with evidence for an operator to review. Sending a request does not restore your access. Recovery is available only while the recipient still manages every resource in that transfer and no later accepted transfer has involved them. You can see whether your request is pending, approved, or rejected there. Credits, rights, and payouts do not change.",
          },
          {
            kind: "figure",
            figure: {
              src: `${SHOT}/artist-management-recovery.png`,
              alt: "Artist management page showing an accepted release transfer and the evidence form for requesting operator review.",
              caption: "Request an operator review of an eligible accepted transfer; access does not change when you submit.",
              width: 1440,
              height: 1050,
              source: LOCAL,
            },
          },
        ],
      },
      {
        id: "links",
        heading: "Your name links to your page",
        blocks: [
          {
            kind: "paragraph",
            text: "When a release credit identifies your page clearly, its artist link opens that page. Credits that still need identity review open a catalog page for the credited name instead.",
          },
        ],
      },
      {
        id: "review-artist-claims",
        heading: "Reviewing an artist profile claim",
        blocks: [
          {
            kind: "paragraph",
            text: "Operators and administrators can open Artist Claims from the admin navigation to review pending public-profile requests. Check the exact artist page and releases, requester, and private evidence before recording a review note and approving or rejecting. The requester cannot decide their own claim, even if they are also an administrator or operator; a different operator must review it. Approval grants public-profile editing only, not release management, rights, payouts, or private analytics. Both approving and rejecting ask you to confirm. When more than one pending claim targets the same artist profile, the queue flags it: approving one of them automatically rejects the others. Transfer Recovery is a separate queue for management-transfer recovery requests.",
          },
        ],
      },
      {
        id: "review-management-recovery",
        heading: "Reviewing a transfer recovery request",
        blocks: [
          {
            kind: "paragraph",
            text: "Operators and administrators can open Management transfer recovery from the admin navigation. Compare the requester's evidence with the accepted transfer and the listed profiles or releases, then record a review note before approving or rejecting. Approval restores management to the original sender only when the recipient still manages every listed resource and no later accepted transfer has involved one. It ends existing manager grants and pending transfers for those resources. A rejection leaves management as it is. Each request lists the affected profiles or releases and explains what approval changes, and both approving and rejecting ask you to confirm.",
          },
        ],
      },
    ],
    appLinks: [
      { label: "Your catalog", href: "/artist/catalog", description: "Open your releases; your artist page is linked from your name." },
      { label: "Artist management", href: "/artist/management", description: "Review invitations, delegate access, or transfer management." },
      { label: "Artist claim reviews", href: "/admin/artist-claims", description: "Review pending public-profile claims (operators and administrators)." },
      { label: "Recovery reviews", href: "/admin/management-recovery", description: "Review accepted transfer recovery requests (operators and administrators)." },
    ],
    related: ["upload-music", "artist-analytics", "getting-started"],
  },
  {
    slug: "artist-analytics",
    title: "Artist analytics & your action cockpit",
    summary:
      "See plays, payouts, and protection activity in one dashboard — with a cockpit of suggested next actions tailored to your catalog.",
    category: "artists",
    audiences: ["artist"],
    status: "partial",
    keywords: ["analytics", "dashboard", "plays", "payouts", "revenue", "stats", "metrics", "action cockpit", "staking"],
    sections: [
      {
        id: "dashboard",
        heading: "Your dashboard",
        blocks: [
          {
            kind: "list",
            items: [
              "Plays over time, shown as a trend you can scan at a glance.",
              "Stablecoin payout totals from sales and royalties.",
              "Content-protection activity and your staking history.",
            ],
          },
          {
            kind: "figure",
            figure: {
              src: `${SHOT}/artist-analytics.png`,
              alt: "The Artist Analytics page showing seven recent plays, a USDC payout total, Groove Track as the top track, a plays-over-time chart, playback sources, and content-protection status.",
              caption: "Artist Analytics: recent plays, payouts, playback sources, and protection signals in one view.",
              width: 1440,
              height: 900,
              source: LOCAL,
            },
          },
        ],
      },
      {
        id: "cockpit",
        heading: "The action cockpit",
        blocks: [
          {
            kind: "paragraph",
            text: "Alongside the numbers, the dashboard suggests concrete next steps — for example promoting a top track, listing marketplace-ready stems, activating a community room, reviewing city demand for a show, or posting a campaign update. Each card links straight to where you'd act.",
          },
        ],
      },
    ],
    appLinks: [
      { label: "Artist analytics", href: "/artist/analytics", description: "Plays, payouts, protection, and suggested actions." },
    ],
    related: ["marketplace-sell", "upload-music", "shows-run", "withdraw-a-release", "community"],
  },
  {
    slug: "withdraw-a-release",
    title: "Take a release out of streaming (and put it back)",
    summary:
      "Stop new listeners streaming a release, without taking anything away from people who bought it — and restore it whenever you are ready.",
    category: "artists",
    audiences: ["artist", "listener"],
    status: "available",
    keywords: [
      "withdraw",
      "unpublish",
      "take down",
      "remove from streaming",
      "pull a release",
      "restore",
      "republish",
      "put it back",
      "unavailable",
      "greyed out",
      "no longer available",
    ],
    sections: [
      {
        id: "what-it-does",
        heading: "What withdrawing does",
        blocks: [
          {
            kind: "paragraph",
            text: "Sometimes you need a release to stop streaming — a mix you are no longer happy with, a sample you are clearing, a decision you want to take back for a while. Withdrawing does that without erasing anything.",
          },
          {
            kind: "list",
            items: [
              "Nobody new can stream the release on Resonate from the moment you withdraw it.",
              "People who bought it keep it. A purchase is theirs, and withdrawing does not reach it.",
              "It stays where listeners saved it — in their libraries and playlists — shown as unavailable, so it does not vanish on them without a word.",
              "Nothing is deleted, and you can put it back at any time.",
            ],
          },
          {
            kind: "callout",
            tone: "note",
            title: "This is a pause, not a deletion",
            text: "Withdrawing is meant to be used and undone. If you want a release gone for good, that is a different decision — talk to us rather than leaving it withdrawn forever.",
          },
        ],
      },
      {
        id: "how-to",
        heading: "Withdraw a release",
        blocks: [
          {
            kind: "steps",
            items: [
              "Open your catalogue and find the release in the Releases list.",
              "Select Withdraw from streaming in the Streaming column.",
              "Read what the confirmation tells you, then confirm. The catalogue marks the release as withdrawn, with the date.",
            ],
          },
        ],
      },
      {
        id: "restore",
        heading: "Putting it back",
        blocks: [
          {
            kind: "paragraph",
            text: "A withdrawn release shows Restore to streaming in the same place. One action, no warnings: the release starts streaming again, and every library and playlist that kept it lights back up.",
          },
        ],
      },
      {
        id: "greyed-out",
        heading: "If something in your library is greyed out",
        blocks: [
          {
            kind: "paragraph",
            text: "If a track you saved shows as unavailable, the artist has usually withdrawn it from streaming. We leave it in your library and in your playlists, greyed out and labelled, rather than quietly removing it — you saved it for a reason, and you deserve to know what happened to it.",
          },
          {
            kind: "list",
            items: [
              "It cannot be played and it is skipped when you play the playlist it sits in.",
              "It may come back: withdrawing is reversible, and if the artist restores it, it simply starts working again.",
              "Anything you bought is unaffected. Your purchases stay playable whatever happens to streaming.",
            ],
          },
        ],
      },
    ],
    appLinks: [
      { label: "Your catalogue", href: "/artist/catalog", description: "Withdraw or restore any of your releases." },
      { label: "Your library", href: "/library", description: "Where a withdrawn track shows as unavailable." },
    ],
    related: ["upload-music", "library-playlists", "marketplace-buy"],
  },
  {
    slug: "punchline-drops",
    title: "Drops: turn your track's best moments into collectibles",
    summary:
      "Pick the hook, the punchline, the line everyone quotes — and release it as a small set of collectible moments fans can own, free or paid.",
    category: "artists",
    audiences: ["artist", "listener"],
    status: "partial",
    keywords: ["punchline", "drops", "browse", "gallery", "genre", "sold out", "availability", "collectible", "moments", "vocal", "clip", "hook", "edition", "limited", "publish", "collect", "own", "free", "paid", "price", "usdc"],
    sections: [
      {
        id: "what",
        heading: "What a Drop is",
        blocks: [
          {
            kind: "paragraph",
            text: "A Drop is a small collection of \"moments\" cut from your track — each a short clip (a few seconds) with a title, the lyric, optional artwork, a limited edition size, and a price you choose (including free). The first kind of drop is the Punchline drop, cut from your vocals: the hook, the punchline, the line fans scream back at you. More kinds — like epic orchestral moments — are on the way, and every drop shows its kind.",
          },
          {
            kind: "callout",
            tone: "note",
            title: "Available on rights-clean tracks",
            text: "Drops are only available on published tracks you own with a processed vocals stem and a clean rights status. If a track isn't eligible, the panel tells you exactly why.",
          },
        ],
      },
      {
        id: "create",
        heading: "Creating a drop",
        blocks: [
          {
            kind: "steps",
            items: [
              "Open one of your releases — as the owner you'll see a Punchline Drops panel below your tracks.",
              "Pick a track, then create a drop (or resume the draft you started earlier).",
              "Select the moment on the vocal timeline by dragging the start and end handles, and hit Preview to hear exactly what fans will get.",
              "Add the title, the lyric line, optional artwork, the edition size, and the price — the live card shows exactly how the collectible will look.",
              "Add more moments if you like (they can become a set), and optionally add a Set bonus — an extra vocal clip and a note that only fans who collect the whole set will unlock.",
              "Hit Publish when everything looks right.",
            ],
          },
          {
            kind: "paragraph",
            text: "Publishing shows you a review of everything in the drop, then cuts the audio clips and makes the drop public. Published drops can't be edited, so give the preview a real listen first.",
          },
        ],
      },
      {
        id: "rights",
        heading: "What buyers actually get",
        blocks: [
          {
            kind: "callout",
            tone: "warning",
            title: "Personal collectible only",
            text: "Every moment is sold as a personal collectible: fans can play it and show it off on their profile. It carries no commercial-use, remix, or sampling rights, and never transfers your copyright or master ownership. The same promise is shown to you at publish time and to fans on every card.",
          },
        ],
      },
      {
        id: "collecting",
        heading: "Collecting moments (for fans)",
        blocks: [
          {
            kind: "paragraph",
            text: 'On a release with a published drop, everyone sees a "Collect moments" section: lyric-first cards you can play, with how many editions are left. Sign in, tap Collect, and the edition number is yours. Free moments are claimed instantly; priced moments show their price and check out with your Resonate passkey wallet — you pay in USDC and the edition is granted the moment the payment clears. Each fan can collect one edition per moment, and when they are gone, they are gone.',
          },
          {
            kind: "paragraph",
            text: "You don't have to know which release has a drop: open Drops from the sidebar to browse the full collection gallery. Drops are ranked by collecting momentum, so recent collects and nearly-gone editions float to the top. Tap the filter chips above the gallery to narrow it by drop kind, genre, or free and paid moments; choose Include sold out when you want to see completed editions too. Each chip applies straight away and takes you back to the first page, and Clear filters returns to the full gallery. Your filters and page stay in the web address, so you can share the view. Use the play button to preview a Drop without leaving the gallery, or tap the rest of the card to open that release's collect section. The Home page also shows a smaller shelf of available Drops.",
          },
          {
            kind: "figure",
            figure: {
              src: `${SHOT}/drops.png`,
              alt: "The Drops collection gallery with kind, genre, price, and availability filter chips above the collectible moment cards.",
              caption: "Browse collectible moments by kind, genre, price, and availability.",
              width: 1440,
              height: 900,
              source: LOCAL_PUBLIC,
            },
          },
          {
            kind: "paragraph",
            text: "One note on lyrics: cards mask a small set of socially weighted words with asterisks on screen. The audio and the artist's original text are untouched — the card display just doesn't spell them out.",
          },
          {
            kind: "paragraph",
            text: "Want to show off what you own? Turn on \"Show owned items\" in your community profile settings and your newest collected moments appear on your public listener profile — never your wallet or what you paid.",
          },
          {
            kind: "paragraph",
            text: "Collected a moment you love? Every moment has its own shareable link — open it from the \u201cMoments\u201d tab in your Library (or the Collect section on the release) and tap Share. Whoever opens the link sees a branded preview card with the lyric, the artist, and how many editions are left, and can jump straight to collecting one. If you have made your community profile and collection public, your edition number and name ride along on the card; otherwise the link just shows the moment.",
          },
          {
            kind: "callout",
            tone: "note",
            title: "Priced moments (paid collecting)",
            text: "Artists set each moment's price — free, or between $0.50 and $9.99 per edition. Priced moments check out in USDC from your Resonate passkey wallet; the artist keeps at least 85% of every sale. If a payment clears but the edition just sold out or you already own it, no edition is granted and support will refund you.",
          },
        ],
      },
      {
        id: "next",
        heading: "What's coming next",
        blocks: [
          {
            kind: "paragraph",
            text: "Everything you collect lives in your Library under the Moments tab — grouped by drop, with your edition number and your progress toward each set. Complete a whole set and the artist's bonus unlocks instantly: a hidden extra clip and a personal note, shown right on the release page and in your Library.",
          },
        ],
      },
    ],
    appLinks: [
      { label: "Browse Drops", href: "/drops", description: "Explore available and sold-out collectible moments." },
      { label: "Your catalog", href: "/artist/catalog", description: "Open a release to find its Punchline Drops panel." },
      { label: "Your moments", href: "/library?tab=moments", description: "The Punchline moments you have collected." },
    ],
    related: ["upload-music", "artist-profile", "marketplace-sell", "library-playlists"],
  },
  {
    slug: "rights-protection",
    title: "Rights & content protection",
    summary:
      "How Resonate protects authenticity: verification tiers, staking to back your work, trust signals listeners can see, and trusted-source onboarding.",
    category: "trust",
    audiences: ["artist", "operator"],
    status: "partial",
    keywords: ["rights", "content protection", "attestation", "stake", "staking", "trust tier", "escrow", "verification", "trusted source", "distributor", "proof of control"],
    sections: [
      {
        id: "verification",
        heading: "Verification tiers",
        blocks: [
          {
            kind: "paragraph",
            text: "These signals answer different questions and are not interchangeable. Account trust can make a publishing route smoother, but every release keeps its own rights state.",
          },
          {
            kind: "definitions",
            items: [
              {
                term: "Account trust",
                description: "Independent Account Trust, Trusted Creator, and Trusted Source Account describe the account route and its controls. They do not clear rights for a particular release.",
              },
              {
                term: "Human/personhood",
                description: "Human Verified means the wallet passed a personhood or anti-sybil check. It does not prove music ownership or publishing authority.",
              },
              {
                term: "Provenance",
                description: "Self-Attested On-Chain records the creator wallet's statement about a release. Fingerprint Cleared means configured checks found no conflicting match. Neither is independent rights approval.",
              },
              {
                term: "Economic trust",
                description: "Verified Economic Tier and stake/escrow signals describe economic controls and account history. They do not prove release rights.",
              },
              {
                term: "Release-scoped rights review",
                description: "Rights Verified is reserved for a release whose submitted evidence was reviewed and supports likely recording ownership or publishing authority. Other release states can be under review, approved with limits, denied, or disputed.",
              },
            ],
          },
          {
            kind: "paragraph",
            text: "Marketplace listing and payout eligibility use release-scoped rights and policy gates. A human check, self-attestation, account tier, or technical provenance signal cannot substitute for that review.",
          },
        ],
      },
      {
        id: "staking",
        heading: "Staking & trust signals",
        blocks: [
          {
            kind: "paragraph",
            text: "Artists can lock a stake to stand behind a release's authenticity. That stake powers the public trust signals shown on release and stem pages, and it can be at risk if a valid claim proves the content was misattributed.",
          },
          {
            kind: "callout",
            tone: "note",
            title: "Escrow periods",
            text: "New activity may pass through a short escrow window that gives the community time to flag a problem before everything settles.",
          },
        ],
      },
      {
        id: "trusted-source",
        heading: "Trusted sources & distributors",
        blocks: [
          {
            kind: "paragraph",
            text: "Labels and distributors can request trusted-source status to onboard artists at scale. Requests are reviewed by operators, and approvals or revocations update the relevant accounts' publishing rights.",
          },
        ],
      },
    ],
    appLinks: [
      { label: "Your wallet", href: "/wallet", description: "See and manage your stakes." },
      { label: "Disputes", href: "/disputes", description: "Where authenticity claims are handled." },
    ],
    related: ["upload-music", "disputes", "smart-wallet"],
  },

  // ─────────────────────────── Resonate Shows ─────────────────────────────
  {
    slug: "shows-back",
    title: "Back a show (Resonate Shows)",
    summary:
      "Turn 'I'd go to that' into a real concert: signal demand and pledge funds into escrow that's refunded automatically if the show doesn't happen.",
    category: "shows",
    audiences: ["listener"],
    status: "partial",
    keywords: ["shows", "campaign", "pledge", "back", "fund", "escrow", "refund", "concert", "demand", "signal", "tickets", "fee"],
    sections: [
      {
        id: "how-it-works",
        heading: "How Shows works",
        blocks: [
          {
            kind: "paragraph",
            text: "Pick an artist and a city, lock funds in a smart contract, and if enough fans commit, the artist's team gets a demand signal backed by money — not just likes. If the show isn't confirmed, every pledge is refunded automatically.",
          },
          {
            kind: "figure",
            figure: {
              src: `${SHOT}/shows.png`,
              alt: "The Shows landing page headlined 'Fans bring the show.' with counts of active campaigns and fans signalled, and a list of all campaigns by city.",
              caption: "Shows: browse active campaigns and see how much demand each has gathered.",
              width: 1440,
              height: 900,
              source: STAGING,
            },
          },
        ],
      },
      {
        id: "pledging",
        heading: "Signalling and pledging",
        blocks: [
          {
            kind: "steps",
            items: [
              "Open a campaign to see its goal, deadline, backers, venue target, and the artist-approved terms.",
              "Pick a tier in the pledge card at the top of the campaign page (on mobile, the bottom Pledge bar jumps straight to it).",
              "Before signing, a confirmation step recaps your pledge amount and the refund and release terms — review it, then confirm.",
              "Approve the pledge with your passkey; it's held in escrow, not paid out yet.",
            ],
          },
          {
            kind: "paragraph",
            text: "Pledging only opens once a campaign is artist-authorized and its on-chain escrow has been linked. Until then — while it's still a demand signal, awaiting artist authority, or awaiting its escrow link — the campaign page explains why backing isn't open yet instead of showing a pledge form. If a campaign was cancelled or didn't meet its goal, the page shows that and lets any existing backers claim a refund.",
          },
          {
            kind: "paragraph",
            text: "Some funded campaigns include a platform fee shown on the campaign page before you pledge. That fee is deducted from the artist payout only if the campaign succeeds and funds are released. If the campaign misses its goal or moves to refunds, backers are refunded 100% of their pledge.",
          },
          {
            kind: "figure",
            figure: {
              src: `${SHOT}/show-campaign.png`,
              alt: "The 'Sennarin in Paris' campaign page showing date and venue, funding progress, pledge tiers, locked terms, and a pledge button.",
              caption: "A campaign page: funding progress, deadline, locked terms, pledge tiers, and a link to view the escrow contract.",
              width: 1440,
              height: 900,
              source: STAGING,
            },
          },
        ],
      },
      {
        id: "trust",
        heading: "Trust & refunds",
        blocks: [
          {
            kind: "list",
            items: [
              "The fan-risk terms are approved by the artist and then locked — they can't be quietly changed after you pledge.",
              "The campaign page shows any success-only platform fee up front, including that it comes from the artist payout and never from failed-campaign refunds.",
              "You can open the escrow contract in a block explorer to see its verified code, transactions, and events.",
              "If the goal isn't met or the show isn't confirmed, your pledge is refunded automatically.",
              "A campaign page shows a trust badge (demand signal, provisional, or artist-authorized escrow) so you always know what stage you're backing.",
              "After a show is marked fulfilled, funds release only once a dispute window closes; while a dispute is under review, release stays paused. The campaign page shows the dispute status and the window's close date.",
            ],
          },
        ],
      },
    ],
    appLinks: [
      { label: "Browse Shows", href: "/shows", description: "Active fan-funded campaigns." },
      { label: "Featured campaign", href: "/shows/sennarin-paris", description: "Example: Sennarin in Paris." },
    ],
    related: ["shows-run", "smart-wallet", "community"],
  },
  {
    slug: "shows-run",
    title: "Run a Shows campaign",
    summary:
      "Launch a fan-funding campaign for a city, set transparent terms, and confirm booking and fulfillment as demand turns into a real show.",
    category: "shows",
    audiences: ["artist", "operator"],
    status: "partial",
    keywords: ["shows", "create campaign", "promoter", "booking", "fulfillment", "terms", "escrow", "campaign management", "artist", "fee", "payout", "verified human", "human verification", "eligible for payouts", "get paid"],
    sections: [
      {
        id: "create",
        heading: "Creating a campaign",
        blocks: [
          {
            kind: "steps",
            items: [
              "From Shows, choose Create campaign.",
              "Set the artist, city, goal, deadline, and the visual set fans will see.",
              "Define the fan-risk terms — what backers are promised and what happens if the show doesn't go ahead.",
            ],
          },
        ],
      },
      {
        id: "escrow-authority",
        heading: "Moving to escrow-backed funding",
        blocks: [
          {
            kind: "paragraph",
            text: "Open demand signals are low-friction and anyone can gather them. Escalating a campaign to authorized, escrow-backed pledging is an operator-reviewed step — and once that authority is granted, the artist-approved terms are locked so backers can trust them.",
          },
          {
            kind: "paragraph",
            text: "When a campaign has a platform fee, the management view shows the estimated net artist payout at the goal. The fee is charged only on successful release, so failed campaigns still refund backers in full.",
          },
          {
            kind: "paragraph",
            text: "Deadlines have to line up so the campaign can go live: the funding deadline must be in the future, and the booking deadline must fall after the funding deadline. The form flags a problem before you save.",
          },
          {
            kind: "paragraph",
            text: "Need to fix a locked term after authority is approved — for example a wrong deadline, and no one has backed the campaign yet? An operator revokes authority, which unlocks the terms for editing, then re-approves. Every step is recorded, so the correction is fully auditable.",
          },
          {
            kind: "paragraph",
            text: "Admin and operator accounts can use the Shows list filter to switch from the default actionable campaign view to all campaigns or to a specific status such as cancelled, refunds, or released. If a linked escrow campaign looks stale, operators can re-sync it from the chain to refresh the fee and escrow status shown to fans.",
          },
        ],
      },
      {
        id: "payout-eligibility",
        heading: "Getting paid: verified-human check",
        blocks: [
          {
            kind: "paragraph",
            text: "Before your account can be the destination for campaign money, it has to be eligible for payouts. This protects fans and keeps payouts going to real people.",
          },
          {
            kind: "list",
            items: [
              "Your account must pass the human-verification (personhood) check.",
              "Your catalog must have a release whose rights review allows payouts.",
              "There must be no open rights restriction on your catalog.",
            ],
          },
          {
            kind: "callout",
            tone: "tip",
            title: "Where to verify",
            text: "Run the human-verification check on your artist profile (artist onboarding). If you open a campaign before you're eligible, the form shows exactly what's missing and the single step that unblocks it — so a submit never fails silently.",
          },
        ],
      },
      {
        id: "fulfillment",
        heading: "Booking & fulfillment",
        blocks: [
          {
            kind: "list",
            items: [
              "Confirm booking when the show is secured.",
              "Confirm fulfillment once the obligations are met.",
              "Remember: hitting the funding goal is a green light — it's separate from when funds are released.",
            ],
          },
        ],
      },
      {
        id: "disputes",
        heading: "Handling a dispute",
        blocks: [
          {
            kind: "paragraph",
            text: "Between booking confirmation and the final release of funds, an operator can raise a dispute if something looks wrong — for example a venue falling through. While a dispute is open, backers see that final release is paused. Resolving a dispute is recorded for the audit trail; it does not by itself move money — release always stays gated by the on-chain time-lock.",
          },
        ],
      },
    ],
    appLinks: [
      { label: "Shows", href: "/shows", description: "Browse and create campaigns." },
      { label: "Artist analytics", href: "/artist/analytics", description: "City demand and campaign prompts." },
    ],
    related: ["shows-back", "artist-analytics", "community"],
  },

  // ───────────────────────────── Community ────────────────────────────────
  {
    slug: "community",
    title: "Community: profiles, cohorts & artist rooms",
    summary:
      "Find your people through taste cohorts and city scenes, join artist and supporter rooms, and unlock holder benefits — all with privacy you control.",
    category: "community",
    audiences: ["listener", "artist"],
    status: "partial",
    keywords: ["community", "cohort", "rooms", "artist room", "holder benefits", "city scene", "discord", "profile", "supporters", "collectors"],
    sections: [
      {
        id: "profile",
        heading: "Your community profile",
        blocks: [
          {
            kind: "paragraph",
            text: "Set up a community profile and decide exactly what's visible. Wallet, ownership, taste, and support details are hidden unless you choose to show them.",
          },
        ],
      },
      {
        id: "cohorts",
        heading: "Taste cohorts & city scenes",
        blocks: [
          {
            kind: "paragraph",
            text: "Cohorts group listeners with similar taste, and city scenes group fans by place. Browse suggestions, join the ones that fit, and leave or hide any you don't want. Cohorts are opt-in and only form once enough people are in them.",
          },
          {
            kind: "figure",
            figure: {
              src: `${SHOT}/community.png`,
              alt: "The Community page showing an unlocked Test Artist holder room benefit and a joined Groove Track listeners cohort, with privacy indicators for proofs, wallet, and ownership.",
              caption: "Community: review private benefits and join privacy-safe listener cohorts from one hub.",
              width: 1440,
              height: 1200,
              source: LOCAL,
            },
          },
        ],
      },
      {
        id: "rooms-benefits",
        heading: "Artist rooms & holder benefits",
        blocks: [
          {
            kind: "list",
            items: [
              "Join an artist's public room, or a holder room if you own the right stem/NFT or hold a supporter role.",
              "See announcements and chat with other fans.",
              "Redeem holder benefits that artists set up for their supporters and collectors.",
              "Some artists bridge announcements to Discord — look for their official invite.",
            ],
          },
        ],
      },
    ],
    appLinks: [
      { label: "Community", href: "/community", description: "Cohorts, rooms, and benefits." },
      { label: "Community settings", href: "/settings", description: "Profile and privacy controls." },
    ],
    related: ["settings-privacy", "shows-back", "artist-analytics"],
  },

  // ─────────────────────────── Trust & safety ─────────────────────────────
  {
    slug: "disputes",
    title: "Report content & disputes",
    summary:
      "Report content you believe is stolen or misattributed, submit evidence, follow the case, and — as a curator — help resolve disputes.",
    category: "trust",
    audiences: ["curator", "listener", "artist"],
    status: "partial",
    keywords: ["dispute", "report", "stolen", "misattributed", "evidence", "appeal", "curator", "juror", "moderation", "reputation", "leaderboard"],
    sections: [
      {
        id: "report",
        heading: "Reporting content",
        blocks: [
          {
            kind: "steps",
            items: [
              "From a release or stem, open the report/marketplace-rights action.",
              "Describe the problem and submit your supporting evidence.",
              "Track the case from the Disputes area as it's reviewed.",
            ],
          },
          {
            kind: "figure",
            figure: {
              src: `${SHOT}/disputes.png`,
              alt: "The Dispute Center page with a reputation summary (upheld and rejected counts), tabs for My Reports, Against My Content, and Jury Duty, and a 'No reports filed yet' empty state.",
              caption: "The Dispute Center: your reports, claims against your content, and jury duty in one place.",
              width: 1440,
              height: 900,
              source: LOCAL,
            },
          },
        ],
      },
      {
        id: "appeals",
        heading: "Evidence & appeals",
        blocks: [
          {
            kind: "paragraph",
            text: "Both the reporter and the creator can submit evidence. Cases can be appealed, and decisions and any follow-up actions are recorded so the process stays transparent.",
          },
        ],
      },
      {
        id: "curators",
        heading: "For curators & operators",
        blocks: [
          {
            kind: "list",
            items: [
              "Curators build reputation by reviewing cases well, reflected on the leaderboard.",
              "Operators can escalate to a jury and finalize outcomes.",
              "Advisory AI hints can summarize a case, but enforcement is always a human decision.",
            ],
          },
        ],
      },
    ],
    appLinks: [
      { label: "Disputes", href: "/disputes", description: "Report content and follow cases." },
    ],
    related: ["rights-protection", "upload-music"],
  },

  // ────────────────────── Account, wallet & privacy ───────────────────────
  {
    slug: "settings-privacy",
    title: "Settings & privacy controls",
    summary:
      "Manage your profile, notifications, library sources, and exactly how your listening shapes recommendations.",
    category: "account",
    audiences: ["everyone", "listener"],
    keywords: ["settings", "privacy", "profile", "notifications", "taste memory", "preferences", "opt out", "cohorts", "data"],
    sections: [
      {
        id: "taste-memory",
        heading: "Taste memory controls",
        blocks: [
          {
            kind: "paragraph",
            text: "You decide how much your activity personalizes Resonate. From Settings you can view a plain-language summary of your taste, opt in or out of social taste matching, control city/scene discovery, choose whether AI DJ playback trains your taste, hide or downrank signals, and reset your taste inputs — without ever exposing your raw history.",
          },
          {
            kind: "figure",
            figure: {
              src: `${SHOT}/settings.png`,
              alt: "The Settings page with a left-hand list of sections — Library, Taste Memory, Artist, Community, Listener Cohorts, and Notifications — and the Library section open on the right.",
              caption: "Settings groups your controls by area — pick Taste Memory, Notifications, and more from the left.",
              width: 1440,
              height: 900,
              source: LOCAL,
            },
          },
        ],
      },
      {
        id: "notifications",
        heading: "Notifications",
        blocks: [
          {
            kind: "paragraph",
            text: "Choose which updates you receive, including marketplace listing reminders (for example, when your listings are about to expire).",
          },
        ],
      },
      {
        id: "library-sources",
        heading: "Library & profile",
        blocks: [
          {
            kind: "list",
            items: [
              "Manage your display profile.",
              "Configure library sources and scan behavior (especially in the desktop app).",
              "Manage cohort participation, which links through to Community.",
            ],
          },
        ],
      },
    ],
    appLinks: [
      { label: "Open Settings", href: "/settings", description: "Profile, privacy, notifications, and library." },
    ],
    related: ["ai-dj", "community", "product-analytics", "download-your-data", "delete-your-account", "troubleshooting"],
  },
  {
    slug: "product-analytics",
    title: "Usage measurement: your choice",
    summary:
      "We only record how you use Resonate if you say yes. Saying no disables no features, but it gives Resonate less information for personalization and aggregate insights.",
    category: "account",
    audiences: ["everyone", "listener", "artist"],
    status: "available",
    keywords: [
      "analytics",
      "usage",
      "tracking",
      "telemetry",
      "consent",
      "opt in",
      "opt out",
      "data collection",
      "privacy",
      "measure",
      "stop collecting",
    ],
    sections: [
      {
        id: "what-we-ask",
        heading: "What we ask permission for",
        blocks: [
          {
            kind: "paragraph",
            text: "The first time you sign in, Resonate asks one question: may we record how you use the app? If you say yes, we note which parts you use and when — for example starting a track, saving something to your library, running a search, or opening a listing. These signals can help improve discovery and recommendations, show artists aggregate patterns, reveal which features are useful, and guide what Resonate builds next.",
          },
          {
            kind: "figure",
            figure: {
              src: `${SHOT}/analytics-consent-banner.png`,
              alt: "The Resonate analytics consent banner explains optional usage measurement and gives equally prominent No, do not measure and Yes, measure my use buttons.",
              caption: "The choice appears after sign-in. Saying no and saying yes are presented with equal weight.",
              width: 544,
              height: 329,
              source: LOCAL,
            },
          },
          {
            kind: "list",
            items: [
              "We ask before anything is recorded. Until you answer, nothing about how you use the app is collected.",
              "This is about how you use Resonate, not about who you are or what you say.",
              "Your purchases, uploads, and payouts are kept whatever you choose, because they are records of things that actually happened — a sale, a release, a payment.",
            ],
          },
        ],
      },
      {
        id: "saying-no",
        heading: "Saying no is a real option",
        blocks: [
          {
            kind: "paragraph",
            text: "Refusing is exactly as easy as accepting. Saying no does not disable features, change prices, or affect your music, wallet, purchases, or account. Discovery and recommendations still work, but Resonate has less activity data to personalize them or produce aggregate insights, so some results may be less tailored or complete.",
          },
          {
            kind: "callout",
            tone: "note",
            title: "No answer means no",
            text: "Until you answer, nothing is recorded. The question waits at the bottom of the screen and does not get in your way — you can keep listening and browsing while you think about it — but it stays until you pick one, because permission only starts when you actively give it.",
          },
        ],
      },
      {
        id: "change-your-answer",
        heading: "Changing your answer later",
        blocks: [
          {
            kind: "paragraph",
            text: "Your answer is never final. Open Settings and choose Privacy: it shows what you chose and lets you switch it either way, as often as you like. Turning it off stops the collection from that moment.",
          },
          {
            kind: "steps",
            items: [
              "Open Settings.",
              "Choose Privacy in the list of sections.",
              "Pick 'Measure my use' or 'Do not measure'. The change takes effect straight away.",
            ],
          },
        ],
      },
      {
        id: "asked-again",
        heading: "Why we might ask you once more",
        blocks: [
          {
            kind: "paragraph",
            text: "We only ask again if what we collect changes in a way that matters. Your earlier answer covered what we described at the time, so a real change means the question has to be put to you again — with the new wording in front of you. We will not re-use an old yes to cover something new, and we will not nag you about wording tweaks.",
          },
          {
            kind: "paragraph",
            text: "If the wording happens to change while the question is on your screen, we will show it again rather than record your answer against text you did not read.",
          },
        ],
      },
    ],
    appLinks: [
      {
        label: "Open Settings",
        href: "/settings",
        description: "The Privacy section shows your current answer and lets you change it.",
      },
    ],
    related: ["settings-privacy", "download-your-data", "troubleshooting"],
  },
  {
    slug: "download-your-data",
    title: "Download a copy of your data",
    summary:
      "Get everything Resonate holds about you in one file, from Settings, whenever you want it — and know exactly what the file can and cannot contain.",
    category: "account",
    audiences: ["everyone", "listener", "artist", "producer", "curator"],
    status: "available",
    keywords: [
      "download my data",
      "export",
      "data export",
      "copy of my data",
      "my data",
      "personal data",
      "portability",
      "take my data",
      "json",
      "privacy",
      "gdpr",
      "subject access request",
    ],
    sections: [
      {
        id: "how-to",
        heading: "How to get your file",
        blocks: [
          {
            kind: "steps",
            items: [
              "Open Settings and choose Privacy in the list of sections.",
              "Under 'Download your data', select 'Download my data'.",
              "Wait while we put the file together. If you have a lot of history this can take a minute — the button says it is working, and the file downloads on its own when it is ready.",
            ],
          },
          {
            kind: "paragraph",
            text: "You can do this a few times an hour. If you ask again straight away we will tell you to come back a little later; nothing has gone wrong and nothing is missing, you simply already have a recent copy.",
          },
        ],
      },
      {
        id: "whats-inside",
        heading: "What is in the file",
        blocks: [
          {
            kind: "paragraph",
            text: "One file with everything Resonate keeps about you, gathered in one place instead of scattered across the app.",
          },
          {
            kind: "list",
            items: [
              "Your account and profile, including the ways we recognise you when you sign in.",
              "Your library, playlists, and follows.",
              "What you have uploaded or released, and what you have bought, sold, or earned.",
              "Messages, reports, and other things you have sent us.",
              "If you allowed usage measurement, the record of how you use Resonate. If you did not, there is nothing of that kind to include.",
            ],
          },
        ],
      },
      {
        id: "opening-it",
        heading: "Opening the file",
        blocks: [
          {
            kind: "paragraph",
            text: "The file ends in .json, which is a plain-text format built to be read by both people and other software. Any text editor will open it — Notepad, TextEdit, or whatever you already use. Your web browser will also display it if you drag the file onto an empty tab.",
          },
          {
            kind: "paragraph",
            text: "It is yours to keep, read, store, or take somewhere else. It is not encrypted, so treat it like any other personal document: it contains your information, and anyone you send it to can read all of it.",
          },
        ],
      },
      {
        id: "not-included",
        heading: "What the file does not contain",
        blocks: [
          {
            kind: "paragraph",
            text: "The file holds what Resonate keeps about you in our own systems. Some of what you have done with Resonate lives outside them, and we would be overstating things if we let you believe otherwise.",
          },
          {
            kind: "list",
            items: [
              "Files stored on IPFS — such as published audio and artwork — stay where they are. IPFS is a public network that is not ours, and we cannot pull other people's copies of a file back in.",
              "Entries written to the blockchain — purchases, listings, payouts recorded on-chain — are public records that also live outside Resonate.",
              "Where we hold our own copy of one of those, or our own record of it, that copy and that record are in your file.",
            ],
          },
          {
            kind: "callout",
            tone: "note",
            title: "Something missing?",
            text: "If you expected something in your file that is not there, tell us. We would rather correct the file, or correct this page, than leave you guessing.",
          },
        ],
      },
    ],
    appLinks: [
      {
        label: "Open Settings",
        href: "/settings",
        description: "The Privacy section is where you download your data.",
      },
    ],
    related: ["delete-your-account", "settings-privacy", "product-analytics", "troubleshooting"],
  },
  {
    slug: "delete-your-account",
    title: "Delete your account",
    summary:
      "Ask us to delete your account and the data we hold about you. It happens after 30 days, signing in cancels it, and some records stay — here is exactly which.",
    category: "account",
    audiences: ["everyone", "listener", "artist", "producer", "curator"],
    status: "available",
    keywords: [
      "delete my account",
      "delete account",
      "close account",
      "erase my data",
      "erasure",
      "remove my data",
      "right to be forgotten",
      "cancel deletion",
      "leave resonate",
      "quit",
      "privacy",
      "gdpr",
    ],
    sections: [
      {
        id: "how-to",
        heading: "How to ask for deletion",
        blocks: [
          {
            kind: "steps",
            items: [
              "Open Settings and choose Privacy in the list of sections.",
              "Under 'Delete your account', select 'Delete my account'.",
              "Read the confirmation and confirm it.",
              "Approve the passkey prompt. This is how we know the request is really from you, and not from someone who found your screen unlocked.",
            ],
          },
          {
            kind: "paragraph",
            text: "We do not ask why, and you do not have to give a reason. If you change your mind at the passkey prompt, simply dismiss it — nothing is requested until you approve it.",
          },
          {
            kind: "paragraph",
            text: "If you also want a copy of your information, download it before the deletion runs. Afterwards there is nothing left for us to put in a file.",
          },
        ],
      },
      {
        id: "thirty-days",
        heading: "It happens after 30 days, and signing in cancels it",
        blocks: [
          {
            kind: "paragraph",
            text: "Nothing is deleted straight away. We wait 30 days first. During that time your account works exactly as it did before, and Resonate shows you the date it is due to run every time you use the app.",
          },
          {
            kind: "callout",
            tone: "warning",
            title: "Signing in cancels it",
            text: "If you sign in at any point in those 30 days, the deletion is cancelled. You can also cancel it outright: the notice at the top of the app and the Privacy section in Settings both have a 'Cancel deletion' button, and neither asks you for anything. If you are seeing a deletion you did not ask for, cancel it now and change how you sign in.",
          },
          {
            kind: "paragraph",
            text: "Once the 30 days are up and the deletion runs, it is permanent. It cannot be undone, and we cannot bring your account or your data back.",
          },
        ],
      },
      {
        id: "what-goes",
        heading: "What deletion removes",
        blocks: [
          {
            kind: "paragraph",
            text: "What Resonate keeps about you in our own systems, apart from the records described below.",
          },
          {
            kind: "list",
            items: [
              "Your account and profile, including the ways we recognise you when you sign in.",
              "Your library, playlists, and follows.",
              "Messages, reports, and other things you have sent us.",
              "The record of how you use Resonate, if you allowed usage measurement.",
            ],
          },
        ],
      },
      {
        id: "what-stays",
        heading: "What stays, and why",
        blocks: [
          {
            kind: "paragraph",
            text: "Some things cannot be deleted, and we would rather tell you before you decide than after.",
          },
          {
            kind: "list",
            items: [
              "Records we are legally obliged to keep — for example what the law requires us to hold about a sale or a payment. We keep only what we must, and only for as long as we must.",
              "Entries written to the blockchain — purchases, listings, payouts recorded on-chain — are public records that live outside Resonate. They are permanent by design and nobody can remove them.",
              "Files stored on IPFS, such as published audio and artwork, stay where they are. IPFS is a public network that is not ours, and we cannot pull other people's copies of a file back in.",
            ],
          },
        ],
      },
      {
        id: "if-you-released-music",
        heading: "If you have released music",
        blocks: [
          {
            kind: "paragraph",
            text: "Your releases stop streaming on Resonate. People who bought something from you keep it: a purchase belongs to the person who made it, and deleting your account does not take it away from them.",
          },
          {
            kind: "paragraph",
            text: "Anything you are owed is worth settling before you ask for deletion, because afterwards there is no account left to pay into.",
          },
        ],
      },
    ],
    appLinks: [
      {
        label: "Open Settings",
        href: "/settings",
        description: "The Privacy section is where you ask for deletion, and where you cancel it.",
      },
    ],
    related: ["download-your-data", "product-analytics", "settings-privacy", "troubleshooting"],
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting & resetting your session",
    summary:
      "What to do if something looks off — including a safe session reset that never touches your passkey.",
    category: "account",
    audiences: ["everyone"],
    keywords: ["troubleshooting", "reset", "session", "sign out", "stuck", "error", "401", "clear cache", "update", "reload"],
    sections: [
      {
        id: "reload",
        heading: "If a new version is available",
        blocks: [
          {
            kind: "paragraph",
            text: "When Resonate ships an update, you may see a banner inviting you to reload. This is non-destructive — it just refreshes the app to the latest version.",
          },
        ],
      },
      {
        id: "reset",
        heading: "Resetting your local session",
        blocks: [
          {
            kind: "paragraph",
            text: "If you start seeing unexpected sign-outs or errors after an environment change, Resonate offers a guided session reset. It clears only Resonate's saved session data on this browser and signs you out so you can sign back in cleanly. You can also trigger it manually under Settings → Troubleshooting.",
          },
          {
            kind: "callout",
            tone: "warning",
            title: "Your passkey is never deleted",
            text: "A reset only clears local app data on this device. Your passkey lives in your device's authenticator and still controls any account it created — you sign back in with it as usual.",
          },
        ],
      },
    ],
    appLinks: [
      { label: "Settings → Troubleshooting", href: "/settings", description: "Reset this browser's saved session." },
    ],
    related: ["getting-started", "smart-wallet", "settings-privacy"],
  },
  {
    slug: "desktop-app",
    title: "The Resonate desktop app",
    summary:
      "Run Resonate as a native desktop app with the same experience as the web, plus native windowing and downloads.",
    category: "account",
    audiences: ["everyone", "listener", "artist"],
    status: "partial",
    keywords: ["desktop", "app", "download", "install", "native", "windows", "mac", "electron"],
    sections: [
      {
        id: "about",
        heading: "What the desktop app gives you",
        blocks: [
          {
            kind: "paragraph",
            text: "The desktop app wraps the full Resonate experience in a native window, with proper handling of external links and downloads. It's a convenient way to keep Resonate open alongside your other tools.",
          },
          {
            kind: "callout",
            tone: "note",
            title: "Still maturing",
            text: "Installable builds are available. Code signing, notarization, and auto-update are still being finished, so follow the project's release notes for the latest packaged version.",
          },
        ],
      },
    ],
    related: ["getting-started"],
  },
];
