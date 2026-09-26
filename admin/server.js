/**
 * Blog admin panel for The Daybook.
 * - JWT-based HttpOnly cookie auth (Vercel serverless compatible)
 * - Dual Authoring Modes:
 *     Mode A: Structured Editor (blocks, categories, tags, SEO)
 *     Mode B: HTML / Existing View (presentation views, existing article shells)
 * - View Library with dynamic metrics, template extraction, and previews
 * - Single Unified Renderer for Article Preview and Live Publishing
 * - Automatic Category-based Topic Clustering & Confidence Scoring
 * - Deduplicated Recommendations: Same-Topic, Cross-Category, Latest-Related
 * - Direct GitHub API commits + local dev synchronization
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

// Local paths
const REPO_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');
const POSTS_JSON = path.join(PUBLIC_DIR, 'posts.json');
const INDEX_HTML = path.join(PUBLIC_DIR, 'index.html');
const VIEWS_JSON = path.join(REPO_ROOT, 'views', 'views.json');
const TEMPLATES_DIR = path.join(REPO_ROOT, 'templates');

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
  { name: 'file', maxCount: 1 },       // .html content file
  { name: 'coverImage', maxCount: 1 }, // cover image
]);

app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
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
    String(str || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '')
      .slice(0, 70) || 'post'
  );
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function isValidSlug(slug) {
  return /^[a-z0-9-]{1,70}$/.test(slug) && !slug.includes('..');
}

function readPostsLocal() {
  if (!fs.existsSync(POSTS_JSON)) return [];
  try {
    return JSON.parse(fs.readFileSync(POSTS_JSON, 'utf8'));
  } catch (e) {
    return [];
  }
}

function readViewsLocal() {
  if (!fs.existsSync(VIEWS_JSON)) {
    return [
      {
        id: 'education-default',
        name: 'Education Default',
        type: 'template',
        source: 'templates/article/education-default.html',
        description: 'Standard editorial layout for educational guides and deep-dives',
        category: 'education',
        active: true,
      },
      {
        id: 'news-default',
        name: 'News Default',
        type: 'template',
        source: 'templates/article/news-default.html',
        description: 'Clean, authoritative layout for timely reporting and analysis',
        category: 'news',
        active: true,
      },
      {
        id: 'featured-article',
        name: 'Featured Article',
        type: 'template',
        source: 'templates/article/featured-article.html',
        description: 'High-impact layout with featured emphasis and highlighted callouts',
        category: 'all',
        active: true,
      },
      {
        id: 'custom-research-layout',
        name: 'Custom Research Layout',
        type: 'html',
        source: 'templates/article/custom-research-layout.html',
        description: 'Academic and investigative layout with executive summary abstract box',
        category: 'all',
        active: true,
      },
      {
        id: 'existing-vaccines-view',
        name: 'Vaccine Guide Layout (Extracted)',
        type: 'article-derived',
        source: 'templates/article/existing-vaccines-view.html',
        derivedFrom: 'public/education/how-vaccines-train-your-immune-system.html',
        description: 'Extracted presentation structure from the foundational vaccine explainer',
        category: 'education',
        active: true,
      },
    ];
  }
  try {
    return JSON.parse(fs.readFileSync(VIEWS_JSON, 'utf8'));
  } catch (e) {
    return [];
  }
}

function getViewsWithCounts(views, posts) {
  return views.map((v) => {
    const count = posts.filter((p) => {
      if (p.view) {
        if (typeof p.view === 'string') return p.view === v.id;
        if (p.view.id) return p.view.id === v.id;
      }
      return v.id === `${p.category}-default`;
    }).length;

    return {
      ...v,
      usageCount: count,
    };
  });
}

function loadViewTemplateSync(viewId) {
  const views = readViewsLocal();
  const v = views.find((x) => x.id === viewId) || views[0];
  if (v && v.source) {
    const fullPath = path.join(REPO_ROOT, v.source);
    if (fs.existsSync(fullPath)) {
      return fs.readFileSync(fullPath, 'utf8');
    }
  }
  // Try fallback in templates/article/${viewId}.html
  const directPath = path.join(TEMPLATES_DIR, 'article', `${viewId}.html`);
  if (fs.existsSync(directPath)) {
    return fs.readFileSync(directPath, 'utf8');
  }
  return null;
}

// Representative sample article for safe previewing of views in View Library
const SAMPLE_ARTICLE = {
  title: 'How Mitochondria Power Cellular Energy and Metabolism',
  slug: 'how-mitochondria-power-cellular-energy',
  category: 'education',
  description: 'Inside every eukaryotic cell, miniature powerplants convert nutrients into ATP through the electron transport chain. Here is how cellular respiration really works.',
  author: 'Dr. Evelyn Reed',
  date: '2026-09-27',
  readTime: '6 min read',
  image: '',
  cluster: 'human-biology-health',
  clusterName: 'Human Biology & Health',
  isPillar: false,
  tags: ['biology', 'cells', 'energy', 'mitochondria', 'metabolism'],
  contentHtml: `
    <p>Every movement you make, every thought in your brain, and every heartbeat depends on a continuous supply of adenosine triphosphate (ATP). The primary cellular structures responsible for manufacturing this universal energy currency are mitochondria.</p>
    
    <h2>The Architecture of the Mitochondrion</h2>
    <p>Unlike most organelles, mitochondria possess two distinct membranes: a smooth outer boundary and an extensively folded inner membrane known as cristae. This folding dramatically increases surface area, creating thousands of molecular assembly sites for ATP synthase complexes.</p>
    
    <blockquote>Mitochondria are unique among animal cellular organelles in possessing their own independent, circular DNA, passed down almost exclusively through maternal inheritance.</blockquote>
    
    <h2>The Electron Transport Chain</h2>
    <p>During cellular respiration, electrons harvested from broken-down carbohydrates and fats travel along a sequence of protein complexes embedded within the inner membrane. This flow drives protons across into the intermembrane space, creating a steep chemical gradient that turns the molecular turbine of ATP synthase.</p>
    
    <h2>Cellular Health and Longevity</h2>
    <p>When mitochondrial efficiency degrades, cells accumulate reactive oxygen species, triggering inflammatory signals. Understanding how lifestyle, fasting, and exercise stimulate mitochondrial biogenesis remains one of modern biology's most promising longevity frontiers.</p>
  `,
};

// ---- Clustering & Similarity Logic ----

function getTokens(str) {
  if (!str) return [];
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 3);
}

function calculateSimilarityScore(postA, postB) {
  let score = 0;

  // Primary category match
  if (postA.category === postB.category) score += 10;

  // Tags overlap
  const tagsA = new Set((postA.tags || []).map((t) => String(t).toLowerCase()));
  const tagsB = new Set((postB.tags || []).map((t) => String(t).toLowerCase()));
  let tagIntersection = 0;
  for (const tag of tagsA) {
    if (tagsB.has(tag)) tagIntersection++;
  }
  score += tagIntersection * 15;

  // Title keywords
  const titleA = new Set(getTokens(postA.title || ''));
  const titleB = new Set(getTokens(postB.title || ''));
  let titleIntersection = 0;
  for (const tok of titleA) {
    if (titleB.has(tok)) titleIntersection++;
  }
  score += titleIntersection * 4;

  // Description keywords
  const descA = new Set(getTokens(postA.description || ''));
  const descB = new Set(getTokens(postB.description || ''));
  let descIntersection = 0;
  for (const tok of descA) {
    if (descB.has(tok)) descIntersection++;
  }
  score += descIntersection * 3;

  // Cluster keyword overlap
  if (postA.cluster && postB.cluster && postA.cluster === postB.cluster) {
    score += 20;
  }

  return score;
}

function detectTopicCluster(postData, allPosts = []) {
  let bestScore = 0;
  let bestCluster = null;
  let bestClusterName = null;

  for (const existingPost of allPosts) {
    if (!existingPost.cluster) continue;
    if (existingPost.slug === postData.slug && existingPost.category === postData.category) continue;

    const score = calculateSimilarityScore(postData, existingPost);
    if (score > bestScore) {
      bestScore = score;
      bestCluster = existingPost.cluster;
      bestClusterName = existingPost.clusterName;
    }
  }

  // Calculate confidence percentage
  let confidence = 0;
  if (bestScore >= 40) confidence = 95;
  else if (bestScore >= 30) confidence = 88;
  else if (bestScore >= 20) confidence = 76;
  else if (bestScore >= 12) confidence = 62;
  else if (bestScore > 0) confidence = 40;

  const contentLen = (postData.contentHtml || postData.content || '').length;
  const tagCount = (postData.tags || []).length;
  const isPillarRecommended = contentLen > 2500 || tagCount >= 4;

  return {
    cluster: bestScore >= 15 ? bestCluster : null,
    clusterName: bestScore >= 15 ? bestClusterName : null,
    confidence,
    score: bestScore,
    isPillarRecommended,
  };
}

// ---- Deduplicated Recommendation Engine ----

function getRecommendations(post, allPosts = []) {
  const displayedSlugs = new Set([post.slug]);

  // 1. Same topic / cluster siblings (up to 4)
  const sameTopic = allPosts
    .filter((p) => p.slug !== post.slug && post.cluster && p.cluster === post.cluster)
    .slice(0, 4);
  sameTopic.forEach((p) => displayedSlugs.add(p.slug));

  // 2. Cross-category articles (different category, ranked by topical similarity, score >= 12)
  const crossCategory = allPosts
    .filter((p) => !displayedSlugs.has(p.slug) && p.category !== post.category)
    .map((p) => ({ post: p, score: calculateSimilarityScore(post, p) }))
    .filter((x) => x.score >= 12)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.post);
  crossCategory.forEach((p) => displayedSlugs.add(p.slug));

  // 3. Latest related articles (not in same topic or cross-category, ranked by recency + similarity)
  const latestRelated = allPosts
    .filter((p) => !displayedSlugs.has(p.slug))
    .map((p) => ({
      post: p,
      score: calculateSimilarityScore(post, p) + (new Date(p.date || '2026-01-01').getTime() / 1e12),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.post);

  return { sameTopic, crossCategory, latestRelated };
}

function renderCrossCategoryWidget(post, crossCategoryPosts) {
  if (!crossCategoryPosts || !crossCategoryPosts.length) return '';
  return `
    <section class="recommendations-section related-cross-category" aria-label="Related Across Categories">
      <div class="recommendations-header">
        <h3 class="recommendations-title">Related Across Categories</h3>
        <span class="recommendations-sub">Cross-Silo Perspectives</span>
      </div>
      <div class="recommendations-grid">
        ${crossCategoryPosts.map((p) => `
          <a class="recommendation-card" href="/${p.category}/${p.slug}.html">
            <div>
              <span class="card-cat-badge" style="color:${p.category === 'news' ? '#c09fff' : '#7faeff'};">${CATEGORIES[p.category] ? CATEGORIES[p.category].label : p.category}</span>
              <h4>${escapeHtml(p.title)}</h4>
              <p>${escapeHtml(p.description)}</p>
            </div>
            <div class="card-meta">
              <span>By ${escapeHtml(p.author || 'Staff')}</span>
              <span>${escapeHtml(p.readTime || '')}</span>
            </div>
          </a>
        `).join('')}
      </div>
    </section>`;
}

function renderLatestRelatedWidget(post, latestRelatedPosts) {
  if (!latestRelatedPosts || !latestRelatedPosts.length) return '';
  return `
    <section class="recommendations-section related-latest" aria-label="Latest Related Articles">
      <div class="recommendations-header">
        <h3 class="recommendations-title">Latest Related Content</h3>
        <span class="recommendations-sub">Fresh Developments &amp; Analysis</span>
      </div>
      <div class="recommendations-grid">
        ${latestRelatedPosts.map((p) => `
          <a class="recommendation-card" href="/${p.category}/${p.slug}.html">
            <div>
              <span class="card-cat-badge" style="color:${p.category === 'news' ? '#c09fff' : '#7faeff'};">${CATEGORIES[p.category] ? CATEGORIES[p.category].label : p.category}</span>
              <h4>${escapeHtml(p.title)}</h4>
              <p>${escapeHtml(p.description)}</p>
            </div>
            <div class="card-meta">
              <span>${p.date || ''}</span>
              <span>${escapeHtml(p.readTime || '')}</span>
            </div>
          </a>
        `).join('')}
      </div>
    </section>`;
}

// ---- Extraction of View Structure from Existing HTML ----

function extractViewFromHtml(htmlContent) {
  let tpl = htmlContent;

  // Replace title
  tpl = tpl.replace(/<title>[\s\S]*?<\/title>/i, '<title>{{title}} | {{siteName}}</title>');
  // Replace meta description
  tpl = tpl.replace(/<meta\s+name="description"\s+content="[\s\S]*?">/i, '<meta name="description" content="{{description}}">');
  // Replace canonical and robots
  tpl = tpl.replace(/<meta\s+name="robots"\s+content="[\s\S]*?">\s*/i, '');
  tpl = tpl.replace(/<link\s+rel="canonical"\s+href="[\s\S]*?">/i, '<link rel="canonical" href="{{canonicalUrl}}">\n{{robotsMeta}}');

  // Replace OpenGraph
  tpl = tpl.replace(/<meta\s+property="og:title"\s+content="[\s\S]*?">/i, '<meta property="og:title" content="{{title}}">');
  tpl = tpl.replace(/<meta\s+property="og:description"\s+content="[\s\S]*?">/i, '<meta property="og:description" content="{{description}}">');
  tpl = tpl.replace(/<meta\s+property="og:url"\s+content="[\s\S]*?">/i, '<meta property="og:url" content="{{canonicalUrl}}">');
  tpl = tpl.replace(/<meta\s+property="og:image"\s+content="[\s\S]*?">/i, '<meta property="og:image" content="{{featuredImage}}">');
  tpl = tpl.replace(/<meta\s+property="article:published_time"\s+content="[\s\S]*?">/i, '<meta property="article:published_time" content="{{isoDate}}">');
  tpl = tpl.replace(/<meta\s+property="article:modified_time"\s+content="[\s\S]*?">/i, '<meta property="article:modified_time" content="{{isoDate}}">');
  tpl = tpl.replace(/<meta\s+property="article:section"\s+content="[\s\S]*?">/i, '<meta property="article:section" content="{{categoryLabel}}">');

  // Replace Twitter
  tpl = tpl.replace(/<meta\s+name="twitter:title"\s+content="[\s\S]*?">/i, '<meta name="twitter:title" content="{{title}}">');
  tpl = tpl.replace(/<meta\s+name="twitter:description"\s+content="[\s\S]*?">/i, '<meta name="twitter:description" content="{{description}}">');
  tpl = tpl.replace(/<meta\s+name="twitter:image"\s+content="[\s\S]*?">/i, '<meta name="twitter:image" content="{{featuredImage}}">');

  // Replace JSON-LD schemas
  tpl = tpl.replace(/<script\s+type="application\/ld\+json">[\s\S]*?<\/script>\s*<script\s+type="application\/ld\+json">[\s\S]*?<\/script>/i, `
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "{{siteUrl}}/" },
    { "@type": "ListItem", "position": 2, "name": "{{categoryLabel}}", "item": "{{siteUrl}}/{{category}}/" },
    { "@type": "ListItem", "position": 3, "name": "{{title}}", "item": "{{canonicalUrl}}" }
  ]
}
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "{{schemaType}}",
  "headline": "{{title}}",
  "description": "{{description}}",
  "image": ["{{featuredImage}}"],
  "datePublished": "{{isoDate}}",
  "dateModified": "{{isoDate}}",
  "author": { "@type": "Person", "name": "{{author}}" },
  "publisher": { "@id": "{{siteUrl}}/#organization" },
  "mainEntityOfPage": { "@type": "WebPage", "@id": "{{canonicalUrl}}" },
  "articleSection": "{{categoryLabel}}"
}
</script>`);

  // Insert preview banner after <body>
  if (!tpl.includes('{{previewBanner}}')) {
    tpl = tpl.replace(/<body([^>]*)>/i, '<body$1>\n{{previewBanner}}');
  }

  // Replace breadcrumbs
  tpl = tpl.replace(/<p\s+class="breadcrumb wrap">[\s\S]*?<\/p>/i, '{{breadcrumbs}}');

  // Replace category tag
  tpl = tpl.replace(/<p\s+class="category-tag">[\s\S]*?<\/p>/i, '<p class="category-tag">{{categoryLabel}}{{topicPill}}{{pillarBadge}}</p>');

  // Replace H1
  tpl = tpl.replace(/<div class="article-header">([\s\S]*?)<h1>[\s\S]*?<\/h1>/i, '<div class="article-header">$1<h1>{{title}}</h1>');

  // Replace article-meta
  tpl = tpl.replace(/<p\s+class="article-meta">[\s\S]*?<\/p>/i, `
      <p class="article-meta">
        <span>By {{author}}</span>
        <span>Published <time datetime="{{date}}">{{date}}</time></span>
        <span>{{readTime}}</span>
      </p>`);

  // Replace article-body and insert featuredImageBlock
  tpl = tpl.replace(/<div class="article-hero-image">[\s\S]*?<\/div>/i, '');
  tpl = tpl.replace(/<article\s+class="article-body">[\s\S]*?<\/article>/i, `{{featuredImageBlock}}\n    <article class="article-body">\n      {{content}}\n    </article>`);

  // Replace tags
  tpl = tpl.replace(/<div\s+class="article-tags-wrap">[\s\S]*?<\/div>/i, '{{tagsHtml}}');

  // Replace cluster box
  tpl = tpl.replace(/<aside\s+class="topic-cluster-box"[\s\S]*?<\/aside>/i, '{{clusterBox}}');

  // Strip hardcoded recommendations widgets if any
  tpl = tpl.replace(/<section\s+class="recommendations-section[\s\S]*?<\/section>/gi, '');
  tpl = tpl.replace(/<section\s+class="related-articles-widget[\s\S]*?<\/section>/gi, '');

  if (!tpl.includes('{{crossCategoryArticles}}')) {
    tpl = tpl.replace('{{clusterBox}}', '{{clusterBox}}\n    {{relatedArticles}}\n    {{crossCategoryArticles}}\n    {{latestRelated}}');
  }

  return tpl;
}

// Built-in fallback template string
function getStandardTemplateFallback() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{title}} | {{siteName}}</title>
<meta name="description" content="{{description}}">
<link rel="canonical" href="{{canonicalUrl}}">
{{robotsMeta}}

