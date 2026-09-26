/**
 * Blog admin panel for The Daybook.
 * - JWT-based HttpOnly cookie auth (Vercel serverless compatible)
 * - Add a post: title, category (education/news), description, author,
 *   optional cover image upload (auto-optimized to WebP via sharp)
 * - On submit the server:
 *     1. optimizes uploaded cover image → WebP ≤1200×630 via sharp
 *     2. commits image + article HTML + homepage/category/sitemap/rss
 *        directly to GitHub via API (no git push, no local disk writes)
 */

require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { Octokit } = require('@octokit/rest');

const app = express();
const PORT = process.env.PORT || 4000;

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'changeme123';
const SITE_URL = process.env.SITE_URL || 'https://my-blog-55217.web.app';
const SITE_NAME = 'The Daybook';

// GitHub Setup — all values from environment, never hardcoded secrets
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER || 'rahul-kumarrxk';
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME || 'blogging-site';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

const octokit = new Octokit({ auth: GITHUB_TOKEN });

// Local paths used only for reading existing HTML templates
// (on Vercel the repo is not present, so GitHub API is used instead)
const REPO_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');
const POSTS_JSON = path.join(PUBLIC_DIR, 'posts.json');
const INDEX_HTML = path.join(PUBLIC_DIR, 'index.html');

const CATEGORIES = {
  education: { label: 'Education', schemaType: 'Article' },
  news: { label: 'News', schemaType: 'NewsArticle' },
};

// Accept both the HTML content file and the cover image in one multipart form
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB max per file
});
const uploadFields = upload.fields([
  { name: 'file', maxCount: 1 },   // .html content file
  { name: 'coverImage', maxCount: 1 }, // cover image
]);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// ---- Stateless JWT auth — works across serverless cold starts ----

const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-session-secret';

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.admin_token;
  if (!token) return res.redirect('/login');
  try {
    jwt.verify(token, SESSION_SECRET);
    next();
  } catch (err) {
    res.clearCookie('admin_token');
    res.redirect('/login');
  }
}

// ---- Helpers ----

function slugify(str) {
  return (
    str
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '')
      .slice(0, 70) || 'post'
  );
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Safe slug validation — prevents path traversal
function isValidSlug(slug) {
  return /^[a-z0-9-]{1,70}$/.test(slug) && !slug.includes('..');
}

// Read posts.json from local disk (when running locally)
// On Vercel we fetch it via GitHub API instead
function readPostsLocal() {
  if (!fs.existsSync(POSTS_JSON)) return [];
  return JSON.parse(fs.readFileSync(POSTS_JSON, 'utf8'));
}

// ---- Article page template ----

function wrapArticle(content) {
  if (/<p[\s>]|<h[1-6][\s>]|<ul[\s>]|<blockquote/i.test(content)) return content;
  return `<p>${content}</p>`;
}

function renderArticlePage(post) {
  const cat = CATEGORIES[post.category];
  const url = `${SITE_URL}/${post.category}/${post.slug}.html`;
  const img = post.image ? `${SITE_URL}/${post.image}` : `${SITE_URL}/images/og-default.jpg`;
  const isoDate = `${post.date}T09:00:00+05:30`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(post.title)} | ${SITE_NAME}</title>
<meta name="description" content="${escapeHtml(post.description)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow, max-image-preview:large">

<meta property="og:type" content="article">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${escapeHtml(post.title)}">
<meta property="og:description" content="${escapeHtml(post.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${img}">
<meta property="article:published_time" content="${isoDate}">
<meta property="article:modified_time" content="${isoDate}">
<meta property="article:section" content="${cat.label}">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(post.title)}">
<meta name="twitter:description" content="${escapeHtml(post.description)}">
<meta name="twitter:image" content="${img}">

<link rel="alternate" type="application/rss+xml" title="${SITE_NAME} feed" href="/rss.xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../css/style.css">

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "${SITE_URL}/" },
    { "@type": "ListItem", "position": 2, "name": "${cat.label}", "item": "${SITE_URL}/${post.category}/" },
    { "@type": "ListItem", "position": 3, "name": "${escapeHtml(post.title)}", "item": "${url}" }
  ]
}
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "${cat.schemaType}",
  "headline": "${escapeHtml(post.title)}",
  "description": "${escapeHtml(post.description)}",
  "image": ["${img}"],
  "datePublished": "${isoDate}",
  "dateModified": "${isoDate}",
  "author": { "@type": "Person", "name": "${escapeHtml(post.author)}" },
  "publisher": { "@id": "${SITE_URL}/#organization" },
  "mainEntityOfPage": { "@type": "WebPage", "@id": "${url}" },
  "articleSection": "${cat.label}"
}
</script>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="masthead">
  <div class="wrap">
    <div class="masthead-top"><p class="wordmark"><a href="/">${SITE_NAME}</a></p></div>
    <nav class="primary-nav" aria-label="Primary">
      <ul>
        <li><a href="/">Front page</a></li>
        <li><a href="/education/">Education</a></li>
        <li><a href="/news/">News</a></li>
        <li><a href="/about.html">About</a></li>
        <li><a href="/contact.html">Contact</a></li>
      </ul>
    </nav>
  </div>
