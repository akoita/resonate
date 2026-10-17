import sys
from pathlib import Path

from svglib import Svg, ACC, MUTED, FAINT, TEXT

A = ACC
s = Svg(1600, 1130, "Resonate application architecture",
        "Application-level view of Resonate: human, desktop and agent surfaces call one NestJS modular "
        "backend organised into bounded contexts, which delegates to Demucs, Stable Audio, agent-runtime and "
        "analytics workers, persists to Postgres, Redis, object storage, Pub/Sub and BigQuery, and transacts "
        "through ERC-4337 smart accounts, Resonate protocol contracts and x402 USDC settlement.")

s.header("Resonate application architecture",
         "One catalog, three surfaces, a modular NestJS backend, asynchronous AI media workers and on-chain commerce.")

# ---------------- Surfaces ----------------
s.zone(40, 140, 280, 580, "Surfaces", "Who calls Resonate", A["edge"])
s.card(60, 216, 240, 128, "Human Studio", A["edge"],
       ["Next.js web app: player, upload,", "marketplace, Remix Studio, AI DJ,", "Shows, library, admin"],
       tag="web/ · :3001", icon="user")
s.card(60, 388, 240, 100, "Desktop shell", A["edge"],
       ["Electron wrapper around the", "configured web origin"], tag="desktop/", icon="desktop")
s.card(60, 508, 240, 118, "AI agents", A["agent"],
       ["MCP clients, scripts and buyers:", "discover, quote, pay, download.", "No account required"],
       tag="OpenAPI · /mcp · x402", icon="bot")
s.chip(60, 646, 240, "Passkey + Kernel smart account", A["chain"], h=50, sub="wallet UX · session keys")

s.arrow("M180 388 V350", A["edge"], label="wraps", lx=228, ly=373)

# ---------------- API ----------------
s.zone(360, 140, 800, 580, "Resonate API", "NestJS modular monolith", A["platform"], note="backend/ · :3000")
iface = [("REST + OpenAPI", A["platform"]), ("MCP · Streamable HTTP", A["agent"]),
         ("x402 quote / pay", A["pay"]), ("Socket.IO realtime", A["platform"]), ("JWT · WebAuthn", A["platform"])]
x = 382
widths = [140, 170, 140, 152, 128]
for (lbl, c), w in zip(iface, widths):
    s.chip(x, 202, w, lbl, c, h=32, size=12)
    x += w + 12

ctx = [
    # col 1
    ("Catalog & discovery", A["platform"], ["Releases, tracks, stems, search,", "library, playlists, storefront"], "catalog · library · discovery"),
    ("Pricing & licensing", A["platform"], ["Stem prices, license tiers,", "quotes, generation credits"], "pricing · credits · usage"),
    ("Identity & community", A["platform"], ["Accounts, artist profiles, follows,", "rooms, notices, email"], "auth · artist · community"),
    # col 2
    ("Marketplace & Shows", A["chain"], ["Mint / list / buy, Shows escrow,", "in-process contract indexers"], "contracts · shows · payments"),
    ("Agent commerce", A["agent"], ["x402 storefront, MCP tools,", "receipts, payment router"], "x402 · mcp · storefront"),
    ("Rights & trust", A["platform"], ["Upload rights routing, evidence,", "disputes, human verification"], "rights · trust · curation"),
    # col 3
    ("Ingestion & AI media", A["sound"], ["Upload, fingerprint, encryption,", "stems, Remix Studio, Lyria"], "ingestion · remix · generation"),
    ("Taste engine & AI DJ", A["agent"], ["Recommendations, embeddings,", "Crate Digger, Scene Scout"], "agents · recommendations"),
    ("Analytics & privacy", A["analytics"], ["Event ledger, consent, retention,", "personal data rights"], "analytics · privacy"),
]
cw, ch = 244, 112
for i, (t, c, ls, tag) in enumerate(ctx):
    col, row = divmod(i, 3)
    s.card(382 + col * (cw + 14), 252 + row * (ch + 12), cw, ch, t, c, ls, tag=tag)

# cross-cutting bar
s.rect(382, 626, 760, 72, rx=14, fill="#1D1B32", stroke=A["platform"], sw=1, extra='stroke-opacity="0.35"')
s.text(400, 650, "CROSS-CUTTING", size=10.5, color=A["platform"], weight=700, spacing="1.4")
s.text(400, 674, "Shared EventBus  ·  Socket.IO gateway  ·  Prisma read models  ·  BullMQ queues  ·  policy & quote guards", size=12.5, color=TEXT, weight=550)
s.text(400, 690, "Domain modules deploy together; ownership stays explicit through NestJS modules and typed events.", size=11, color=MUTED, weight=500)

# surfaces -> API
s.arrow("M300 280 C332 280 340 218 380 218", A["edge"])
s.arrow("M300 566 C336 566 334 218 380 218", A["agent"])
s.label(340, 300, "HTTPS · WS", A["edge"])
s.label(340, 540, "HTTP · MCP", A["agent"])

# ---------------- Workers ----------------
s.zone(1200, 140, 360, 580, "Workers & models", "Delegated compute", A["sound"])
wk = [
    ("Demucs worker", A["sound"], ["Six-stem separation and audio", "feature analysis, CPU or GPU"], "workers/demucs · Pub/Sub job", "wave"),
    ("Stable Audio worker", A["sound"], ["Remix draft rendering on GPU,", "scale-to-zero, WAV in response"], "workers/stable-audio · HTTP", "wave"),
    ("Agent runtime worker", A["agent"], ["Optional out-of-process executor:", "ADK, Vertex, LangGraph, fallback"], "AGENT_RUNTIME_WORKER_URL", "bot"),
    ("Analytics pipeline", A["analytics"], ["Beam/Dataflow streaming, or batch", "landing plus materialization"], "workers/analytics-dataflow", "chart"),
]
for i, (t, c, ls, tag, ic) in enumerate(wk):
    s.card(1220, 202 + i * 106, 320, 98, t, c, ls, tag=tag, icon=ic)
