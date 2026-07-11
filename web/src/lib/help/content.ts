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
 * the public surfaces of staging with `scripts/capture-help-screenshots.mjs`.
 */

const SHOT = "/help/screenshots";
const STAGING = "Staging";
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
            text: "If you are an artist, the Wallet also surfaces stakes tied to content protection — funds you lock to back the authenticity of your releases. See Rights & content protection for how stakes and trust tiers work.",
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
      "Find new releases and stems from the home page, by mood, or in the full catalog — with personalized picks once you start listening.",
    category: "discover",
    audiences: ["listener"],
    keywords: ["discover", "home", "browse", "catalog", "trending", "top artists", "charts", "mood", "vibe", "search", "recommended", "feed", "personalized", "explore", "exploration", "genre", "playlists"],
    sections: [
      {
        id: "home",
        heading: "The Discover home page",
        blocks: [
          {
            kind: "paragraph",
            text: "Home is your starting point. A featured Shows campaign sits at the top, followed by trending and mood chips, then your personalized feed — several themed rows like \"Because you save a lot of Afrobeat\", \"New from artists you play\", and \"Trending in your genre\". Each row says in plain words why it's there, and the reasons are always about your taste in general (a genre you save, artists you play), never a list of exactly what you played and when.",
          },
          {
            kind: "paragraph",
            text: "Every visit also includes a small \"Step outside your lanes\" row of fresh, barely-played tracks so your feed never becomes an echo chamber, and rows rotate between visits instead of repeating the same picks. If you're new and we don't know your taste yet, the feed says \"Catalog signal\" honestly — play a few tracks or save a genre and it gets personal.",
          },
          {
            kind: "figure",
            figure: {
              src: `${SHOT}/discover-home.png`,
              alt: "The Discover home page with a featured 'Sennarin in Paris' campaign, a row of trending and mood chips, and a 'Recommended for You' section.",
              caption: "Discover: featured campaign, trending/mood chips, and personalized picks.",
              width: 1440,
              height: 900,
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
        ],
      },
      {
        id: "mood",
        heading: "Browse by mood & vibe",
        blocks: [
          {
            kind: "paragraph",
            text: "Tap a mood chip (Focus, Hype, Chill, Late Night, and more) to reshape your recommendations and start a vibe session that keeps a consistent feel as you listen. Genre chips also re-rank Trending Now and Top Artists for that genre.",
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
            kind: "figure",
            figure: {
              src: `${SHOT}/catalog.png`,
              alt: "The catalog page titled 'Browse recent catalog' with counts of releases, artists, and stems, tabs for Releases/Artists/Stems, and a grid of release cards.",
              caption: "Catalog: search and filter recent releases, artists, stems, and public playlists.",
              width: 1440,
              height: 900,
              source: STAGING,
            },
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
      "Play any track and use the Now Playing console to manage your queue, inspect stems, save tracks, take licensing actions, and back live show campaigns.",
    category: "discover",
    audiences: ["listener"],
    keywords: ["play", "player", "now playing", "queue", "controls", "stem", "listen", "playback", "live sync", "shows", "campaign", "support a show"],
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
        id: "actions",
        heading: "Actions while you listen",
        blocks: [
          {
            kind: "list",
            items: [
              "Save the track to your library or add it to a playlist.",
              "Inspect the track's stems to hear the individual parts.",
              "Open licensing actions when a stem is available to collect or license in the Marketplace.",
              "Support a show when the playing artist has a live campaign; the chip opens the campaign page so you can review the details before pledging.",
            ],
          },
          {
            kind: "callout",
            tone: "note",
            title: "Live sync & AI DJ",
            text: "When the console shows it is an active device, a trusted AI DJ session can queue and start playback for you — and you always confirm before sound starts.",
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
    keywords: ["ai dj", "agent", "session", "sonic radar", "recommendations", "neural flow", "pulse raid", "taste", "discovery", "next pick"],
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
    keywords: ["library", "playlist", "save", "collection", "share", "public playlist", "folders", "favorites", "discover", "catalog"],
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
            kind: "figure",
            figure: {
              src: `${SHOT}/library.png`,
              alt: "The 'My Library' page with tabs for Tracks, Artists, Albums, Playlists, Stems, and AI Creations, a search field, and a 'Your library is quiet' empty state offering to add a music folder or browse the catalog.",
              caption: "Your library starts empty — save tracks or add a local music folder to fill it.",
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
    ],
    appLinks: [
      { label: "Your library", href: "/library", description: "Saved tracks and folders." },
      { label: "Playlists", href: "/library?tab=playlists", description: "Create, manage, and share playlists." },
      { label: "Browse the catalog", href: "/catalog", description: "Find public playlists from other listeners." },
    ],
    related: ["playing-music", "discover-music"],
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
              "Confirm the price (shown in a stablecoin) and pay from your wallet balance.",
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
    keywords: ["sell", "list", "listing", "mint", "manage listings", "relist", "expire", "price", "license tier", "marketplace"],
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
              "Mute, solo, and set the level of each stem; measured tempo and key show on stems that have them.",
              "Use the Arrangement grid to switch stems on or off per section of the song \u2014 drop the drums out for a verse, bring them back for the chorus.",
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
      "Upload a track, let Resonate split it into stems, credit the right artists, tag the mood, and publish with content protection.",
    category: "artists",
    audiences: ["artist"],
    keywords: ["upload", "publish", "release", "stems", "separation", "credits", "featured artist", "mood tags", "metadata", "demucs"],
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
        id: "credits",
        heading: "Crediting artists",
        blocks: [
          {
            kind: "paragraph",
            text: "Add the primary artist, track artist, and any featured artists. As you type, Resonate suggests existing artist profiles so you reuse the right one instead of creating a duplicate from a typo.",
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
            text: "Before a release goes public, Resonate checks publishing rights. Depending on your account's verification, you may attest to ownership or provide proof of control. Once cleared, your release and its stems are published to the catalog and can be listed in the Marketplace.",
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
      "Edit how listeners see you — profile image, bio, website, and social links — and know your name links to your page across Resonate.",
    category: "artists",
    audiences: ["artist"],
    status: "available",
    keywords: ["artist", "profile", "page", "bio", "image", "avatar", "social", "links", "website", "edit"],
    sections: [
      {
        id: "edit",
        heading: "Editing your profile",
        blocks: [
          {
            kind: "paragraph",
            text: "Open your artist page and, when you're signed in as its owner, you'll see an \"Edit profile\" button. Use it to set your profile image, a short bio, your website, and links to your social accounts (X, Instagram, TikTok, YouTube, SoundCloud). Only you can edit your own page; everyone else sees it read-only.",
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
        id: "links",
        heading: "Your name links to your page",
        blocks: [
          {
            kind: "paragraph",
            text: "Wherever your name appears on a release or in the catalog, it now links straight to your artist page — on release pages, track credits (including featured artists), the home hero, and catalog and marketplace listings — so fans can always find your profile in one click.",
          },
        ],
      },
    ],
    appLinks: [
      { label: "Your catalog", href: "/artist/catalog", description: "Open your releases; your artist page is linked from your name." },
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
    related: ["marketplace-sell", "upload-music", "shows-run", "community"],
  },
  {
    slug: "punchline-drops",
    title: "Drops: turn your track's best moments into collectibles",
    summary:
      "Pick the hook, the punchline, the line everyone quotes — and release it as a small set of collectible moments fans will soon be able to own.",
    category: "artists",
    audiences: ["artist", "listener"],
    status: "partial",
    keywords: ["punchline", "drops", "collectible", "moments", "vocal", "clip", "hook", "edition", "limited", "publish", "collect", "own", "free"],
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
            text: 'On a release with a published drop, everyone sees a "Collect moments" section: lyric-first cards you can play, with how many editions are left. Free moments can be collected right now — sign in, tap Collect, and the edition number is yours. Each fan can collect one edition per moment, and when they are gone, they are gone.',
          },
          {
            kind: "paragraph",
            text: "You don't have to know which release has a drop: the Home page has a \"Drops\" shelf showing the moments with the most collecting momentum right now — recent collects and nearly-gone editions float to the top, and sold-out drops leave the shelf. Tap any card and you land directly on that release's collect section.",
          },
          {
            kind: "paragraph",
            text: "One note on lyrics: cards mask a small set of socially weighted words with asterisks on screen. The audio and the artist's original text are untouched — the card display just doesn't spell them out.",
          },
          {
            kind: "callout",
            tone: "note",
            title: 'Priced moments say "Coming soon"',
            text: "Artists can set a price on a moment today, but paid collecting has not opened yet — those cards show their price with a Coming soon button until payments arrive.",
          },
        ],
      },
      {
        id: "next",
        heading: "What's coming next",
        blocks: [
          {
            kind: "paragraph",
            text: "Everything you collect lives in your Library under the Moments tab — grouped by drop, with your edition number and your progress toward each set. Complete a whole set and the artist's bonus unlocks instantly: a hidden extra clip and a personal note, shown right on the release page and in your Library. Still ahead: paid collecting.",
          },
        ],
      },
    ],
    appLinks: [
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
            text: "Accounts carry a verification level that decides how much proof a release needs — from an unverified uploader, to a verified independent artist, to a trusted creator or trusted source. Higher trust means a smoother publishing path.",
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
            text: "Pledging only opens once a campaign is an artist-authorized escrow campaign. Until then — while it's still a demand signal or awaiting artist authority — the campaign page explains why backing isn't open yet instead of showing a pledge form. If a campaign was cancelled or didn't meet its goal, the page shows that and lets any existing backers claim a refund.",
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
              "You can view the escrow contract that holds the funds.",
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
    keywords: ["shows", "create campaign", "promoter", "booking", "fulfillment", "terms", "escrow", "campaign management", "artist", "fee"],
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
    related: ["ai-dj", "community", "troubleshooting"],
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
