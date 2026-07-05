# PsicoLab / PsychLab

A free, bilingual (PT/EN) psychology website: interactive self-knowledge tests, evidence-based tools, and games about the mind — built as a static site with an optional, end-to-end encrypted account layer for saving and syncing your own results across devices.

**Live site:** [erikaabrown.github.io](https://erikaabrown.github.io)

> PsicoLab is an educational/recreational project. Nothing here is a clinical diagnosis or a substitute for a mental health professional.

## Features

- **7 psychological tests** — Big Five personality, Attachment style, Emotional Intelligence, Perceived Stress, Rosenberg Self-Esteem, Resilience, PANAS (positive/negative affect).
- **10 tools** — mood diary, thought record (CBT), breathing exercise, guided meditation, gratitude journal, habit tracker, sleep diary, worry box, progressive muscle relaxation, and a patterns/insights panel that surfaces trends across your own logged data.
- **10 games** — Stroop test, reaction time, emotion recognition, cognitive bias quiz, prisoner's dilemma, choose-your-path adventure, digit span, myth-or-fact quiz, N-back, and a cognitive-distortion spotting game.
- **Learn section** — a 60+ term glossary, a history-of-psychology timeline, and a daily-refreshed page of psychology articles (see [Articles pipeline](#articles-pipeline)).
- **Optional account**, end-to-end encrypted:
  - Every tool's data is encrypted client-side (AES-GCM) with a random data encryption key (DEK) that never leaves the browser unencrypted.
  - **Recovery codes**: the DEK is wrapped twice — once with a key derived from the password, once with a key derived from a one-time recovery code — so a forgotten password doesn't mean lost data.
  - **Professional sharing**: an account can connect to a professional (e.g. a psychologist) via a short code and choose exactly which categories to share. Sharing uses pairwise ECDH (P-256) key exchange, so the server only ever stores ciphertext and public keys, never a shared secret or plaintext.
  - An admin-gated panel grants professional status and manages users.
- **Bilingual (PT/EN) and light/dark theme**, both persisted locally.
- **Security hardening**: progressive account lockout, timing-safe login/recovery lookups, a signup honeypot, an IP tarpit/blocklist for scanner traffic, and a Content-Security-Policy on every page.

## Tech stack

- **Frontend**: static HTML/CSS/vanilla JavaScript. No framework, no build step, no dependencies to install — this is intentional, so it deploys as-is on GitHub Pages.
- **Backend** (optional, only needed for the account/sync features): a [Cloudflare Worker](https://developers.cloudflare.com/workers/) + [D1](https://developers.cloudflare.com/d1/) (SQLite) database, both on Cloudflare's free tier. See [`cloudflare/README.md`](cloudflare/README.md) for the full setup walkthrough.
- **Crypto**: the Web Crypto API (AES-GCM for data encryption, ECDH P-256 for pairwise key exchange, PBKDF2 for password-based key derivation) — no external crypto library.

## Project structure

```
index.html              Homepage: hero, test/tool/game cards
account.html            Sign up / sign in, profile, sync, professional connections
professional.html       Dashboard for professional accounts (connected patients)
admin.html              Admin-only panel (search users, grant professional status)

tests/                  The 7 psychological tests
tools/                  The 10 self-help tools
games/                  The 10 games
learn/                  Glossary, timeline, articles

css/style.css           Shared design system (light/dark themes)
js/app.js               Shared i18n, theme, header/footer, small helpers
js/sync.js              Account/sync client: crypto, API calls, encrypted local cache

img/                    Site artwork (logo, favicon, test icons)
data/articles.json      Cached articles feed, refreshed daily (see below)
scripts/fetch-articles.js   Script that regenerates data/articles.json
.github/workflows/      Daily articles refresh + Cloudflare deploy

cloudflare/             Worker source, D1 schema, migrations, backend setup guide
```

## Running locally

No build step and no dependencies — any static file server works:

```bash
python3 -m http.server 8765
# then open http://localhost:8765/index.html
```

The account/sync features need the Cloudflare backend running (see below); everything else — every test, tool, game, and the Learn section — works fully offline against `localStorage`.

## Backend setup

The account layer is entirely optional. To enable it, follow the step-by-step (dashboard-only, no CLI) guide in [`cloudflare/README.md`](cloudflare/README.md): create a D1 database, deploy the Worker, wire up the bindings, and point `js/sync.js`'s `API_BASE` at your Worker's URL.

## Articles pipeline

`scripts/fetch-articles.js` pulls and summarizes psychology articles into `data/articles.json`, rendered by `learn/articles.html`. A scheduled GitHub Action (`.github/workflows/update-articles.yml`) re-runs it daily and commits any changes.

## License

Licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) (Attribution-NonCommercial-ShareAlike). You're free to share and adapt this project with credit, as long as it's non-commercial and any derivative is shared under the same license. See [`LICENSE`](LICENSE) for the full terms.
