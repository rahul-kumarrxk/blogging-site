/**
 * Blog admin panel for The Daybook.
 * - Hardcoded login (change ADMIN_USER / ADMIN_PASS via .env)
 * - Add a post: title, category (education/news), description, author,
 *   optional cover image URL, and raw HTML content or an uploaded .html file
 * - On submit the server:
 *     1. generates new HTML for the article, homepage, category, sitemap, rss
 *     2. uses the GitHub API to commit all changes directly to the repository
 *        (this means it can be hosted anywhere, even serverless environments)
 */

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { Octokit } = require('@octokit/rest');

const app = express();
const PORT = process.env.PORT || 4000;

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'changeme123';
const SITE_URL = process.env.SITE_URL || 'https://my-blog-55217.web.app';
const SITE_NAME = 'The Daybook';

// GitHub Setup
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER || 'rahul-kumarrxk';
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME || 'blogging-site';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

const octokit = new Octokit({ auth: GITHUB_TOKEN });

const REPO_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');
const POSTS_JSON = path.join(PUBLIC_DIR, 'posts.json');
const INDEX_HTML = path.join(PUBLIC_DIR, 'index.html');

const CATEGORIES = {
  education: { label: 'Education', schemaType: 'Article' },
  news: { label: 'News', schemaType: 'NewsArticle' },
};

const upload = multer({ storage: multer.memoryStorage() });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-this-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 4 },
  })
);

function requireAuth(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  return res.redirect('/login');
}

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

function readPosts() {
  if (!fs.existsSync(POSTS_JSON)) return [];
  return JSON.parse(fs.readFileSync(POSTS_JSON, 'utf8'));
}

// ---------- article page template ----------

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

// ---------- regenerate HTML strings ----------

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

function regenerateHomepage(posts) {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const latest = posts.slice(0, 8).map((p) => articleRowHtml(p, '/')).join('\n');
  const updated = html.replace(
    /<!-- LATEST-START -->[\s\S]*<!-- LATEST-END -->/,
    `<!-- LATEST-START -->\n${latest}\n      <!-- LATEST-END -->`
  );
  return { path: 'public/index.html', content: updated };
}