<meta property="og:type" content="article">
<meta property="og:site_name" content="{{siteName}}">
<meta property="og:title" content="{{title}}">
<meta property="og:description" content="{{description}}">
<meta property="og:url" content="{{canonicalUrl}}">
<meta property="og:image" content="{{featuredImage}}">
<meta property="article:published_time" content="{{isoDate}}">
<meta property="article:modified_time" content="{{isoDate}}">
<meta property="article:section" content="{{categoryLabel}}">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{{title}}">
<meta name="twitter:description" content="{{description}}">
<meta name="twitter:image" content="{{featuredImage}}">

<link rel="alternate" type="application/rss+xml" title="{{siteName}} feed" href="/rss.xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../css/style.css">

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "{{siteUrl}}/" },
    { "@type": "ListItem", "position": 2, "name": "{{categoryLabel}}", "item": "{{siteUrl}}/{{category}}/" },
    { "@type": "ListItem", "position": 3, "name": "{{title}}", "item": "{{canonicalUrl}}" }
  ]
}
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "{{schemaType}}",
  "headline": "{{title}}",
  "description": "{{description}}",
  "image": ["{{featuredImage}}"],
  "datePublished": "{{isoDate}}",
  "dateModified": "{{isoDate}}",
  "author": { "@type": "Person", "name": "{{author}}" },
  "publisher": { "@id": "{{siteUrl}}/#organization" },
  "mainEntityOfPage": { "@type": "WebPage", "@id": "{{canonicalUrl}}" },
  "articleSection": "{{categoryLabel}}"
}
</script>
</head>
<body>
{{previewBanner}}
<a class="skip-link" href="#main">Skip to content</a>
<header class="masthead">
  <div class="wrap">
    <div class="masthead-top"><p class="wordmark"><a href="/">{{siteName}}</a></p></div>
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
  {{breadcrumbs}}
  <div class="wrap">
    <div class="article-header">
      <p class="category-tag">{{categoryLabel}}{{topicPill}}{{pillarBadge}}</p>
      <h1>{{title}}</h1>
      <p class="article-meta">
        <span>By {{author}}</span>
        <span>Published <time datetime="{{date}}">{{date}}</time></span>
        <span>{{readTime}}</span>
      </p>
    </div>
    {{featuredImageBlock}}
    <article class="article-body">
      {{content}}
    </article>
    {{tagsHtml}}
    {{clusterBox}}
    {{relatedArticles}}
    {{crossCategoryArticles}}
    {{latestRelated}}
  </div>
