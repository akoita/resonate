import sys
from pathlib import Path

from svglib import Svg, ACC, MUTED, FAINT, TEXT, SURF_HI

A = ACC
W, H = 1600, 1330
s = Svg(W, H, "Resonate deployment architecture",
        "Deployment view of Resonate on Google Cloud: clients reach an optional global HTTPS edge with managed "
        "TLS, Cloud Armor, a host-based URL map and serverless NEGs in front of Cloud Run frontend and backend "
        "services; the backend reaches Cloud SQL, Redis, Cloud Storage, Secret Manager and Pub/Sub over a "
        "private VPC, starts Demucs jobs, calls the GPU Stable Audio service, runs scheduled jobs, and feeds a "
        "streaming (Dataflow) or batch (BigQuery subscription) analytics pipeline into BigQuery and Dataform "
        "marts. Vertex AI, ERC-4337 smart accounts, Resonate contracts and x402 USDC settlement sit outside the "
        "cloud boundary. Delivery runs from exact-SHA signed images in the app repository to digest-verified "
        "Terraform reconciliation in resonate-iac.")

s.header("Resonate deployment architecture",
         "Google Cloud runtime, smart-account protocol layer, x402 settlement and the exact-SHA delivery path into resonate-iac.")


def panel(x, y, w, h, label, acc, note=None, note_right=None):
    s.rect(x, y, w, h, rx=16, fill=SURF_HI, stroke=acc, sw=1, extra='stroke-opacity="0.22"')
    s.text(x + 18, y + 24, label, size=10.5, color=acc, weight=700, spacing="1.4")
    if note:
        s.text(note_right or x + w - 16, y + 24, note, size=10.5, color=FAINT, weight=600, anchor="end", mono=True)


# ======================= Clients =======================
s.zone(40, 140, 250, 860, "Clients", "Who connects", A["edge"])
s.card(58, 214, 214, 118, "Human studio", A["edge"],
       ["Artists, listeners,", "curators, admins"], tag="browser · passkey wallet", icon="user")
s.card(58, 348, 214, 104, "Desktop app", A["edge"],
       ["Electron shell over", "the web origin"], tag="desktop/", icon="desktop")
s.card(58, 468, 214, 118, "AI agents", A["agent"],
       ["MCP clients, scripts,", "automation buyers"], tag="OpenAPI · /mcp · x402", icon="bot")
s.card(58, 602, 214, 118, "Operators", A["ops"],
       ["GitHub approvals,", "release + deploy runs"], tag="workflow_dispatch", icon="gear")

# ======================= GCP =======================
s.zone(320, 140, 900, 860, "Google Cloud · one project per environment", "Runtime platform", A["platform"],
       note="Terraform-managed")

# ---- edge band
panel(340, 214, 860, 104, "GLOBAL HTTPS EDGE", A["edge"], "optional per environment")
edge = [("DNS", "external provider"), ("HTTPS load balancer", "global IP · managed TLS"),
        ("Cloud Armor", "WAF · rate limits"), ("URL map", "web host · API host"),
        ("Serverless NEGs", "frontend · backend")]
ex, ew, eg = 358, 152, 18
for i, (l, sub) in enumerate(edge):
    c = A["data"] if l == "Cloud Armor" else A["edge"]
    s.chip(ex + i * (ew + eg), 254, ew, l, c, h=50, sub=sub, size=13)
    if i:
        s.arrow(f"M{ex + i * (ew + eg) - eg + 2} 279 H{ex + i * (ew + eg) - 3}", A["edge"], width=1.5)

# clients -> DNS
for y, c in ((272, A["edge"]), (400, A["edge"]), (526, A["agent"])):
    s.arrow(f"M272 {y} C308 {y} 318 279 356 279", c)

# ---- Cloud Run panel
panel(340, 340, 860, 264, "CLOUD RUN", A["platform"], "shared runtime SA · VPC connector egress", note_right=1110)
s.card(358, 378, 276, 100, "Frontend", A["platform"], ["Next.js app; server-side calls", "reach the backend directly"],
       tag="service", icon="globe")
s.card(652, 378, 530, 100, "Backend · NestJS API", A["platform"],
       ["REST + OpenAPI, /mcp, x402, Socket.IO; contract and Shows-escrow indexers",
        "run in-process under a lease; agent runtime in-process or as a worker URL"],
       tag="service · /health probes · Secret Manager env", icon="box", glow=True)
s.arrow("M634 428 H650", A["platform"])

s.card(358, 492, 276, 100, "Demucs stem job", A["sound"], ["Started per queued track;", "CPU or GPU, scales to zero"],
       tag="Cloud Run Job · worker image", icon="wave")
s.card(652, 492, 262, 100, "Stable Audio remix", A["sound"], ["GPU service, scale-to-zero,", "minutes-long cold start"],
       tag="service · ID-token invoke", icon="wave")
