# NammaArea — Bangalore (personal v1)

**NammaArea** ("Our Area" in Kannada) is a personal, single-page web app. Drop a pin in Bangalore → see your MP, MLA, BBMP corporator, and recent public works in your ward with contractor names and rupee amounts. Plus one-tap links to BESCOM, BWSSB, and BBMP property tax portals.

## Status

⚠️ **Personal project. Not production ready. Do not use as a source of trust.**

- Data is bundled at build time and may be stale by weeks or months.
- Location resolution, polygon containment, and politician info have not been independently verified.
- The author makes no claim on accuracy. **Always verify with official sources before acting on any information here.**
- Pull requests welcome for any data corrections. See `/data` directory.

## How it works

1. Tap "Find my area"
2. Browser shares your GPS coordinates (or type a place / pincode)
3. We resolve: pincode → Parliament + Assembly constituency → BBMP ward (point-in-polygon)
4. We render representative cards + any bundled public works in your ward
5. Tap any utility tile (BESCOM / BWSSB / BBMP tax) → opens the official portal in a new tab

## Editing data

- Add or fix a representative → edit `/data/{mps,mlas,corporators}.json`
- Update public works → replace `/data/works.json` (see `/scripts/README.md` for a future GitHub Action to automate this)
- Service / utility links → edit `/data/{services,utilities}.json`

## Local development

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

No build step. Edit a JSON, refresh the browser.

## Roadmap

- v1.1: GitHub Actions cron to crawl kppp.karnataka.gov.in weekly, regenerate `works.json`
- v1.2: Kannada interface (ಕನ್ನಡ)
- v2: MLALADS fund tracker; ADR affidavit comparison view for elections

## Tech stack

- Plain HTML + vanilla JS + CSS — no framework, no build step
- Leaflet 1.9.x + OpenStreetMap tiles (free, no API key)
- Turf.js 7.x for point-in-polygon
- Nominatim for forward + reverse geocoding (rate-limited, no key)
- Static JSON in `/data/`
- Hosted on GitHub Pages

## Source

- Owner: Sachin Acharya
- Repo: https://github.com/light-saber/nammaarea
- License: MIT