</main>
<footer class="site-footer">
  <div class="wrap">
    <div class="footer-bottom">
      <span>© 2026 {{siteName}}. All rights reserved.</span>
      <span><a href="/sitemap.xml">Sitemap</a> · <a href="/rss.xml">RSS</a></span>
    </div>
  </div>
</footer>
</body>
</html>`;
}

function wrapArticle(content) {
  if (/<p[\s>]|<h[1-6][\s>]|<ul[\s>]|<blockquote/i.test(content)) return content;
  return `<p>${content}</p>`;
}

function renderClusterBox(post, allPosts = []) {
  if (!post.cluster) return '';
  const clusterPosts = allPosts.filter((p) => p.cluster === post.cluster);
  if (!clusterPosts.length) return '';

  const clusterName = post.clusterName || (clusterPosts.find((p) => p.clusterName) || {}).clusterName || post.cluster.replace(/-/g, ' ');
  const pillar = clusterPosts.find((p) => p.isPillar) || clusterPosts[0];
  const siblings = clusterPosts.filter((p) => p.slug !== post.slug);

  return `
    <aside class="topic-cluster-box" aria-label="Topic cluster">
      <div class="topic-cluster-header">
        <h3 class="topic-cluster-title">In this Topic: ${escapeHtml(clusterName)}</h3>
        <a class="topic-cluster-hub-link" href="/topic/${post.cluster}.html">Explore full topic hub →</a>
      </div>
      ${pillar && pillar.slug !== post.slug ? `
      <div class="topic-cluster-pillar-lead">
        <span class="pillar-badge" style="margin-bottom:.3rem;display:inline-block;">⭐ Lead Pillar Guide</span>
        <h4 style="margin: .3rem 0;"><a href="/${pillar.category}/${pillar.slug}.html">${escapeHtml(pillar.title)}</a></h4>
        <p>${escapeHtml(pillar.description)}</p>
      </div>` : ''}
      ${siblings.length ? `
      <p style="font-size:.82rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:.5rem;">Related Cluster Articles:</p>
      <ul class="topic-cluster-list">
        ${siblings.slice(0, 5).map((s) => `
          <li>
            <a href="/${s.category}/${s.slug}.html">${escapeHtml(s.title)}</a>
            <span class="cluster-post-meta">${escapeHtml(s.readTime || '')}</span>
          </li>
        `).join('')}
      </ul>` : `
      <p style="font-size:.85rem;color:var(--muted);margin:0;">This is the foundation article of the <strong>${escapeHtml(clusterName)}</strong> topic cluster. New sub-topic explainers will link here.</p>`}
    </aside>`;
}

function renderTopicHubPage(clusterId, posts) {
  const clusterPosts = posts.filter((p) => p.cluster === clusterId);
  const clusterName = (clusterPosts.find((p) => p.clusterName) || {}).clusterName || clusterId.replace(/-/g, ' ');
  const pillar = clusterPosts.find((p) => p.isPillar) || clusterPosts[0];
  const url = `${SITE_URL}/topic/${clusterId}.html`;

  const rows = clusterPosts.map((p) => articleRowHtml(p, '/')).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(clusterName)} — Topic Hub | ${SITE_NAME}</title>
<meta name="description" content="Explore in-depth articles, guides, and analysis on ${escapeHtml(clusterName)}.">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${escapeHtml(clusterName)} — Topic Hub">
<meta property="og:description" content="Explore in-depth articles, guides, and analysis on ${escapeHtml(clusterName)}.">
<meta property="og:url" content="${url}">
<link rel="stylesheet" href="../css/style.css">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body>
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
  <p class="breadcrumb wrap"><a href="/">Home</a> / Topic Hubs / ${escapeHtml(clusterName)}</p>
  <div class="archive-head wrap">
    <span class="pillar-badge" style="margin-bottom:.5rem;">📚 Topic Cluster Hub</span>
    <h1>${escapeHtml(clusterName)}</h1>
    <p>Comprehensive knowledge base and structured explainers exploring ${escapeHtml(clusterName)}. (${clusterPosts.length} article${clusterPosts.length === 1 ? '' : 's'})</p>
  </div>

  <div class="ledger wrap" style="grid-template-columns: 2fr 1fr;">
    <section aria-label="Cluster articles">
      ${pillar ? `
      <div class="topic-cluster-pillar-lead" style="margin-top:1.5rem;padding:1.4rem;">
        <span class="pillar-badge" style="margin-bottom:.5rem;">⭐ Lead Pillar Guide</span>
        <h3 style="font-size:1.35rem;margin:.4rem 0;"><a href="/${pillar.category}/${pillar.slug}.html">${escapeHtml(pillar.title)}</a></h3>
        <p style="font-size:.92rem;color:var(--muted);">${escapeHtml(pillar.description)}</p>
        <p class="meta" style="margin-top:.6rem;font-size:.8rem;color:var(--muted);">By ${escapeHtml(pillar.author)} · ${pillar.date} · ${escapeHtml(pillar.readTime || '')}</p>
      </div>` : ''}

      <h2 style="margin-top:2rem;font-size:1.3rem;">All Articles in this Cluster</h2>
      <!-- ARTICLES-START -->
      ${rows || '<p style="color:var(--muted);padding:1.5rem 0;">No articles published in this cluster yet.</p>'}
      <!-- ARTICLES-END -->
    </section>

    <aside class="sidebar">
      <section aria-label="Categories">
        <h2>Categories</h2>
        <ul class="cat-list">
          <li><a href="/education/">Education</a></li>
          <li><a href="/news/">News</a></li>
        </ul>
      </section>
      <section class="newsletter" aria-label="Newsletter signup">
        <h2>Stay Updated</h2>
        <p>Get notified as new articles are added to this topic.</p>
        <form action="/subscribe" method="post">
          <input type="email" name="email" placeholder="you@example.com" aria-label="Email address" required>
          <button type="submit">Subscribe</button>
        </form>
      </section>
    </aside>
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
</html>`;
}