s.chip(1220, 632, 320, "Google AI · Vertex AI", A["agent"], h=48, sub="Gemini agents · Lyria generation · embeddings")
s.text(1380, 702, "Model weights for Stable Audio come from Hugging Face", size=10.5, color=FAINT, weight=550, anchor="middle")

# API col3 -> workers
s.arrow("M1144 290 C1180 290 1184 250 1218 250", A["sound"], dashed=True)
s.arrow("M1144 320 C1182 320 1184 356 1218 356", A["sound"])
s.arrow("M1144 432 C1180 432 1184 462 1218 462", A["agent"], dashed=True)
s.arrow("M1144 556 C1180 556 1184 568 1218 568", A["analytics"], dashed=True)
s.arrow("M1144 470 C1172 470 1176 656 1218 656", A["agent"])

# ---------------- State ----------------
s.zone(360, 760, 800, 210, "State", "Persistence & messaging", A["data"])
st = [("PostgreSQL", "Prisma · pgvector embeddings"), ("Redis", "BullMQ · Socket.IO · cache"),
      ("Object storage", "GCS · IPFS · local driver"), ("Pub/Sub", "stem jobs · results · analytics"),
      ("BigQuery", "warehouse · taste & popularity"), ("Key provider", "local or Cloud KMS")]
for i, (l, sub) in enumerate(st):
    col, row = i % 3, i // 3
    s.chip(382 + col * 258, 836 + row * 62, 246, l, A["data"], h=52, sub=sub, size=13.5)
s.arrow("M660 698 V830", A["data"])
s.arrow("M920 698 V830", A["data"])
s.label(790, 780, "Prisma · BullMQ · storage ports", A["data"])

# ---------------- Chain ----------------
s.zone(1200, 760, 360, 210, "On-chain commerce", "Protocol & payments", A["chain"])
s.chip(1220, 826, 100, "Kernel", A["chain"], h=40, sub="smart account", size=12.5)
s.chip(1330, 826, 100, "Bundler", A["chain"], h=40, sub="ERC-4337", size=12.5)
s.chip(1440, 826, 100, "EntryPoint", A["chain"], h=40, sub="v0.7", size=12.5)
s.arrow("M1320 846 H1328", A["chain"], width=1.4)
s.arrow("M1430 846 H1438", A["chain"], width=1.4)
s.text(1220, 888, "StemNFT · StemMarketplaceV2 · ShowCampaignEscrow", size=11.5, color=MUTED, weight=550)
s.text(1220, 905, "RevenueEscrow · ContentProtection · CurationRewards", size=11.5, color=MUTED, weight=550)
s.text(1220, 922, "DisputeResolution · TransferValidator · PaymentAssets", size=11.5, color=MUTED, weight=550)
s.chip(1220, 932, 320, "x402 facilitator  →  USDC settlement", A["pay"], h=28, size=12)

# API -> chain (viem / ZeroDev) routed through the gutter
s.arrow("M1142 662 H1180 V836 H1218", A["chain"])
s.label(1180, 742, "viem · ZeroDev", A["chain"])
# wallet -> bundler (client-side UserOps)
s.arrow("M300 671 H340 V988 H1190 V860 H1218", A["chain"], dashed=True)
s.label(760, 988, "client-signed UserOperations", A["chain"])

# ---------------- Local dev ----------------
s.zone(40, 760, 280, 210, "Local profile", "docker compose", A["ops"])
loc = ["Postgres · Redis", "Pub/Sub emulator", "Anvil :8545", "Alto bundler :4337", "Demucs :8000"]
for i, l in enumerate(loc):
    s.text(62, 840 + i * 24, "›  " + l, size=12.5, color=MUTED, weight=550, mono=True)

# ---------------- External ----------------
s.rect(40, 1012, 1520, 50, rx=14, fill="#11101E", stroke="#2A2745", sw=1)
s.text(62, 1042, "EXTERNAL", size=10.5, color=A["ops"], weight=700, spacing="1.4")
ext = [("World ID · Gitcoin Passport", "human verification"), ("MusicBrainz", "artist enrichment"),
       ("SMTP", "email + bounces"), ("Langfuse", "agent traces"), ("EVM RPC", "Base Sepolia")]
slots = [150, 530, 800, 1030, 1260]
for (l, sub), x in zip(ext, slots):
    s.dot(x, 1038, A["ops"], r=2.6)
    s.text(x + 10, 1042, l, size=12.5, color=TEXT, weight=650)
    s.text(x + 10 + len(l) * 7.6 + 10, 1042, sub, size=11.5, color=FAINT, weight=500)

s.legend(62, 1094, [("synchronous call", A["platform"], False), ("async / queued / optional", A["sound"], True),
                    ("on-chain path", A["chain"], False)])
s.text(1538, 1098, "Component model: docs/architecture/application_architecture.md", size=11, color=FAINT,
       weight=550, anchor="end", mono=True)

OUT = Path(__file__).resolve().parents[2] / "docs" / "architecture" / "resonate-application-architecture.svg"
Path(sys.argv[1] if len(sys.argv) > 1 else OUT).write_text(s.render())
