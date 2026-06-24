# Sample Show Campaign Fixtures

This directory contains the media used by `npm run fixtures:shows`. The command
creates four stable, idempotent demo campaigns and refreshes their dates so they
remain useful in local demos.

These are **fictional fan-created campaign concepts**. They do not represent
artist approval, venue confirmation, a booking hold, ticket inventory, or an
active escrow deployment.

Generated campaign artwork must remain music-first and non-sensual: modest
opaque stagewear, neutral framing, and no emphasis on exposed bodies. The same
standard applies when selecting real artist photos.

## Usage

```bash
cd backend
npm run fixtures:shows -- --dry-run
npm run fixtures:shows
```

Shared environments are blocked unless `ALLOW_SAMPLE_SHOW_FIXTURES=true` is set
explicitly. `SAMPLE_SHOWS_CHAIN_ID` overrides the local chain ID and
`SAMPLE_SHOWS_ASSET_DIR` can point to a reviewed external asset directory.

## Artist research sources

Artist biographies are concise editorial summaries based on the official,
MusicBrainz, and encyclopedia links embedded beside each fixture in
`backend/src/fixtures/show_campaigns.ts`. Factual biography and fictional show
copy are stored separately.

## Image rights

Each campaign gallery mixes three kinds of image:

- **Project-owned generated artwork** — the cinematic hero of each campaign.
- **Openly licensed real photos** (Creative Commons from Wikimedia Commons) —
  the venue and city images.
- **Real artist photos used for demo only** — each artist's portrait/live shot
  is a recent press, official, or editorial-stock photo of the artist. These
  are **© the artist/label/photographer/agency, all rights reserved**, included
  solely as non-commercial sample content so the demo looks realistic. Some
  (Aya Nakamura, Leona Lewis) are **Getty Images editorial stock** — using
  those beyond a local demo requires a Getty license. Replace every artist
  photo with approved/licensed assets (or remove it) before any public or
  commercial use. Each is a one-file swap; the manifest references them by
  filename.

## Asset provenance

| File | Creator/source | License | Source |
| --- | --- | --- | --- |
| `sennarin-paris-hero.jpg` | SennaRin / staff | All rights reserved — demo use only | Official photo (cropped to remove caption) via [@senna_rin on X](https://x.com/senna_rin/media) |
| `sennarin-portrait.jpg` | SennaRin / staff | All rights reserved — demo use only | Official photo via [@senna_rin on X](https://x.com/senna_rin/media) |
| `sennarin-editorial.jpg` | SennaRin / staff | All rights reserved — demo use only | Official photo via [@senna_rin on X](https://x.com/senna_rin/media) |
| `sennarin-paris-venue.jpg` | Celette | CC BY-SA 4.0 | [Le Trianon, Paris](https://commons.wikimedia.org/wiki/File:Le_Trianon,_80_boulevard_de_Rochechouart,_Paris_18e.jpg) |
| `felicia-farerre-dublin-hero.jpg` | Felicia Farerre | All rights reserved — demo use only | Wide hero composed from her “After Rain” single cover art (blurred-fill background + portrait) via [her official site](https://www.feliciafarerre.com/) |
| `felicia-farerre-portrait.jpg` | Felicia Farerre | All rights reserved — demo use only | “After Rain” single cover art via [her official site](https://www.feliciafarerre.com/) |
| `felicia-farerre-studio.jpg` | Felicia Farerre | All rights reserved — demo use only | Press photo via [Crossover Music Magazine](https://crossovermusicmagazine.com/) |
| `felicia-farerre-dublin-venue.jpg` | William Murphy | CC BY-SA 2.0 | [Dame Street — The Olympia Theatre](https://commons.wikimedia.org/wiki/File:Dame_Street_-_The_Olympia_Theatre_(3433685951).jpg) |
| `leona-lewis-lagos-hero.jpg` | Getty Images | All rights reserved — licensed stock, demo use only | Editorial concert photo, Abu Dhabi ([Getty Images](https://www.gettyimages.fr/)) |
| `leona-lewis-live.jpg` | Getty Images | All rights reserved — licensed stock, demo use only | Editorial photo, amfAR Venice 2023 ([Getty Images](https://www.gettyimages.fr/)) |
| `leona-lewis-vegas.jpg` | Getty Images | All rights reserved — licensed stock, demo use only | Editorial concert photo, Las Vegas Christmas show ([Getty Images](https://www.gettyimages.fr/)) |
| `leona-lewis-wimbledon.jpg` | Getty Images | All rights reserved — licensed stock, demo use only | Editorial photo, Wimbledon ([Getty Images](https://www.gettyimages.fr/)) |
| `leona-lewis-lagos-city.jpg` | SmartAfricanBoy | CC BY-SA 4.0 | [Eko Atlantic skyline](https://commons.wikimedia.org/wiki/File:Eko_Atlantic_(Lagos)_Skyline.jpg) |
| `aya-nakamura-montreal-hero.jpg` | Mathis.aclr | CC0 1.0 (public domain) | Wide hero composed from a live performance photo, Aulnay-sous-Bois 2026 ([Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Aya_Nakamura_IMG_4756_(cropped).jpg)) |
| `aya-nakamura-portrait.jpg` | Getty Images | All rights reserved — licensed stock, demo use only | Editorial photo, 2024 ([Getty Images](https://www.gettyimages.fr/)) |
| `aya-nakamura-live.jpg` | Getty Images | All rights reserved — licensed stock, demo use only | Editorial concert photo, OVO Arena Wembley 2023 ([Getty Images](https://www.gettyimages.fr/)) |
| `aya-nakamura-stage.jpg` | Getty Images | All rights reserved — licensed stock, demo use only | Editorial concert photo, OVO Arena Wembley 2023 ([Getty Images](https://www.gettyimages.fr/)) |
| `aya-nakamura-montreal-city.jpg` | Mathieu Landretti | CC BY-SA 4.0 | [Montréal skyline at night](https://commons.wikimedia.org/wiki/File:Montreal_Skyline_at_Night.jpg) |

CC venue/city assets retrieved from Wikimedia Commons; real artist photos
retrieved from public press/official sources on 2026-06-24. Preserve this table
whenever an asset is replaced, and keep the rights status accurate.