/**
 * Single Unified Renderer for Article Preview and Live Publishing.
 * Uses the exact same template and variable substitutions.
 */
function renderArticlePage(post, allPosts = [], options = {}) {
  const cat = CATEGORIES[post.category] || CATEGORIES.education;
  const url = `${SITE_URL}/${post.category}/${post.slug}.html`;
  const img = post.image
    ? (post.image.startsWith('http') ? post.image : `${SITE_URL}/${post.image}`)
    : `${SITE_URL}/images/og-default.jpg`;
  const isoDate = `${post.date || new Date().toISOString().slice(0, 10)}T09:00:00+05:30`;

  const clusterBreadcrumb = post.cluster
    ? ` / <a href="/topic/${post.cluster}.html">${escapeHtml(post.clusterName || post.cluster)}</a>`
    : '';
  const clusterPill = post.cluster
    ? ` <a class="cluster-pill" href="/topic/${post.cluster}.html">📚 ${escapeHtml(post.clusterName || post.cluster)}</a>`
    : '';
  const pillarBadge = post.isPillar
    ? ` <span class="pillar-badge">⭐ Comprehensive Guide</span>`
    : '';

  const tagsWrap = (post.tags && post.tags.length)
    ? `<div class="article-tags-wrap"><span class="article-tags-label">Tags:</span> ${post.tags.map((t) => `<span class="tag-chip">#${escapeHtml(t)}</span>`).join(' ')}</div>`
    : '';

  const breadcrumbsHtml = `<p class="breadcrumb wrap"><a href="/">Home</a> / <a href="/${post.category}/">${cat.label}</a>${clusterBreadcrumb} / ${escapeHtml(post.title)}</p>`;

  const featuredImageBlock = post.image
    ? `<div class="article-hero-image" style="margin: 1.5rem 0;"><img src="${img}" alt="${escapeHtml(post.title)}" style="max-width:100%;height:auto;border-radius:6px;display:block;"></div>`
    : '';

  const robotsMeta = options.preview
    ? `<meta name="robots" content="noindex, nofollow">`
    : `<meta name="robots" content="index, follow, max-image-preview:large">`;

  const previewBanner = options.preview
    ? `<div style="background:#4f79ff;color:#fff;padding:.6rem 1rem;font-size:.85rem;font-weight:600;text-align:center;position:sticky;top:0;z-index:99999;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;gap:.8rem;">
        <span>👁 PREVIEW MODE — Unpublished Draft Preview (${escapeHtml(post.title)})</span>
        <span style="background:rgba(255,255,255,.2);padding:.15rem .5rem;border-radius:4px;font-size:.75rem;">View: ${escapeHtml(options.viewName || (post.view && (post.view.name || post.view.id)) || 'Default')}</span>
       </div>`
    : '';

  // Recommendations
  const { sameTopic, crossCategory, latestRelated } = getRecommendations(post, allPosts);
  const clusterBoxHtml = renderClusterBox(post, allPosts);
  const crossCategoryHtml = renderCrossCategoryWidget(post, crossCategory);
  const latestRelatedHtml = renderLatestRelatedWidget(post, latestRelated);

  // Load view template
  let templateHtml = options.templateHtml;
  if (!templateHtml) {
    const viewId = (post.view && (post.view.id || (typeof post.view === 'string' && post.view))) || `${post.category}-default`;
    templateHtml = loadViewTemplateSync(viewId);
  }

  if (!templateHtml) {
    templateHtml = getStandardTemplateFallback();
  }

  const variables = {
    title: escapeHtml(post.title),
    seoTitle: escapeHtml(post.title),
    description: escapeHtml(post.description),
    seoDescription: escapeHtml(post.description),
    author: escapeHtml(post.author || 'The Daybook Staff'),
    date: post.date || new Date().toISOString().slice(0, 10),
    isoDate,
    readTime: escapeHtml(post.readTime || '5 min read'),
    category: post.category,
    categoryLabel: cat.label,
    schemaType: cat.schemaType,
    canonicalUrl: url,
    siteUrl: SITE_URL,
    siteName: SITE_NAME,
    featuredImage: img,
    featuredImageAlt: escapeHtml(post.title),
    featuredImageBlock,
    content: wrapArticle(post.contentHtml || ''),
    breadcrumbs: breadcrumbsHtml,
    topicPill: clusterPill,
    pillarBadge,
    tagsHtml: tagsWrap,
    clusterBox: clusterBoxHtml,
    relatedArticles: '',
    crossCategoryArticles: crossCategoryHtml,
    latestRelated: latestRelatedHtml,
    robotsMeta,
    previewBanner,
  };

  let rendered = templateHtml;
  for (const [key, val] of Object.entries(variables)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    rendered = rendered.replace(regex, val !== undefined && val !== null ? val : '');
  }

  return rendered;
}

