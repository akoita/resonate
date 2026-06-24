# Sample Show Campaign Fixtures

This directory contains the media used by `npm run fixtures:shows`. The command
creates four stable, idempotent demo campaigns and refreshes their dates so they
remain useful in local demos.

These are **fictional fan-created campaign concepts**. They do not represent
artist approval, venue confirmation, a booking hold, ticket inventory, or an
active escrow deployment.

Generated campaign artwork must remain music-first and non-sensual: modest
opaque stagewear, neutral framing, and no emphasis on exposed bodies. Real
artist photographs require a documented reuse license in the table below.

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

## Asset provenance

| File | Creator/source | License | Source |
| --- | --- | --- | --- |
| `sennarin-paris-hero.jpg` | OpenAI image generation for Resonate | Project-owned generated sample artwork | Generated for issue #1224; performer shown from behind and is not represented as SennaRin's likeness |
| `sennarin-paris-venue.jpg` | Celette | CC BY-SA 4.0 | [Le Trianon, Paris](https://commons.wikimedia.org/wiki/File:Le_Trianon,_80_boulevard_de_Rochechouart,_Paris_18e.jpg) |
| `felicia-farerre-dublin-hero.jpg` | OpenAI image generation for Resonate | Project-owned generated sample artwork | Generated for issue #1224; performer shown from behind and is not represented as Felicia Farerre's likeness |
| `felicia-farerre-dublin-venue.jpg` | William Murphy | CC BY-SA 2.0 | [Dame Street — The Olympia Theatre](https://commons.wikimedia.org/wiki/File:Dame_Street_-_The_Olympia_Theatre_(3433685951).jpg) |
| `leona-lewis-lagos-hero.jpg` | OpenAI image generation for Resonate | Project-owned generated sample artwork | Generated for issue #1224; performer shown from behind and is not represented as Leona Lewis's likeness |
| `leona-lewis-lagos-city.jpg` | SmartAfricanBoy | CC BY-SA 4.0 | [Eko Atlantic skyline](https://commons.wikimedia.org/wiki/File:Eko_Atlantic_(Lagos)_Skyline.jpg) |
| `leona-lewis-portrait.jpg` | Mercy For Animals MFA; crop by Lucas Secret | CC BY 2.0 | [Leona Lewis 2014](https://commons.wikimedia.org/wiki/File:Leona_Lewis_2014.jpg) |
| `aya-nakamura-montreal-hero.jpg` | OpenAI image generation for Resonate | Project-owned generated sample artwork | Generated for issue #1224; performer shown from behind and is not represented as Aya Nakamura's likeness |
| `aya-nakamura-montreal-city.jpg` | Mathieu Landretti | CC BY-SA 4.0 | [Montréal skyline at night](https://commons.wikimedia.org/wiki/File:Montreal_Skyline_at_Night.jpg) |
| `aya-nakamura-portrait.jpg` | Ayanakamura_officielfan | CC0 | [Aya Nakamura, cropped](https://commons.wikimedia.org/wiki/File:Aya_Nakamura_IMG_4756_(cropped).jpg) |

Retrieved from Wikimedia Commons on 2026-06-21. Preserve this table whenever an
asset is replaced; do not add unlicensed artist press photography.
