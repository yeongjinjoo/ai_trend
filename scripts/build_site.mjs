#!/usr/bin/env node
/*
 * build_site.mjs — AI 트렌드 정적 사이트 빌더 (의존성 없음, 순수 Node)
 *
 * 하는 일:
 *   1) ai-trend/YYYY-MM-DD/{en,zh,ja,ko}/ 폴더를 스캔
 *   2) index.html (다국어 아카이브/랜딩) 생성
 *   3) feed-{lang}.xml (언어별 RSS 2.0) 생성  ← 모든 자동화의 척추
 *   4) sitemap.xml (hreflang 대체 링크 포함) + robots.txt 생성
 *   5) og-default.svg (없으면) 생성
 *   6) 각 이슈 HTML <head>에 canonical / hreflang / Open Graph / Twitter 메타 주입
 *
 * 실행: node scripts/build_site.mjs
 * 재실행해도 안전(idempotent) — 메타는 마커로 감싸 교체됨.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..'); // = ai-trend/ (사이트 루트)

/* ─────────────────────────────────────────────────────────────
 * 설정 — 호스팅/브랜드/구독 주소가 정해지면 여기만 고치면 됩니다.
 * ───────────────────────────────────────────────────────────── */
const SITE = {
  // 배포 후 실제 주소로 교체 (예: https://ai-weekly.pages.dev 또는 커스텀 도메인).
  // CI에서는 SITE_URL 환경변수로 덮어쓸 수 있음.
  url: (process.env.SITE_URL || 'https://ai-trend-932.pages.dev').replace(/\/+$/, ''),
  brandLatin: 'This Week in AI',   // 로고/대표 로마자 표기
  ogImage: 'og-default.png',       // 공유 썸네일 (1200x630). SVG 미지원 플랫폼(인스타/페북 등) 대응
  subscribeUrl: '',                // beehiiv 등 구독 페이지 생기면 채우기. 비우면 RSS로 대체
  publisher: { name: '', url: '' },// 개인 브랜드: 이름 / 링크(LinkedIn 등). 비우면 표시 안 함
  // 검색엔진 소유권 확인용 메타태그(content 값만). 빌드마다 index.html <head>에 자동 삽입됨.
  siteVerification: {
    google: 'KsLqzsZLW6vuJMYCl2Wk7nJ_eLDaoImEwWoi_5S8FAU',
    bing: '', // Bing Webmaster Tools 등록 시 채우기
  },
};

const LANGS = ['en', 'zh', 'ja', 'ko'];

const LANG_META = {
  en: {
    label: 'EN', locale: 'en_US',
    site: 'This Week in AI',
    desc: 'A weekly, multilingual roundup of what matters in AI — in English, Chinese, Japanese and Korean.',
    ui: { tagline: 'A weekly roundup of global AI trends — in four languages.',
          latest: 'Latest issue', archive: 'All issues', read: 'Read', deck: 'Slides',
          subscribe: 'Subscribe', rss: 'RSS',
          footNote: 'Auto-curated weekly from public sources.' },
  },
  zh: {
    label: '中文', locale: 'zh_CN',
    site: '本周 AI 趋势',
    desc: '每周多语种 AI 要闻精选 — 提供英文、中文、日文、韩文版本。',
    ui: { tagline: '每周全球 AI 趋势精选 — 四种语言。',
          latest: '最新一期', archive: '全部期号', read: '阅读', deck: '幻灯片',
          subscribe: '订阅', rss: 'RSS',
          footNote: '每周根据公开来源自动整理。' },
  },
  ja: {
    label: '日本語', locale: 'ja_JP',
    site: '今週の AI トレンド',
    desc: '毎週・多言語の AI 注目ニュースまとめ — 英語・中国語・日本語・韓国語。',
    ui: { tagline: '世界の AI トレンドを毎週まとめて — 4 言語で。',
          latest: '最新号', archive: 'すべての号', read: '読む', deck: 'スライド',
          subscribe: '購読', rss: 'RSS',
          footNote: '毎週、公開情報をもとに自動でまとめています。' },
  },
  ko: {
    label: '한국어', locale: 'ko_KR',
    site: '이번 주 AI 트렌드',
    desc: '매주 4개 언어(영어·중국어·일본어·한국어)로 정리하는 글로벌 AI 트렌드.',
    ui: { tagline: '매주 정리하는 전 세계 AI 트렌드 — 4개 언어로.',
          latest: '최신 호', archive: '전체 호', read: '읽기', deck: '슬라이드',
          subscribe: '구독', rss: 'RSS',
          footNote: '매주 공개 출처를 기반으로 자동 정리됩니다.' },
  },
};