// ---- Regenerate Site Feeds & Indexes ----

function articleRowHtml(post, pathPrefix) {
  const cat = CATEGORIES[post.category] || CATEGORIES.education;
  const href = `${pathPrefix}${post.category}/${post.slug}.html`;
  const img = post.image ? `${pathPrefix}${post.image}` : '';
  return `      <article class="article-row">
        <a href="${href}">
          <img src="${img}" alt="${escapeHtml(post.title)}" width="100" height="100" loading="lazy" onerror="this.style.display='none'">
        </a>
        <div>
          <p class="category-tag">${cat.label}</p>
          <h3><a href="${href}">${escapeHtml(post.title)}</a></h3>
          <p class="dek">${escapeHtml(post.description)}</p>
          <p class="meta">By ${escapeHtml(post.author || 'Staff')} · ${post.date} · ${escapeHtml(post.readTime || '')}</p>
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
  const clusterSlugs = [...new Set(posts.map((p) => p.cluster).filter(Boolean))];
  const clusterUrls = clusterSlugs.map((slug) => ({
    loc: `${SITE_URL}/topic/${slug}.html`,
    changefreq: 'weekly',
    priority: '0.85',
  }));
  const postUrls = posts.map((p) => ({
    loc: `${SITE_URL}/${p.category}/${p.slug}.html`,
    lastmod: p.date,
    changefreq: 'monthly',
    priority: '0.8',
  }));
  const all = [...staticUrls, ...clusterUrls, ...postUrls];
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
      <category>${CATEGORIES[p.category] ? CATEGORIES[p.category].label : p.category}</category>
    </item>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n  <channel>\n    <title>${SITE_NAME}</title>\n    <link>${SITE_URL}/</link>\n    <description>Education and news for curious minds.</description>\n    <language>en-us</language>\n    <atom:link href="${SITE_URL}/rss.xml" rel="self" type="application/rss+xml"/>\n    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n${items}\n  </channel>\n</rss>\n`;
}