</header>
<main id="main">
  <p class="breadcrumb wrap"><a href="/">Home</a> / <a href="/${post.category}/">${cat.label}</a> / ${escapeHtml(post.title)}</p>
  <div class="wrap">
    <div class="article-header">
      <p class="category-tag">${cat.label}</p>
      <h1>${escapeHtml(post.title)}</h1>
      <p class="article-meta">
        <span>By ${escapeHtml(post.author)}</span>
        <span>Published <time datetime="${post.date}">${post.date}</time></span>
        <span>${escapeHtml(post.readTime || '')}</span>
      </p>
    </div>
    <article class="article-body">
      ${wrapArticle(post.contentHtml)}
    </article>
  </div>
</main>
<footer class="site-footer">
  <div class="wrap">
    <div class="footer-bottom">
      <span>© ${new Date().getFullYear()} ${SITE_NAME}. All rights reserved.</span>
      <span><a href="/sitemap.xml">Sitemap</a> · <a href="/rss.xml">RSS</a></span>
    </div>
  </div>
</footer>
</body>
</html>
`;
}

// ---- Regenerate HTML strings (in-memory, no disk writes) ----

function articleRowHtml(post, pathPrefix) {
  const cat = CATEGORIES[post.category];
  const href = `${pathPrefix}${post.category}/${post.slug}.html`;
  const img = post.image ? `${pathPrefix}${post.image}` : '';
  return `      <article class="article-row">
        <a href="${href}">
          <img src="${img}" alt="${escapeHtml(post.title)}" width="100" height="100" loading="lazy">
        </a>
        <div>
          <p class="category-tag">${cat.label}</p>
          <h3><a href="${href}">${escapeHtml(post.title)}</a></h3>
          <p class="dek">${escapeHtml(post.description)}</p>
          <p class="meta">By ${escapeHtml(post.author)} · ${post.date} · ${escapeHtml(post.readTime || '')}</p>
        </div>
      </article>`;
}

function regenerateHomepage(currentHtml, posts) {
  const latest = posts.slice(0, 8).map((p) => articleRowHtml(p, '/')).join('\n');
  return currentHtml.replace(
    /<!-- LATEST-START -->[\s\S]*<!-- LATEST-END -->/,
    `<!-- LATEST-START -->\n${latest}\n      <!-- LATEST-END -->`
  );
}

function regenerateCategoryArchive(currentHtml, category, posts) {
  const items = posts
    .filter((p) => p.category === category)
    .map((p) => articleRowHtml(p, '../').replace('../' + category + '/', ''))
    .join('\n');
  return currentHtml.replace(
    /<!-- ARTICLES-START -->[\s\S]*<!-- ARTICLES-END -->/,
    `<!-- ARTICLES-START -->\n${items}\n      <!-- ARTICLES-END -->`
  );
}

function regenerateSitemap(posts) {
  const staticUrls = [
    { loc: `${SITE_URL}/`, changefreq: 'hourly', priority: '1.0' },
    { loc: `${SITE_URL}/education/`, changefreq: 'daily', priority: '0.9' },
    { loc: `${SITE_URL}/news/`, changefreq: 'daily', priority: '0.9' },
    { loc: `${SITE_URL}/about.html`, changefreq: 'yearly', priority: '0.3' },
    { loc: `${SITE_URL}/contact.html`, changefreq: 'yearly', priority: '0.3' },
  ];
  const postUrls = posts.map((p) => ({
    loc: `${SITE_URL}/${p.category}/${p.slug}.html`,
    lastmod: p.date,
    changefreq: 'monthly',
    priority: '0.8',
  }));
  const all = [...staticUrls, ...postUrls];
  const body = all
    .map(
      (u) => `  <url>
    <loc>${u.loc}</loc>
${u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : ''}    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function rfc822(dateStr) {
  return new Date(`${dateStr}T09:00:00+05:30`).toUTCString().replace('GMT', '+0000');
}

