# The Daybook — Education & News Blog

A pure HTML/CSS editorial blog theme (no site-visitor JavaScript required),
with a local Node admin panel for publishing, and auto-deploy to Firebase
Hosting via GitHub Actions.

## What's in the box

```
public/                    ← the live static site (deploy target)
  index.html                front page: hero story + latest ledger + sidebar
  education/index.html      Education category archive
  news/index.html           News category archive
  education/*.html          individual Education articles
  news/*.html                individual News articles
  about.html, contact.html, 404.html
  css/style.css              the whole design system
  posts.json                 registry of every post (source of truth)
  sitemap.xml, robots.txt, rss.xml
admin/                      ← local-only authoring tool, not deployed
  server.js                  the admin server
  views/                     login + dashboard UI
.github/workflows/deploy.yml
firebase.json
```

## Why this is built to rank

- **Every page** has a unique `<title>`, meta description, canonical URL,
  Open Graph + Twitter Card tags, and JSON-LD structured data.
- **Articles** carry `Article` (Education) or `NewsArticle` (News) schema
  with headline, author, publish/modified dates, and a `BreadcrumbList` —
  what Google uses for rich results and to understand freshness.
- **Semantic HTML**: one `<h1>` per page, real `<article>`/`<nav>`/`<main>`
  landmarks, descriptive `alt` text, a skip-link, visible focus states.
- **No render-blocking JS for visitors** — the public site is just HTML and
  CSS, so it's fast by default (good for Core Web Vitals, which factors into
  ranking and Discover eligibility).
- **`sitemap.xml`** is regenerated automatically on every publish, so new
  URLs are in it immediately — submit it once in Google Search Console and
  every future post is picked up without resubmitting.
- **`rss.xml`** gives Google (and feed readers) a fast, structured signal
  the moment a new article goes live.

### Getting it in front of Google Discover specifically

Discover leans heavily on large, high-quality images and E-E-A-T signals:

1. Use real photos/illustrations at **1200×630 or larger** for every
   article's cover image (the `image` field in the admin form) — this is
   what feeds `og:image` and the `NewsArticle`/`Article` schema `image`.
2. Keep author bylines real and consistent (`author` field) — Discover and
   News surfaces reward publications with identifiable authors.
3. Publish and update dates matter — the admin server always stamps the
   current date, and `dateModified` should be updated whenever you edit a
   published piece (re-submit the post with the same slug to refresh it).
4. Once live, verify the domain in **Google Search Console** and check the
   "Enhancements" reports for Article/NewsArticle validity.

## One-time setup

### 1. Replace the placeholder domain

Every file uses `https://thedaybook.com`. Find-and-replace it with your
real domain throughout `public/` (and set `SITE_URL` in `admin/.env`).

### 2. Add real images

The theme references image paths like `images/hero-placeholder.jpg` and
`images/thumb-*.jpg` under `public/images/` — add your own files at those
paths (or update the paths) before going live. Minimum 1200×630 for cover
images used in `og:image`/Discover.

### 3. Push to GitHub

```bash
cd site-project
git init
git add -A
git commit -m "Initial blog"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Make sure `git` is authenticated locally (SSH key or `gh auth login`) so
the admin panel's automatic `git push` doesn't prompt for credentials.

### 4. Create a Firebase Hosting site & connect GitHub Actions

```bash
npm install -g firebase-tools
firebase login
firebase init hosting        # public directory = "public"
firebase init hosting:github # wires up the GITHUB deploy secret automatically
```

Replace `your-firebase-project-id` in `.github/workflows/deploy.yml` with
your real project ID if `hosting:github` didn't already do it for you.

### 5. Configure and run the admin panel

```bash
cd admin
cp .env.example .env
# edit .env: ADMIN_USER, ADMIN_PASS, SESSION_SECRET, SITE_URL
npm install
npm start
```

Visit **http://localhost:4000** → log in → fill in the post form → Publish.
The server writes the article, updates the homepage/category listings,
regenerates `sitemap.xml` and `rss.xml`, commits, and pushes — the GitHub
Action deploys the update automatically.

## After launch: search console checklist

1. Verify the domain in Google Search Console (DNS or HTML file method).
2. Submit `https://yourdomain.com/sitemap.xml` under Sitemaps.
3. Use the URL Inspection tool to request indexing for your first few posts.
4. Check the Page Experience and Core Web Vitals reports after a week of
   real traffic.

## Notes

- The admin panel is meant to run on your own machine — the hardcoded
  login is convenient for local use, not hardened for public exposure.
- Publishing with an existing slug + category overwrites that post in
  place (good for corrections and refreshing `dateModified`).
- Content pasted without HTML tags is auto-wrapped in a `<p>`; anything
  with real markup (`<h2>`, `<blockquote>`, etc.) is used as-is.