// ---- Image optimization ----

async function optimizeImage(buffer) {
  return sharp(buffer)
    .rotate()
    .resize({
      width: 1200,
      height: 630,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 82 })
    .toBuffer();
}

// ---- GitHub API ----

async function getGithubFile(filePath) {
  if (!GITHUB_TOKEN) return null;
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

async function commitFilesToGithub(message, files) {
  if (!GITHUB_TOKEN) return;

  const refRes = await octokit.git.getRef({
    owner: GITHUB_REPO_OWNER, repo: GITHUB_REPO_NAME, ref: `heads/${GITHUB_BRANCH}`,
  });
  const commitSha = refRes.data.object.sha;

  const commitRes = await octokit.git.getCommit({
    owner: GITHUB_REPO_OWNER, repo: GITHUB_REPO_NAME, commit_sha: commitSha,
  });
  const treeSha = commitRes.data.tree.sha;

  const tree = await Promise.all(files.map(async (f) => {
    if (f.encoding === 'base64') {
      const blobRes = await octokit.git.createBlob({
        owner: GITHUB_REPO_OWNER,
        repo: GITHUB_REPO_NAME,
        content: f.content,
        encoding: 'base64',
      });
      return { path: f.path, mode: '100644', type: 'blob', sha: blobRes.data.sha };
    }
    return { path: f.path, mode: '100644', type: 'blob', content: f.content };
  }));

  const newTreeRes = await octokit.git.createTree({
    owner: GITHUB_REPO_OWNER, repo: GITHUB_REPO_NAME, base_tree: treeSha, tree,
  });

  const newCommitRes = await octokit.git.createCommit({
    owner: GITHUB_REPO_OWNER,
    repo: GITHUB_REPO_NAME,
    message,
    tree: newTreeRes.data.sha,
    parents: [commitSha],
  });

  await octokit.git.updateRef({
    owner: GITHUB_REPO_OWNER,
    repo: GITHUB_REPO_NAME,
    ref: `heads/${GITHUB_BRANCH}`,
    sha: newCommitRes.data.sha,
  });
}

/**
 * Commits files both to local disk (when running in dev) and to GitHub API
 */
async function commitFiles(message, files) {
  if (fs.existsSync(PUBLIC_DIR)) {
    for (const f of files) {
      const fullPath = path.join(REPO_ROOT, f.path);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (f.encoding === 'base64') {
        fs.writeFileSync(fullPath, Buffer.from(f.content, 'base64'));
      } else {
        fs.writeFileSync(fullPath, f.content, 'utf8');
      }
    }
  }

  if (GITHUB_TOKEN) {
    await commitFilesToGithub(message, files);
  }
}

// ---- Routes ----

app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'login.html')));

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = jwt.sign({ user: username }, SESSION_SECRET, { expiresIn: '8h' });
    res.cookie('admin_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 8 * 60 * 60 * 1000,
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
    const file = await getGithubFile('public/posts.json');
    const posts = file ? JSON.parse(file.content) : readPostsLocal();
    res.json(posts);
  } catch (err) {
    res.json(readPostsLocal());
  }
});

// View Library registry endpoint
app.get('/admin/views', requireAuth, async (req, res) => {
  try {
    const [viewsFile, postsFile] = await Promise.all([
      getGithubFile('views/views.json'),
      getGithubFile('public/posts.json'),
    ]);
    const views = viewsFile ? JSON.parse(viewsFile.content) : readViewsLocal();
    const posts = postsFile ? JSON.parse(postsFile.content) : readPostsLocal();
    res.json(getViewsWithCounts(views, posts));
  } catch (err) {
    const views = readViewsLocal();
    const posts = readPostsLocal();
    res.json(getViewsWithCounts(views, posts));
  }
});