s.card(932, 492, 250, 100, "Scheduled jobs", A["ops"], ["Analytics load, retention,", "data rights, notices"],
       tag="backend image · Scheduler", icon="gear")
s.arrow("M700 478 V485 H500 V490", A["sound"], dashed=True, width=1.5)
s.arrow("M800 478 V490", A["sound"], width=1.5)

# NEG -> frontend / backend
s.arrow("M1094 304 V329 H496 V376", A["edge"])
s.arrow("M1140 304 V376", A["edge"])
s.label(720, 329, "web host", A["edge"])
s.label(1140, 336, "API host", A["edge"])

# ---- data panel
panel(340, 624, 560, 176, "PRIVATE DATA & MESSAGING", A["data"])
data = [("Cloud SQL", "Postgres 16 · private IP"), ("Memorystore Redis", "BullMQ · Socket.IO"),
        ("Cloud Storage", "media + stems"), ("Secret Manager", "runtime secrets"),
        ("Pub/Sub · stems", "separate · results · DLQ"), ("Pub/Sub · analytics", "events · DLQ")]
for i, (l, sub) in enumerate(data):
    col, row = i % 3, i // 3
    c = A["analytics"] if "analytics" in l else A["data"]
    s.chip(358 + col * 178, 662 + row * 64, 168, l, c, h=52, sub=sub, size=13)

panel(916, 624, 284, 176, "PRIVATE NETWORK", A["ops"])
net = [("Custom VPC + subnet", TEXT), ("Private Google Access", MUTED), ("Serverless VPC Access", TEXT),
       ("connector, private ranges only", MUTED), ("Cloud SQL via private", MUTED), ("service access peering", MUTED)]
for i, (l, c) in enumerate(net):
    s.text(934, 674 + i * 20, l, size=12.5, color=c, weight=550)

# Cloud Run -> data
s.arrow("M560 592 V658", A["data"])
s.arrow("M760 592 V658", A["data"])
s.label(660, 614, "private IP", A["data"])
s.arrow("M1056 592 V622", A["ops"], dashed=True, width=1.4)

# ---- analytics panel
panel(340, 820, 860, 164, "ANALYTICS & INTELLIGENCE", A["analytics"], "execution mode: streaming | batch")
s.chip(358, 858, 214, "Streaming", A["analytics"], h=48, sub="Dataflow Flex Template", size=13)
s.chip(358, 914, 214, "Batch", A["analytics"], h=56, sub="BigQuery subscription + loader", size=13)
s.box(604, 858, 268, 112, "BigQuery warehouse", A["analytics"],
      ["events_raw · events_clean", "analytics_facts · _views", "analytics_quarantine", "events_landing (batch)"])
s.box(904, 858, 278, 112, "Dataform marts", A["analytics"],
      ["agent taste scores", "discovery popularity", "built from events_clean", "read back by backend APIs"], mono=False, size=11.5)
s.arrow("M574 882 C590 882 588 900 602 900", A["analytics"], width=1.5)
s.arrow("M574 942 C590 942 588 928 602 928", A["analytics"], width=1.5)
s.arrow("M874 914 H902", A["analytics"], width=1.5)
# pub/sub analytics -> modes
s.arrow("M797 776 V810 H560 V856", A["analytics"], dashed=True)
# marts -> backend (read path)
s.arrow("M1184 914 H1208 V440 H1186", A["analytics"], dashed=True)

# ======================= Right column =======================
s.zone(1250, 140, 310, 300, "Google & third-party APIs", "Outside the VPC", A["agent"])
ext = [("Vertex AI", "Gemini · Lyria · embeddings", A["agent"]), ("Hugging Face", "Stable Audio model weights", A["sound"]),
       ("SMTP provider", "notices + bounce webhook", A["ops"]), ("Human verification", "World ID · Gitcoin Passport", A["ops"])]
for i, (l, sub, c) in enumerate(ext):
    s.chip(1268, 204 + i * 56, 274, l, c, h=48, sub=sub, size=13)

s.zone(1250, 460, 310, 340, "Protocol & payments", "On-chain commerce", A["chain"])
s.chip(1268, 524, 274, "ERC-4337 bundler", A["chain"], h=44, sub="UserOps from passkeys + session keys", size=13)
s.chip(1268, 580, 132, "EntryPoint", A["chain"], h=44, sub="v0.7", size=13)
s.chip(1410, 580, 132, "Kernel", A["chain"], h=44, sub="smart accounts", size=13)
s.arrow("M1334 568 V578", A["chain"], width=1.4)
s.arrow("M1400 602 H1408", A["chain"], width=1.4)
s.text(1268, 646, "Resonate contracts · Base Sepolia / EVM", size=12, color=TEXT, weight=650)
for i, l in enumerate(["StemNFT · StemMarketplaceV2", "ShowCampaignEscrow · RevenueEscrow", "ContentProtection · CurationRewards", "DisputeResolution · TransferValidator"]):
    s.text(1268, 666 + i * 17, l, size=11, color=MUTED, weight=550)