function regenerateCategoryArchive(category, posts) {
  const archivePath = path.join(PUBLIC_DIR, category, 'index.html');
  if (!fs.existsSync(archivePath)) return null;
  const html = fs.readFileSync(archivePath, 'utf8');
  const items = posts
    .filter((p) => p.category === category)
    .map((p) => articleRowHtml(p, '../').replace('../' + category + '/', ''))
    .join('\n');
  const updated = html.replace(
    /<!-- ARTICLES-START -->[\s\S]*<!-- ARTICLES-END -->/,
    `<!-- ARTICLES-START -->\n${items}\n      <!-- ARTICLES-END -->`
  );
  return { path: `public/${category}/index.html`, content: updated };
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
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
  return { path: 'public/sitemap.xml', content: xml };
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
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n  <channel>\n    <title>${SITE_NAME}</title>\n    <link>${SITE_URL}/</link>\n    <description>Education and news for curious minds.</description>\n    <language>en-us</language>\n    <atom:link href="${SITE_URL}/rss.xml" rel="self" type="application/rss+xml"/>\n    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n${items}\n  </channel>\n</rss>\n`;
  return { path: 'public/rss.xml', content: xml };
}

// ---------- GitHub API Publisher ----------

async function commitFilesToGithub(message, files) {
  if (!GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is not set in environment.");

  // 1. Get current commit
  const refRes = await octokit.git.getRef({ owner: GITHUB_REPO_OWNER, repo: GITHUB_REPO_NAME, ref: \`heads/\${GITHUB_BRANCH}\` });
  const commitSha = refRes.data.object.sha;
  
  // 2. Get current commit's tree
  const commitRes = await octokit.git.getCommit({ owner: GITHUB_REPO_OWNER, repo: GITHUB_REPO_NAME, commit_sha: commitSha });
  const treeSha = commitRes.data.tree.sha;
  
  // 3. Create tree for new files
  const tree = files.map(f => ({
    path: f.path,
    mode: '100644',
    type: 'blob',
    content: f.content
  }));
  
  // 4. Create new tree on top of base tree
  const newTreeRes = await octokit.git.createTree({ owner: GITHUB_REPO_OWNER, repo: GITHUB_REPO_NAME, base_tree: treeSha, tree });
  
  // 5. Create new commit
  const newCommitRes = await octokit.git.createCommit({
    owner: GITHUB_REPO_OWNER, repo: GITHUB_REPO_NAME, message, tree: newTreeRes.data.sha, parents: [commitSha]
  });
  
  // 6. Update reference
  await octokit.git.updateRef({
    owner: GITHUB_REPO_OWNER, repo: GITHUB_REPO_NAME, ref: \`heads/\${GITHUB_BRANCH}\`, sha: newCommitRes.data.sha
  });
}

// ---------- routes ----------

app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'login.html')));

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.loggedIn = true;
    return res.redirect('/admin');
  }
  res.redirect('/login?error=1');
});

app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

app.get('/admin', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));

app.get('/admin/posts', requireAuth, (req, res) => res.json(readPosts()));

app.post('/admin/add-post', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const title = (req.body.title || '').trim();
    const category = req.body.category;
    const description = (req.body.description || '').trim();
    const author = (req.body.author || '').trim() || 'The Daybook Staff';

    if (!title) return res.status(400).json({ error: 'Title is required' });
    if (!CATEGORIES[category]) return res.status(400).json({ error: 'Category must be education or news' });
    if (!description) return res.status(400).json({ error: 'A short description (used for SEO + previews) is required' });

    let contentHtml = req.body.content && req.body.content.trim();
    if (!contentHtml && req.file) contentHtml = req.file.buffer.toString('utf8');
    if (!contentHtml) return res.status(400).json({ error: 'Provide raw HTML content or upload an .html file' });

    const slug = slugify(req.body.slug || title);
    const date = new Date().toISOString().slice(0, 10);
    const readTime = req.body.readTime && req.body.readTime.trim() ? req.body.readTime.trim() : '5 min read';
    const image = (req.body.image || '').trim();

    const post = { title, slug, category, description, author, date, readTime, image, contentHtml };

    // Prepare files for GitHub Commit
    const filesToCommit = [];

    // 1. Article Page
    filesToCommit.push({
      path: \`public/\${category}/\${slug}.html\`,
      content: renderArticlePage(post)
    });

    // 2. Posts.json
    let posts = readPosts();
    const { contentHtml: _drop, ...postMeta } = post; // keep contentHtml out of the lightweight registry
    const idx = posts.findIndex((p) => p.slug === slug && p.category === category);
    if (idx >= 0) posts[idx] = postMeta;
    else posts.push(postMeta);
    
    // Sort newest first
    posts.sort((a, b) => new Date(b.date) - new Date(a.date));
    filesToCommit.push({
      path: 'public/posts.json',
      content: JSON.stringify(posts, null, 2) + '\\n'
    });

    // 3. Homepage, Category Archive, Sitemap, RSS
    filesToCommit.push(regenerateHomepage(posts));
    
    const catArchive = regenerateCategoryArchive(category, posts);
    if (catArchive) filesToCommit.push(catArchive);
    
    filesToCommit.push(regenerateSitemap(posts));
    filesToCommit.push(regenerateRss(posts));

    // Send the whole batch to GitHub directly!
    await commitFilesToGithub(\`Add/update post: \${title}\`, filesToCommit);

    res.json({
      ok: true,
      slug,
      message: \`Published to /\${category}/\${slug}.html via GitHub API. GitHub Action will deploy it shortly.\`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Something went wrong' });
  }
});

app.get('/', (req, res) => res.redirect('/admin'));

app.listen(PORT, () => {
  console.log(\`Admin panel running at http://localhost:\${PORT}\`);
});