/* ───────────────────────── 헬퍼 ───────────────────────── */
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const stripTags = (s) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

const abs = (rel) => SITE.url + '/' + String(rel).replace(/^\/+/, '');

const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

const extract = (html, re) => { const m = html.match(re); return m ? stripTags(m[1]) : ''; };

const rfc822 = (date) => new Date(`${date}T09:00:00Z`).toUTCString();

const issueRel = (date, lang) => `${date}/${lang}/ai-trends-${date}-${lang}.html`;
const deckRel  = (date, lang) => `${date}/${lang}/ai-trends-${date}-${lang}.pptx`;

/* ───────────────────── 1) 콘텐츠 스캔 ───────────────────── */
function scanIssues() {
  const dateDirs = fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .map((d) => d.name)
    .sort()
    .reverse(); // 최신순

  const issues = [];
  for (const date of dateDirs) {
    const langs = {};
    for (const lang of LANGS) {
      const rel = issueRel(date, lang);
      const file = path.join(ROOT, rel);
      if (!fs.existsSync(file)) continue;
      const html = fs.readFileSync(file, 'utf8');
      const title = extract(html, /<h1[^>]*class="title"[^>]*>([\s\S]*?)<\/h1>/i)
                 || extract(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
      const tagline = extract(html, /<p[^>]*class="tagline"[^>]*>([\s\S]*?)<\/p>/i);
      const intro   = extract(html, /<p[^>]*class="intro"[^>]*>([\s\S]*?)<\/p>/i) || tagline;
      const deckExists = fs.existsSync(path.join(ROOT, deckRel(date, lang)));
      langs[lang] = {
        title: title || `${date}`,
        tagline,
        intro,
        url: rel,
        deck: deckExists ? deckRel(date, lang) : null,
      };
    }
    if (Object.keys(langs).length) issues.push({ date, langs });
  }
  return issues;
}

const dataFor = (issue, lang) =>
  issue.langs[lang] || issue.langs.en || issue.langs[Object.keys(issue.langs)[0]];

/* ───────────────── 2) 이슈 HTML에 메타 주입 ───────────────── */
function injectMeta(issues) {
  let touched = 0;
  for (const issue of issues) {
    const present = Object.keys(issue.langs);
    const xDefaultLang = issue.langs.en ? 'en' : present[0];
    for (const lang of present) {
      const d = issue.langs[lang];
      const file = path.join(ROOT, d.url);
      const html = fs.readFileSync(file, 'utf8');
      const desc = truncate(d.intro || d.tagline || '', 280);

      const lines = [];
      lines.push('  <!-- BUILD_SITE:META:START (자동 생성 — 수정 금지) -->');
      lines.push(`  <link rel="canonical" href="${esc(abs(d.url))}">`);
      for (const l of present) {
        lines.push(`  <link rel="alternate" hreflang="${l}" href="${esc(abs(issue.langs[l].url))}">`);
      }
      lines.push(`  <link rel="alternate" hreflang="x-default" href="${esc(abs(issue.langs[xDefaultLang].url))}">`);
      lines.push(`  <meta name="description" content="${esc(desc)}">`);
      lines.push(`  <meta property="og:type" content="article">`);
      lines.push(`  <meta property="og:site_name" content="${esc(LANG_META[lang].site)}">`);
      lines.push(`  <meta property="og:locale" content="${LANG_META[lang].locale}">`);
      lines.push(`  <meta property="og:title" content="${esc(d.title)}">`);
      lines.push(`  <meta property="og:description" content="${esc(desc)}">`);
      lines.push(`  <meta property="og:url" content="${esc(abs(d.url))}">`);
      lines.push(`  <meta property="og:image" content="${esc(abs(SITE.ogImage))}">`);
      lines.push(`  <meta name="twitter:card" content="summary_large_image">`);
      lines.push(`  <meta name="twitter:title" content="${esc(d.title)}">`);
      lines.push(`  <meta name="twitter:description" content="${esc(desc)}">`);
      lines.push(`  <meta name="twitter:image" content="${esc(abs(SITE.ogImage))}">`);
      lines.push('  <!-- BUILD_SITE:META:END -->');
      const block = lines.join('\n') + '\n';

      const marker = /[ \t]*<!-- BUILD_SITE:META:START[\s\S]*?<!-- BUILD_SITE:META:END -->\n?/;
      let out;
      if (marker.test(html)) out = html.replace(marker, block);
      else out = html.replace(/<\/head>/i, block + '</head>');

      if (out !== html) { fs.writeFileSync(file, out, 'utf8'); touched++; }
    }
  }
  return touched;
}

/* ───────────────────── 3) index.html ───────────────────── */
function renderLangBlock(issues, lang) {
  const ui = LANG_META[lang].ui;
  const latest = dataFor(issues[0], lang);
  const rows = issues.map((it) => {
    const d = dataFor(it, lang);
    const deck = d.deck ? ` &middot; <a href="${esc(d.deck)}">${esc(ui.deck)}</a>` : '';
    return `        <li class="issue">
          <span class="issue-date">${it.date}</span>
          <a class="issue-title" href="${esc(d.url)}">${esc(d.title)}</a>
          <span class="issue-tag">${esc(d.tagline)}</span>
          <span class="issue-links"><a href="${esc(d.url)}">${esc(ui.read)}</a>${deck}</span>
        </li>`;
  }).join('\n');

  return `    <div class="lang-block" data-lang-block="${lang}">
      <section class="hero">
        <div class="kicker">${esc(ui.latest)}</div>
        <a class="hero-card" href="${esc(latest.url)}">
          <span class="hero-date">${issues[0].date}</span>
          <h2>${esc(latest.title)}</h2>
          <p>${esc(latest.tagline)}</p>
          <span class="hero-read">${esc(ui.read)} &rarr;</span>
        </a>
      </section>
      <section class="archive">
        <div class="kicker">${esc(ui.archive)}</div>
        <ul class="issue-list">
${rows}
        </ul>
      </section>
    </div>`;
}

const CLIENT_JS = `<script>
(function () {
  var UI = __UI__;
  var DEFAULT = "en";
  function pick() {
    try { var s = localStorage.getItem("aitrend_lang"); if (s && UI[s]) return s; } catch (e) {}
    var n = (navigator.language || "en").slice(0, 2).toLowerCase();
    if (UI[n]) return n;
    return DEFAULT;
  }
  function apply(lang) {
    if (!UI[lang]) lang = DEFAULT;
    document.body.setAttribute("data-lang", lang);
    document.documentElement.setAttribute("lang", lang);
    var t = UI[lang], nodes = document.querySelectorAll("[data-i18n]"), i;
    for (i = 0; i < nodes.length; i++) {
      var k = nodes[i].getAttribute("data-i18n");
      if (t[k] != null) nodes[i].textContent = t[k];
    }
    var rss = document.getElementById("rssBtn");
    if (rss) rss.setAttribute("href", "feed-" + lang + ".xml");
    var sub = document.getElementById("subscribeBtn");
    if (sub) sub.setAttribute("href", t.subscribeUrl || ("feed-" + lang + ".xml"));
    var btns = document.querySelectorAll("[data-setlang]"), j;
    for (j = 0; j < btns.length; j++) {
      btns[j].setAttribute("aria-current", btns[j].getAttribute("data-setlang") === lang ? "true" : "false");
    }
    try { localStorage.setItem("aitrend_lang", lang); } catch (e) {}
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("[data-setlang]") : null;
    if (b) { e.preventDefault(); apply(b.getAttribute("data-setlang")); }
  });
  apply(pick());
})();
</script>`;

function buildIndex(issues) {
  const uiForJs = {};
  for (const l of LANGS) {
    uiForJs[l] = {
      site: LANG_META[l].site,
      tagline: LANG_META[l].ui.tagline,
      subscribe: LANG_META[l].ui.subscribe,
      rss: LANG_META[l].ui.rss,
      footNote: LANG_META[l].ui.footNote,
      subscribeUrl: SITE.subscribeUrl || '',
    };
  }

  const switcher = LANGS.map((l) =>
    `<button type="button" data-setlang="${l}"${l === 'en' ? ' aria-current="true"' : ''}>${esc(LANG_META[l].label)}</button>`
  ).join('');

  const footRss = LANGS.map((l) => `<a href="feed-${l}.xml">${esc(LANG_META[l].label)}</a>`).join(' · ');

  const byLine = SITE.publisher.name
    ? `\n        <p class="foot-by">${esc(SITE.publisher.name)}${SITE.publisher.url ? ` · <a href="${esc(SITE.publisher.url)}">${esc(SITE.publisher.url.replace(/^https?:\/\//, ''))}</a>` : ''}</p>`
    : '';

  const blocks = issues.length
    ? LANGS.map((l) => renderLangBlock(issues, l)).join('\n')
    : '<p style="color:var(--muted)">아직 게시된 호가 없습니다.</p>';

  const en = LANG_META.en;
  const subHref = SITE.subscribeUrl || 'feed-en.xml';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(en.site)} — Weekly Global AI Trends (EN · 中文 · 日本語 · 한국어)</title>
<meta name="description" content="${esc(en.desc)}">
<link rel="canonical" href="${esc(SITE.url)}/">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(en.site)}">
<meta property="og:description" content="${esc(en.desc)}">
<meta property="og:url" content="${esc(SITE.url)}/">
<meta property="og:image" content="${esc(abs(SITE.ogImage))}">
<meta name="twitter:card" content="summary_large_image">
${SITE.siteVerification.google ? `<meta name="google-site-verification" content="${esc(SITE.siteVerification.google)}">\n` : ''}${SITE.siteVerification.bing ? `<meta name="msvalidate.01" content="${esc(SITE.siteVerification.bing)}">\n` : ''}<style>
  :root{--ink:#1a1a1a;--muted:#6b6b6b;--accent:#d4541b;--bg:#fafaf7;--card:#fff;--rule:#e8e6df;}
  *{box-sizing:border-box;}
  body{margin:0;background:var(--bg);color:var(--ink);line-height:1.6;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Apple SD Gothic Neo","Noto Sans KR","Noto Sans JP","Noto Sans SC",sans-serif;
    -webkit-font-smoothing:antialiased;}
  .wrap{max-width:760px;margin:0 auto;padding:40px 24px 72px;}
  .site-head{border-bottom:2px solid var(--ink);padding-bottom:18px;margin-bottom:28px;}
  .brand{font-size:30px;font-weight:800;letter-spacing:-0.01em;}
  .brand-tag{color:var(--muted);font-size:15px;margin:4px 0 16px;}
  .switcher{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;}
  .switcher button{font:inherit;font-size:13px;font-weight:600;cursor:pointer;
    padding:5px 12px;border:1px solid var(--rule);border-radius:999px;background:var(--card);color:var(--muted);}
  .switcher button[aria-current="true"]{background:var(--ink);color:#fff;border-color:var(--ink);}
  .cta{display:flex;gap:10px;}
  .btn{display:inline-block;font-size:14px;font-weight:600;text-decoration:none;
    padding:8px 16px;border-radius:6px;border:1px solid var(--rule);color:var(--ink);}
  .btn.primary{background:var(--accent);border-color:var(--accent);color:#fff;}
  .kicker{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-bottom:10px;}
  .hero{margin-bottom:36px;}
  .hero-card{display:block;background:var(--card);border:1px solid var(--rule);border-left:4px solid var(--accent);
    border-radius:6px;padding:22px 26px;text-decoration:none;color:inherit;transition:box-shadow .15s;}
  .hero-card:hover{box-shadow:0 4px 18px rgba(0,0,0,.07);}
  .hero-date{font-size:13px;color:var(--muted);}
  .hero-card h2{font-size:24px;margin:6px 0 8px;line-height:1.25;}
  .hero-card p{margin:0 0 12px;color:var(--muted);}
  .hero-read{color:var(--accent);font-weight:600;font-size:14px;}
  .issue-list{list-style:none;padding:0;margin:0;}
  .issue{padding:16px 0;border-bottom:1px dashed var(--rule);}
  .issue:last-child{border-bottom:none;}
  .issue-date{display:block;font-size:12px;color:var(--muted);}
  .issue-title{display:inline-block;font-size:17px;font-weight:600;color:var(--ink);text-decoration:none;margin:2px 0;}
  .issue-title:hover{color:var(--accent);}
  .issue-tag{display:block;font-size:14px;color:var(--muted);}
  .issue-links{display:block;font-size:13px;margin-top:4px;}
  .issue-links a{color:var(--accent);text-decoration:none;}
  [data-lang-block]{display:none;}
  body[data-lang="en"] [data-lang-block="en"],
  body[data-lang="zh"] [data-lang-block="zh"],
  body[data-lang="ja"] [data-lang-block="ja"],
  body[data-lang="ko"] [data-lang-block="ko"]{display:block;}
  .site-foot{border-top:1px solid var(--rule);margin-top:44px;padding-top:20px;color:var(--muted);font-size:13px;}
  .site-foot a{color:var(--accent);text-decoration:none;}
  .foot-rss{margin:8px 0;}
</style>
</head>
<body data-lang="en">
  <div class="wrap">
    <header class="site-head">
      <div class="brand" data-i18n="site">${esc(en.site)}</div>
      <p class="brand-tag" data-i18n="tagline">${esc(en.ui.tagline)}</p>
      <nav class="switcher" aria-label="Language">${switcher}</nav>
      <div class="cta">
        <a id="subscribeBtn" class="btn primary" data-i18n="subscribe" href="${esc(subHref)}">${esc(en.ui.subscribe)}</a>
        <a id="rssBtn" class="btn" data-i18n="rss" href="feed-en.xml">${esc(en.ui.rss)}</a>
      </div>
    </header>
${blocks}
    <footer class="site-foot">
      <p class="foot-note" data-i18n="footNote">${esc(en.ui.footNote)}</p>
      <p class="foot-rss">RSS · ${footRss}</p>${byLine}
    </footer>
  </div>
${CLIENT_JS.replace('__UI__', () => JSON.stringify(uiForJs))}
</body>
</html>
`;
}

/* ───────────────────── 4) RSS 피드 ───────────────────── */
function buildFeed(issues, lang) {
  const meta = LANG_META[lang];
  const items = issues
    .filter((it) => it.langs[lang])
    .map((it) => {
      const d = it.langs[lang];
      return `  <item>
    <title>${esc(d.title)}</title>
    <link>${esc(abs(d.url))}</link>
    <guid isPermaLink="true">${esc(abs(d.url))}</guid>
    <pubDate>${rfc822(it.date)}</pubDate>
    <description>${esc(d.intro || d.tagline)}</description>
  </item>`;
    }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${esc(meta.site)}</title>
  <link>${esc(SITE.url)}/</link>
  <atom:link href="${esc(abs(`feed-${lang}.xml`))}" rel="self" type="application/rss+xml"/>
  <description>${esc(meta.desc)}</description>
  <language>${lang}</language>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>
`;
}

/* ───────────────────── 5) sitemap / robots ───────────────────── */
function buildSitemap(issues) {
  const urls = [];
  urls.push(`  <url>\n    <loc>${esc(SITE.url)}/</loc>\n    <lastmod>${issues[0] ? issues[0].date : new Date().toISOString().slice(0, 10)}</lastmod>\n  </url>`);
  for (const it of issues) {
    const present = Object.keys(it.langs);
    const xDefaultLang = it.langs.en ? 'en' : present[0];
    for (const lang of present) {
      const alts = present.map((l) =>
        `    <xhtml:link rel="alternate" hreflang="${l}" href="${esc(abs(it.langs[l].url))}"/>`
      ).join('\n');
      urls.push(`  <url>
    <loc>${esc(abs(it.langs[lang].url))}</loc>
    <lastmod>${it.date}</lastmod>
${alts}
    <xhtml:link rel="alternate" hreflang="x-default" href="${esc(abs(it.langs[xDefaultLang].url))}"/>
  </url>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`;
}

const buildRobots = () =>
  `User-agent: *\nAllow: /\n\nSitemap: ${abs('sitemap.xml')}\n`;

/* ───────────────────── 6) 기본 OG 이미지 (SVG) ───────────────────── */
function buildOgSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#fafaf7"/>
  <rect width="1200" height="14" fill="#d4541b"/>
  <text x="80" y="170" font-family="Segoe UI, Arial, sans-serif" font-size="40" fill="#d4541b" font-weight="700" letter-spacing="6">THIS WEEK IN AI</text>
  <text x="80" y="320" font-family="Segoe UI, Arial, sans-serif" font-size="86" fill="#1a1a1a" font-weight="800">Global AI trends,</text>
  <text x="80" y="420" font-family="Segoe UI, Arial, sans-serif" font-size="86" fill="#1a1a1a" font-weight="800">every week.</text>
  <text x="80" y="540" font-family="Segoe UI, Arial, sans-serif" font-size="40" fill="#6b6b6b">English &#183; 中文 &#183; 日本語 &#183; 한국어</text>
</svg>
`;
}

/* ───────────────────────── 실행 ───────────────────────── */
function main() {
  const issues = scanIssues();
  const write = (name, content) => { fs.writeFileSync(path.join(ROOT, name), content, 'utf8'); };

  const metaTouched = injectMeta(issues);
  write('index.html', buildIndex(issues));
  for (const lang of LANGS) write(`feed-${lang}.xml`, buildFeed(issues, lang));
  write('sitemap.xml', buildSitemap(issues));
  write('robots.txt', buildRobots());

  const ogPath = path.join(ROOT, SITE.ogImage);
  if (SITE.ogImage.endsWith('.svg') && !fs.existsSync(ogPath)) write(SITE.ogImage, buildOgSvg());

  const langCount = {};
  for (const it of issues) for (const l of Object.keys(it.langs)) langCount[l] = (langCount[l] || 0) + 1;

  console.log('✓ build_site 완료');
  console.log(`  - SITE.url   : ${SITE.url}`);
  console.log(`  - 이슈       : ${issues.length}개 (${issues.map((i) => i.date).join(', ') || '없음'})`);
  console.log(`  - 언어별 호수: ${LANGS.map((l) => `${l}:${langCount[l] || 0}`).join('  ')}`);
  console.log(`  - 메타 주입  : ${metaTouched}개 파일`);
  console.log('  - 생성       : index.html, ' + LANGS.map((l) => `feed-${l}.xml`).join(', ') + ', sitemap.xml, robots.txt');
}

main();