s.chip(1268, 738, 274, "x402 facilitator → USDC", A["pay"], h=44, sub="verify / settle · receipts", size=13)

s.zone(1250, 820, 310, 180, "Observability", "Cloud Monitoring", A["ops"])
for i, l in enumerate(["Uptime checks: API, worker, indexer", "Alerts: 5xx, latency, DB, Redis,", "queue + DLQ backlog, analytics lag", "JSON logs · degraded.fallback", "Dashboards · billing budget"]):
    s.text(1268, 898 + i * 19, l, size=12, color=MUTED, weight=550)

# backend -> right column
s.arrow("M1182 396 C1226 396 1222 306 1266 306", A["agent"])
s.arrow("M1182 460 C1230 460 1224 546 1266 546", A["chain"])
s.label(1232, 484, "viem", A["chain"])

# ======================= Delivery =======================
s.zone(40, 1028, 1520, 236, "Delivery", "Exact-SHA releases", A["ops"])
lane_y = 1142
steps = [
    ("CI", "PR · queue · main · develop", "validate only", A["ops"]),
    ("Release Deployment", "manual · exact SHA", "reusable CI gate", A["ops"]),
    ("Publish images", "Cloud Build · SHA tag", "cosign · SBOM · in-toto", A["platform"]),
    ("Artifact Registry", "per-environment repo", "immutable digests", A["platform"]),
    ("Deploy manifest v2", "digest-bound handoff", "stable release → staging", A["platform"]),
    ("Verify", "digest · signer · source SHA", "branch → environment", A["data"]),
    ("Terraform apply", "targeted image refs", "GCS state · WIF", A["data"]),
    ("Reconcile", "live revision digest", "jobs re-pinned · evidence", A["data"]),
]
sw_, sg = 170, 18
x0 = 60
for i, (l, a, b, c) in enumerate(steps):
    x = x0 + i * (sw_ + sg)
    s.rect(x, lane_y, sw_, 66, rx=12, fill=c, stroke=c, sw=1, extra='fill-opacity="0.10" stroke-opacity="0.5"')
    s.text(x + 14, lane_y + 22, l, size=13, weight=700)
    s.text(x + 14, lane_y + 40, a, size=10.8, color=MUTED, weight=520)
    s.text(x + 14, lane_y + 56, b, size=10.8, color=FAINT, weight=520)
    if i:
        s.arrow(f"M{x - sg + 2} {lane_y + 33} H{x - 3}", c if i < 5 else A["data"], width=1.5, dashed=(i == 5))


def bracket(x1, x2, label, c, sub):
    y = 1122
    s.add(f'<path d="M{x1} {y + 6} V{y} H{x2} V{y + 6}" stroke="{c}" stroke-width="1.2" fill="none" opacity="0.6"/>')
    s.text(x1, y - 9, label, size=11.5, color=c, weight=700, mono=True)
    s.text(x1 + len(label) * 7.1 + 10, y - 9, sub, size=11, color=FAINT, weight=550)


bracket(60, x0 + 5 * (sw_ + sg) - sg, "akoita/resonate", A["platform"], "public · build + sign")
bracket(x0 + 5 * (sw_ + sg), x0 + 8 * (sw_ + sg) - sg, "resonate-iac", A["data"], "private · state, IAM, rollout")
s.text(60, 1234, "develop → dev · main → staging · production is a manual IaC operation. "
       "Images are never rebuilt during deploy; app and IaC versions stay independent.", size=11.5, color=FAINT, weight=550)
s.text(60, 1251, "Full-infrastructure applies (edge, network, data, analytics, monitoring) use the same rendered environment config.",
       size=11.5, color=FAINT, weight=550)

# operators -> release deployment
s.arrow("M165 720 V1012 H390 V1140", A["ops"], dashed=True, width=1.5)
s.label(165, 760, "approve + dispatch", A["ops"])
# reconcile -> runtime
s.arrow("M1460 1140 V1100 H1236 V700 H1223", A["data"], dashed=True)
s.label(1330, 1100, "reconciles runtime", A["data"])

s.legend(62, 1298, [("request / call", A["platform"], False), ("async · queued · read-back", A["analytics"], True),
                    ("on-chain path", A["chain"], False), ("delivery", A["data"], False)])
s.text(1538, 1302, "Narrative + mermaid: docs/architecture/deployment_architecture.md", size=11, color=FAINT,
       weight=550, anchor="end", mono=True)

OUT = Path(__file__).resolve().parents[2] / "docs" / "architecture" / "resonate-deployment-architecture.svg"
Path(sys.argv[1] if len(sys.argv) > 1 else OUT).write_text(s.render())