// List existing published HTML articles available to be chosen as a view
app.get('/admin/existing-articles', requireAuth, async (req, res) => {
  try {
    const posts = readPostsLocal();
    const articles = [];

    ['education', 'news'].forEach((cat) => {
      const catDir = path.join(PUBLIC_DIR, cat);
      if (fs.existsSync(catDir)) {
        fs.readdirSync(catDir).forEach((file) => {
          if (file.endsWith('.html') && file !== 'index.html') {
            const slug = file.replace('.html', '');
            const matched = posts.find((p) => p.slug === slug && p.category === cat);
            articles.push({
              category: cat,
              slug,
              path: `public/${cat}/${file}`,
              title: matched ? matched.title : slug.replace(/-/g, ' '),
            });
          }
        });
      }
    });

    res.json(articles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Preview a view in View Library with a realistic sample article
app.get('/admin/preview/view/:viewId', requireAuth, async (req, res) => {
  try {
    const { viewId } = req.params;
    const views = readViewsLocal();
    const targetView = views.find((v) => v.id === viewId) || { id: viewId, name: viewId };
    const posts = readPostsLocal();

    const sample = {
      ...SAMPLE_ARTICLE,
      view: { id: targetView.id, name: targetView.name, type: targetView.type },
    };

    const html = renderArticlePage(sample, posts, { preview: true, viewName: targetView.name });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).send(`<h3>Error previewing view:</h3><pre>${escapeHtml(err.message)}</pre>`);
  }
});

// Preview the current draft article being authored in Dashboard
app.post('/admin/preview/article', requireAuth, uploadFields, async (req, res) => {
  try {
    const title = (req.body.title || 'Untitled Draft').trim();
    const category = req.body.category || 'education';
    const description = (req.body.description || '').trim();
    const author = (req.body.author || 'The Daybook Staff').trim();
    const slug = slugify(req.body.slug || title);
    const date = req.body.date || new Date().toISOString().slice(0, 10);
    const readTime = (req.body.readTime || '5 min read').trim();
    let cluster = req.body.cluster ? slugify(req.body.cluster) : '';
    let clusterName = (req.body.clusterName || '').trim() || (cluster ? cluster.replace(/-/g, ' ') : '');
    const isPillar = req.body.isPillar === 'true' || req.body.isPillar === 'on' || req.body.isPillar === true;
    const viewId = req.body.viewId || `${category}-default`;

    const tags = req.body.tags
      ? (Array.isArray(req.body.tags) ? req.body.tags : req.body.tags.split(','))
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
      : [];

    let contentHtml = req.body.content && req.body.content.trim();
    const htmlFiles = req.files && req.files['file'];
    if (!contentHtml && htmlFiles && htmlFiles[0]) contentHtml = htmlFiles[0].buffer.toString('utf8');
    if (!contentHtml) contentHtml = '<p>No content provided for preview.</p>';

    const posts = readPostsLocal();

    // Auto cluster if not provided
    if (!cluster) {
      const detected = detectTopicCluster({ title, description, category, tags, contentHtml }, posts);
      if (detected.cluster) {
        cluster = detected.cluster;
        clusterName = detected.clusterName;
      }
    }

    const post = {
      title,
      slug,
      category,
      cluster,
      clusterName,
      isPillar,
      tags,
      description,
      author,
      date,
      readTime,
      image: '',
      contentHtml,
      view: { id: viewId },
    };

    const views = readViewsLocal();
    const chosenView = views.find((v) => v.id === viewId) || { name: viewId };
    const html = renderArticlePage(post, posts, { preview: true, viewName: chosenView.name });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).send(`<h3>Preview error:</h3><pre>${escapeHtml(err.message)}</pre>`);
  }
});

// Live Clustering Feedback Endpoint
app.post('/admin/api/detect-cluster', requireAuth, (req, res) => {
  const { title, description, category, tags, content } = req.body;
  const posts = readPostsLocal();
  const tagsArr = tags
    ? (Array.isArray(tags) ? tags : String(tags).split(',')).map((t) => t.trim().toLowerCase()).filter(Boolean)
    : [];
  const detected = detectTopicCluster(
    { title, description, category, tags: tagsArr, contentHtml: content },
    posts
  );
  res.json(detected);
});

// Create a new view from existing article, template, or custom HTML
app.post('/admin/create-view', requireAuth, async (req, res) => {
  try {
    const { name, id: rawId, type, description, sourceArticle, customHtml } = req.body;
    if (!name) return res.status(400).json({ error: 'View name is required' });
    const viewId = slugify(rawId || name);
    if (!isValidSlug(viewId)) return res.status(400).json({ error: 'Invalid view ID' });

    const views = readViewsLocal();
    if (views.some((v) => v.id === viewId)) {
      return res.status(400).json({ error: `A view with ID "${viewId}" already exists.` });
    }

    let templateContent = '';
    let derivedFrom = undefined;
    const targetSource = `templates/article/${viewId}.html`;

    if (type === 'article-derived' && sourceArticle) {
      let sourceHtml = '';
      const localSourcePath = path.join(REPO_ROOT, sourceArticle);
      if (fs.existsSync(localSourcePath)) {
        sourceHtml = fs.readFileSync(localSourcePath, 'utf8');
      } else {
        const ghFile = await getGithubFile(sourceArticle);
        if (ghFile) sourceHtml = ghFile.content;
      }
      if (!sourceHtml) return res.status(404).json({ error: `Source article "${sourceArticle}" not found.` });

      templateContent = extractViewFromHtml(sourceHtml);
      derivedFrom = sourceArticle;
    } else if (type === 'html' && customHtml) {
      templateContent = customHtml;
    } else {
      templateContent = loadViewTemplateSync('education-default') || getStandardTemplateFallback();
    }

    const newView = {
      id: viewId,
      name: name.trim(),
      type: type || 'template',
      source: targetSource,
      derivedFrom,
      description: (description || `Custom view: ${name}`).trim(),
      active: true,
    };

    views.push(newView);

    const filesToCommit = [
      { path: targetSource, content: templateContent },
      { path: 'views/views.json', content: JSON.stringify(views, null, 2) + '\n' },
    ];

    await commitFiles(`Create view: ${newView.name}`, filesToCommit);

    res.json({ ok: true, view: newView, message: `View "${newView.name}" created and registered!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch a single article's body HTML so the edit form can be pre-filled
app.get('/admin/post/:category/:slug', requireAuth, async (req, res) => {
  const { category, slug } = req.params;
  if (!CATEGORIES[category]) return res.status(400).json({ error: 'Invalid category' });
  if (!isValidSlug(slug)) return res.status(400).json({ error: 'Invalid slug' });
  try {
    const file = await getGithubFile(`public/${category}/${slug}.html`);
    const content = file ? file.content : (fs.existsSync(path.join(PUBLIC_DIR, category, `${slug}.html`)) ? fs.readFileSync(path.join(PUBLIC_DIR, category, `${slug}.html`), 'utf8') : null);
    if (!content) return res.status(404).json({ error: 'Post not found' });
    const match = content.match(/<article class="article-body">\s*([\s\S]*?)\s*<\/article>/);
    res.json({ content: match ? match[1].trim() : content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add / Update Post with Dual Authoring & Automatic Clustering
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

    if (!isValidSlug(slug)) {
      return res.status(400).json({ error: 'Invalid slug — only lowercase letters, numbers, and hyphens allowed.' });
    }

    let date = new Date().toISOString().slice(0, 10);
    const readTime = req.body.readTime && req.body.readTime.trim() ? req.body.readTime.trim() : '5 min read';

    // ---- View Selection ----
    const viewId = req.body.viewId || `${category}-default`;
    const views = readViewsLocal();
    const chosenView = views.find((v) => v.id === viewId) || { id: viewId, name: viewId, type: 'template' };

    // ---- Topic Cluster & Tags ----
    let cluster = req.body.cluster ? slugify(req.body.cluster) : '';
    let clusterName = (req.body.clusterName || '').trim() || (cluster ? cluster.replace(/-/g, ' ') : '');
    let isPillar = req.body.isPillar === 'true' || req.body.isPillar === 'on' || req.body.isPillar === true;
    let clusterSource = cluster ? 'manual' : 'auto';
    let clusterConfidence = 100;

    let tags = req.body.tags
      ? (Array.isArray(req.body.tags) ? req.body.tags : req.body.tags.split(','))
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
      : [];

    // ---- Handle cover image upload ----
    let image = (req.body.image || '').trim();
    const imageFiles = req.files && req.files['coverImage'];
    let coverImageFile = null;
    if (imageFiles && imageFiles[0]) {
      const raw = imageFiles[0].buffer;
      const optimized = await optimizeImage(raw);
      const imagePath = `public/images/${slug}.webp`;
      image = `images/${slug}.webp`;
      coverImageFile = { path: imagePath, content: optimized.toString('base64'), encoding: 'base64' };
    }

    // ---- Fetch live files from GitHub or local disk ----
    const [postsFile, homepageFile, catArchiveFile] = await Promise.all([
      getGithubFile('public/posts.json'),
      getGithubFile('public/index.html'),
      getGithubFile(`public/${category}/index.html`),
    ]);

    let posts = postsFile ? JSON.parse(postsFile.content) : readPostsLocal();
    const idx = posts.findIndex((p) => p.slug === slug && p.category === category);

    // If updating an existing post, preserve fields if not supplied
    if (idx >= 0) {
      if (!image && posts[idx].image) image = posts[idx].image;
      if (posts[idx].date) date = posts[idx].date;
      if (!cluster && posts[idx].cluster) {
        cluster = posts[idx].cluster;
        clusterName = posts[idx].clusterName || clusterName;
        clusterSource = posts[idx].clusterSource || 'manual';
      }
      if (req.body.isPillar === undefined && posts[idx].isPillar !== undefined) isPillar = posts[idx].isPillar;
      if (!req.body.tags && posts[idx].tags) tags = posts[idx].tags;
    }

    // ---- Automatic Clustering Logic if no cluster provided ----
    if (!cluster) {
      const newPostData = { title, description, category, tags, contentHtml };
      const detected = detectTopicCluster(newPostData, posts);
      if (detected.cluster && detected.confidence >= 60) {
        cluster = detected.cluster;
        clusterName = detected.clusterName;
        clusterConfidence = detected.confidence;
        clusterSource = 'auto';
      }
    }

    const post = {
      title,
      slug,
      category,
      view: {
        id: chosenView.id,
        type: chosenView.type,
        name: chosenView.name,
      },
      cluster,
      clusterName,
      clusterSource,
      clusterConfidence,
      isPillar,
      tags,
      description,
      author,
      date,
      readTime,
      image,
      contentHtml,
    };

    const { contentHtml: _drop, ...postMeta } = post;
    if (idx >= 0) posts[idx] = postMeta;
    else posts.push(postMeta);
    posts.sort((a, b) => new Date(b.date) - new Date(a.date));

    // ---- Build files to commit ----
    const filesToCommit = [];

    // 1. Article page
    filesToCommit.push({
      path: `public/${category}/${slug}.html`,
      content: renderArticlePage(post, posts),
    });

    // 2. Topic Hub page(s)
    const allClusters = [...new Set(posts.map((p) => p.cluster).filter(Boolean))];
    for (const c of allClusters) {
      filesToCommit.push({
        path: `public/topic/${c}.html`,
        content: renderTopicHubPage(c, posts),
      });
    }

    // 3. posts.json
    filesToCommit.push({
      path: 'public/posts.json',
      content: JSON.stringify(posts, null, 2) + '\n',
    });

    // 4. Homepage
    const hpContent = homepageFile
      ? homepageFile.content
      : (fs.existsSync(INDEX_HTML) ? fs.readFileSync(INDEX_HTML, 'utf8') : null);
    if (hpContent) {
      filesToCommit.push({
        path: 'public/index.html',
        content: regenerateHomepage(hpContent, posts),
      });
    }

    // 5. Category archive
    const catContent = catArchiveFile
      ? catArchiveFile.content
      : (fs.existsSync(path.join(PUBLIC_DIR, category, 'index.html'))
          ? fs.readFileSync(path.join(PUBLIC_DIR, category, 'index.html'), 'utf8')
          : null);
    if (catContent) {
      filesToCommit.push({
        path: `public/${category}/index.html`,
        content: regenerateCategoryArchive(catContent, category, posts),
      });
    }

    // 6. Sitemap & RSS
    filesToCommit.push({ path: 'public/sitemap.xml', content: regenerateSitemap(posts) });
    filesToCommit.push({ path: 'public/rss.xml', content: regenerateRss(posts) });

    // 7. Cover image if uploaded
    if (coverImageFile) filesToCommit.push(coverImageFile);

    // Save locally and commit to GitHub
    await commitFiles(`Publish article: ${title}`, filesToCommit);

    const publicUrl = `${SITE_URL}/${category}/${slug}.html`;
    res.json({
      ok: true,
      slug,
      url: publicUrl,
      message: `Published! Static HTML generated and deployed. Live at: ${publicUrl}`,
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
