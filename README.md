# Rabar.nl Website

Moderne, statische website voor Rabar - specialist in thuisnetwerken en smarthomes.

## 🚀 Tech Stack

- **Framework**: [Astro](https://astro.build) - Statische site generator
- **Styling**: [Tailwind CSS](https://tailwindcss.com) - Utility-first CSS
- **Blog**: [Ghost](https://ghost.org) - Headless CMS via Content API
- **Hosting**: GitHub Pages (of andere statische hosting)

## 📁 Projectstructuur

```
rabar-website/
├── src/
│   ├── components/       # Herbruikbare componenten
│   │   ├── Header.astro
│   │   ├── Footer.astro
│   │   ├── ServiceCard.astro
│   │   └── BlogPostPreview.astro
│   ├── layouts/          # Pagina layouts
│   │   └── BaseLayout.astro
│   ├── lib/              # Utilities en API clients
│   │   └── ghost.ts      # Ghost CMS client
│   └── pages/            # Pagina's (file-based routing)
│       ├── index.astro   # Homepage
│       ├── diensten.astro
│       ├── werkwijze.astro
│       ├── contact.astro
│       └── blog/
│           ├── index.astro
│           └── [slug].astro
├── public/               # Statische assets
│   ├── images/
│   │   └── logo.png
│   └── favicon.svg
├── astro.config.mjs
├── tailwind.config.mjs
└── package.json
```

## 🛠️ Development

### Vereisten

- Node.js 22.18+ (de unit tests importeren `src/lib/ghost.ts` rechtstreeks en
  leunen op Node's native TypeScript type stripping)
- npm of yarn

### Installatie

```bash
# Clone de repository
git clone https://github.com/YOUR_USERNAME/rabar-website.git
cd rabar-website

# Installeer dependencies
npm install

# Start development server
npm run dev
```

De site draait nu op `http://localhost:4321`

### Build voor productie

```bash
npm run build
```

De statische site staat nu in de `dist/` map.

### Tests en coverage

```bash
npm test          # node --test tests/*.test.mjs
npm run coverage  # dezelfde suite via c8: line total + de drempel uit .c8rc.json
```

- `tests/deploy-workflow.test.mjs` voert de echte `run:`-blokken van
  `.github/workflows/deploy.yml` uit met een nagebootste `curl`.
- `tests/ghost.test.mjs` test de Ghost-client (`src/lib/ghost.ts`), inclusief de
  terugval op de meegeleverde posts als de Content API onbereikbaar is.
- `tests/coverage-workflow.test.mjs` bewaakt de coverage-tooling zelf.
- `npm run coverage` meet de broncode in `src/` (met `"all": true` in
  `.c8rc.json`, dus ook bestanden zonder tests) en faalt onder de drempel
  (`"lines"`).
- `coverage/lcov.info` is meegecommit: dat is het duurzame bewijs van de gemeten
  dekking. `.github/workflows/build.yml` draait dezelfde stap en faalt als het
  rapport niet meer bij de bron hoort.

CI gebruikt bewust exact Node 22.23.1: de per-regel-tellers in
`coverage/lcov.info` zijn met die versie gegenereerd.

## 🔧 Configuratie

### Ghost Blog

1. Maak een Ghost blog aan (self-hosted of Ghost Pro)
2. Ga naar Settings → Integrations → Add custom integration
3. Kopieer de Content API Key en URL
4. Maak een `.env` bestand:

```env
GHOST_URL=
GHOST_KEY=
```

Zonder `.env` worden dummy blogposts getoond (handig voor development).

### Contact Formulier

Het contactformulier gebruikt [Formspree](https://formspree.io):

1. Maak een gratis Formspree account
2. Maak een nieuw form aan
3. Vervang `YOUR_FORM_ID` in `src/pages/contact.astro`

### Aanpassen

- **Kleuren**: `tailwind.config.mjs` - Rabar brand colors
- **Contactgegevens**: `src/components/Footer.astro` en `src/pages/contact.astro`
- **Inhoud**: Direct in de `.astro` bestanden

## 🚀 Deployment

### GitHub Pages

1. Push naar GitHub
2. Ga naar repository Settings → Pages
3. Selecteer "GitHub Actions" als source
4. Voeg secrets toe (Settings → Secrets → Actions):
   - `GHOST_URL`
   - `GHOST_KEY`

De site wordt automatisch gedeployed bij elke push naar `main`.

### Custom Domain (rabar.nl)

1. Maak een `CNAME` bestand in `public/` met `rabar.nl`
2. Configureer DNS bij je domeinprovider:
   - A record: `185.199.108.153` (en .109, .110, .111)
   - Of CNAME: `YOUR_USERNAME.github.io`

## 📝 Content Updaten

### Blogposts

Schrijf posts in Ghost - ze worden automatisch opgehaald tijdens de build.

Voor automatische rebuilds bij nieuwe posts:
- Configureer een Ghost webhook naar GitHub Actions
- Of gebruik een scheduled workflow

### Pagina's

Bewerk de `.astro` bestanden direct. De content is hardcoded voor maximale snelheid en veiligheid.

## 🔒 Beveiliging

- ✅ Geen database - niets om te hacken
- ✅ Geen server-side code
- ✅ Statische HTML/CSS/JS
- ✅ Formulieren via externe service
- ✅ HTTPS via GitHub Pages

## 📄 Licentie

Privé project voor Rabar.