function regenerateRss(posts) {
  const items = posts
    .slice(0, 20)
    .map((p) => {
      const url = `${SITE_URL}/${p.category}/${p.slug}.html`;
      return `    <item>
      <title>${escapeHtml(p.title)}</title>
      <link>${url}</link>
      <guid>${url}</guid>
      <pubDate>${rfc822(p.date)}</pubDate>
      <description>${escapeHtml(p.description)}</description>
      <category>${CATEGORIES[p.category].label}</category>
    </item>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n  <channel>\n    <title>${SITE_NAME}</title>\n    <link>${SITE_URL}/</link>\n    <description>Education and news for curious minds.</description>\n    <language>en-us</language>\n    <atom:link href="${SITE_URL}/rss.xml" rel="self" type="application/rss+xml"/>\n    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n${items}\n  </channel>\n</rss>\n`;
}

// ---- Image optimization ----

/**
 * Accepts a raw image Buffer of any format.
 * Returns a WebP Buffer optimised to max 1200×630, quality 82.
 * Already-small images are not upscaled.
 */
async function optimizeImage(buffer) {
  return sharp(buffer)
    .rotate()                      // auto-rotate based on EXIF orientation
    .resize({
      width: 1200,
      height: 630,
      fit: 'inside',               // maintain aspect ratio, never upscale
      withoutEnlargement: true,
    })
    .webp({ quality: 82 })         // convert to WebP
    .toBuffer();
}

// ---- GitHub API — fetch a file's content and sha ----

async function getGithubFile(filePath) {
  try {
    const res = await octokit.repos.getContent({
      owner: GITHUB_REPO_OWNER,
      repo: GITHUB_REPO_NAME,
      path: filePath,
      ref: GITHUB_BRANCH,
    });
    const content = Buffer.from(res.data.content, 'base64').toString('utf8');
    return { content, sha: res.data.sha };
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

// ---- GitHub API — atomic multi-file commit ----

async function commitFilesToGithub(message, files) {
  if (!GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is not set in environment.');

  // 1. Get current HEAD commit SHA
  const refRes = await octokit.git.getRef({
    owner: GITHUB_REPO_OWNER, repo: GITHUB_REPO_NAME, ref: `heads/${GITHUB_BRANCH}`,
  });
  const commitSha = refRes.data.object.sha;

  // 2. Get the tree SHA of that commit
  const commitRes = await octokit.git.getCommit({
    owner: GITHUB_REPO_OWNER, repo: GITHUB_REPO_NAME, commit_sha: commitSha,
  });
  const treeSha = commitRes.data.tree.sha;

  // 3. Build new tree — binary files (images) need a blob created first
  const tree = await Promise.all(files.map(async (f) => {
    if (f.encoding === 'base64') {
      // Create a binary blob for images
      const blobRes = await octokit.git.createBlob({
        owner: GITHUB_REPO_OWNER,
        repo: GITHUB_REPO_NAME,
        content: f.content,
        encoding: 'base64',
      });
      return { path: f.path, mode: '100644', type: 'blob', sha: blobRes.data.sha };
    }
    // Text files — content inline
    return { path: f.path, mode: '100644', type: 'blob', content: f.content };
  }));

  const newTreeRes = await octokit.git.createTree({
    owner: GITHUB_REPO_OWNER, repo: GITHUB_REPO_NAME, base_tree: treeSha, tree,
  });

  // 4. Create the commit
  const newCommitRes = await octokit.git.createCommit({
    owner: GITHUB_REPO_OWNER,
    repo: GITHUB_REPO_NAME,
    message,
    tree: newTreeRes.data.sha,
    parents: [commitSha],
  });

  // 5. Move the branch pointer to the new commit
  await octokit.git.updateRef({
    owner: GITHUB_REPO_OWNER,
    repo: GITHUB_REPO_NAME,
    ref: `heads/${GITHUB_BRANCH}`,
    sha: newCommitRes.data.sha,
  });
}

// ---- Routes ----

app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'login.html')));

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = jwt.sign({ user: username }, SESSION_SECRET, { expiresIn: '8h' });
    res.cookie('admin_token', token, {
      httpOnly: true,                                      // never exposed to JS
      secure: process.env.NODE_ENV === 'production',       // HTTPS only in prod
      sameSite: 'strict',                                  // CSRF protection
      maxAge: 8 * 60 * 60 * 1000,                         // 8 hours
    });
    return res.redirect('/admin');
  }
  res.redirect('/login?error=1');
});

app.post('/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.redirect('/login');
});

app.get('/admin', requireAuth, (req, res) =>
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'))
);

app.get('/admin/posts', requireAuth, async (req, res) => {
  try {
    // Fetch posts.json from GitHub so we always have the live list on Vercel
    const file = await getGithubFile('public/posts.json');
    const posts = file ? JSON.parse(file.content) : [];
    res.json(posts);
  } catch (err) {
    // Fallback to local disk when running locally
    res.json(readPostsLocal());
  }
});

app.post('/admin/add-post', requireAuth, uploadFields, async (req, res) => {
  try {
    const title = (req.body.title || '').trim();
    const category = req.body.category;
    const description = (req.body.description || '').trim();
    const author = (req.body.author || '').trim() || 'The Daybook Staff';

    if (!title) return res.status(400).json({ error: 'Title is required' });
    if (!CATEGORIES[category]) return res.status(400).json({ error: 'Category must be education or news' });
    if (!description) return res.status(400).json({ error: 'A short description (used for SEO + previews) is required' });

    let contentHtml = req.body.content && req.body.content.trim();
    const htmlFiles = req.files && req.files['file'];
    if (!contentHtml && htmlFiles && htmlFiles[0]) contentHtml = htmlFiles[0].buffer.toString('utf8');
    if (!contentHtml) return res.status(400).json({ error: 'Provide raw HTML content or upload an .html file' });

    const slug = slugify(req.body.slug || title);

    // Security: validate slug to prevent path traversal
    if (!isValidSlug(slug)) {
      return res.status(400).json({ error: 'Invalid slug — only lowercase letters, numbers, and hyphens allowed.' });
    }

    const date = new Date().toISOString().slice(0, 10);
    const readTime = req.body.readTime && req.body.readTime.trim() ? req.body.readTime.trim() : '5 min read';

    // ---- Handle cover image upload ----
    let image = (req.body.image || '').trim(); // fallback: manual path field
    const imageFiles = req.files && req.files['coverImage'];
    let coverImageFile = null; // will be added to filesToCommit later
    if (imageFiles && imageFiles[0]) {
      const raw = imageFiles[0].buffer;
      const optimized = await optimizeImage(raw);
      const imagePath = `public/images/${slug}.webp`;
      image = `images/${slug}.webp`;           // relative path for article HTML
      coverImageFile = { path: imagePath, content: optimized.toString('base64'), encoding: 'base64' };
    }

    const post = { title, slug, category, description, author, date, readTime, image, contentHtml };

    // ---- Fetch live files from GitHub ----
    const [postsFile, homepageFile, catArchiveFile] = await Promise.all([
      getGithubFile('public/posts.json'),
      getGithubFile('public/index.html'),
      getGithubFile(`public/${category}/index.html`),
    ]);

    // ---- Update posts registry ----
    let posts = postsFile ? JSON.parse(postsFile.content) : readPostsLocal();
    const { contentHtml: _drop, ...postMeta } = post;
    const idx = posts.findIndex((p) => p.slug === slug && p.category === category);
    if (idx >= 0) posts[idx] = postMeta;
    else posts.push(postMeta);
    posts.sort((a, b) => new Date(b.date) - new Date(a.date));

    // ---- Build all files to commit in one atomic operation ----
    const filesToCommit = [];

    // 1. Article page
    filesToCommit.push({
      path: `public/${category}/${slug}.html`,
      content: renderArticlePage(post),
    });

    // 2. posts.json
    filesToCommit.push({
      path: 'public/posts.json',
      content: JSON.stringify(posts, null, 2) + '\n',
    });

    // 3. Homepage (regenerated from live GitHub copy)
    if (homepageFile) {
      filesToCommit.push({
        path: 'public/index.html',
        content: regenerateHomepage(homepageFile.content, posts),
      });
    }

    // 4. Category archive (regenerated from live GitHub copy)
    if (catArchiveFile) {
      filesToCommit.push({
        path: `public/${category}/index.html`,
        content: regenerateCategoryArchive(catArchiveFile.content, category, posts),
      });
    }

    // 5. Sitemap & RSS
    filesToCommit.push({ path: 'public/sitemap.xml', content: regenerateSitemap(posts) });
    filesToCommit.push({ path: 'public/rss.xml', content: regenerateRss(posts) });

    // 6. Cover image (optimized WebP) — added last so text files aren't affected
    if (coverImageFile) filesToCommit.push(coverImageFile);

    // ---- Push everything to GitHub in one commit ----
    await commitFilesToGithub(`Add/update post: ${title}`, filesToCommit);

    const publicUrl = `${SITE_URL}/${category}/${slug}.html`;
    res.json({
      ok: true,
      slug,
      url: publicUrl,
      message: `Published! GitHub Action is deploying to Firebase now. Live at: ${publicUrl}`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Something went wrong' });
  }
});

app.get('/', (req, res) => res.redirect('/admin'));

// ---- Start locally or export for Vercel ----

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Admin panel running at http://localhost:${PORT}`);
  });
}

module.exports = app;
