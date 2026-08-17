const fs = require('fs');
const path = require('path');

const modules = require('./_modules_full.json');
const OUT = '/tmp/claude-1000/-home-dev-server-docker-forson-business-suite/d2bf9917-66eb-4aaa-8dba-0d63cec40745/scratchpad/guide-build/user-guide.html';

const GROUP_META = {
  'front-office': { label: 'Front Office', blurb: 'Where the day starts, and where the money is taken.' },
  'money': { label: 'Money &amp; Collections', blurb: 'Who owes you, who you owe, and how it gets paid.' },
  'stock': { label: 'Inventory &amp; Purchasing', blurb: 'What&rsquo;s on the shelf, and how it gets there.' },
  'people': { label: 'People', blurb: 'Staff records, schedules, and pay.' },
  'operations': { label: 'Operations', blurb: 'Records and numbers that cut across every department.' },
  'system': { label: 'System', blurb: 'Configuring the suite itself.' },
};
const GROUP_ORDER = ['front-office', 'money', 'stock', 'people', 'operations', 'system'];

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function audienceChips(audience) {
  if (!audience) return '';
  const parts = audience.split(/[,;]/).map((s) => s.trim()).filter(Boolean).slice(0, 6);
  return parts.map((p) => `<span class="chip">${esc(p)}</span>`).join('');
}

// Sidebar nav grouped
let navHtml = '';
for (const gid of GROUP_ORDER) {
  const mods = modules.filter((m) => m.group === gid);
  if (!mods.length) continue;
  navHtml += `<div class="nav-group" data-group="${gid}">
    <button class="nav-group-toggle" aria-expanded="true">
      <span>${GROUP_META[gid].label}</span>
      <svg class="chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <ul class="nav-list">
      ${mods.map((m) => `<li><a href="#${m.slug}" data-target="${m.slug}">${esc(m.title)}</a></li>`).join('\n      ')}
    </ul>
  </div>`;
}

// Landing group cards
let landingHtml = '';
for (const gid of GROUP_ORDER) {
  const mods = modules.filter((m) => m.group === gid);
  if (!mods.length) continue;
  landingHtml += `<div class="group-card">
    <div class="group-card-head">
      <h3>${GROUP_META[gid].label}</h3>
      <p>${GROUP_META[gid].blurb}</p>
    </div>
    <ul class="group-card-list">
      ${mods.map((m) => `<li><a href="#${m.slug}"><span class="gcl-title">${esc(m.title)}</span><span class="gcl-desc">${esc(m.glance || '')}</span></a></li>`).join('\n      ')}
    </ul>
  </div>`;
}

// Module sections
let sectionsHtml = '';
for (const m of modules) {
  sectionsHtml += `
  <section class="module" id="${m.slug}" data-group="${m.group}">
    <div class="module-head">
      <p class="module-kicker">${GROUP_META[m.group].label}</p>
      <h1>${esc(m.title)}</h1>
      <div class="chips">${audienceChips(m.audience)}</div>
    </div>
    <div class="module-body">
      ${m.html}
    </div>
    <a class="back-to-top-inline" href="#top">&uarr; Back to top</a>
  </section>`;
}

// Search index (headings + glance) built at compile time
const searchIndex = [];
for (const m of modules) {
  searchIndex.push({ slug: m.slug, title: m.title, text: (m.glance || '').slice(0, 140), kind: 'module' });
  const headingRe = /<h2 id="([^"]+)">.*?<\/a>([^<]+)<\/h2>/g;
  let hm;
  while ((hm = headingRe.exec(m.html))) {
    searchIndex.push({ slug: m.slug, anchor: hm[1], title: `${m.title} — ${hm[2]}`, text: '', kind: 'section' });
  }
}

const buildDate = new Date().toISOString().slice(0, 10);

const html = `<!doctype html>
<title>Forson Business Suite &mdash; User Guide</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root {
    --paper: #f4f5f7;
    --surface: #ffffff;
    --surface-2: #eef0f3;
    --ink: #171b21;
    --ink-soft: #545c68;
    --ink-faint: #8991a0;
    --line: #dfe3e8;
    --line-strong: #c7cdd6;
    --steel: #2f4d67;
    --steel-ink: #1d3245;
    --steel-tint: #e7edf3;
    --signal: #b8501c;
    --signal-tint: #fbeee3;
    --note-tint: #eef2fb;
    --note-ink: #38507f;
    --tip-tint: #eaf5ee;
    --tip-ink: #2c6b45;
    --code-bg: #eef0f3;
    --shadow: 0 1px 2px rgba(23,27,33,0.04), 0 8px 24px -12px rgba(23,27,33,0.12);
    --serif: ui-serif, "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --paper: #10131a;
      --surface: #171b23;
      --surface-2: #1d222b;
      --ink: #e8eaed;
      --ink-soft: #a4acb8;
      --ink-faint: #6c7480;
      --line: #262b35;
      --line-strong: #333a46;
      --steel: #8fb0cc;
      --steel-ink: #cfe0ee;
      --steel-tint: #1c2a37;
      --signal: #e3894e;
      --signal-tint: #2c2015;
      --note-tint: #1a2130;
      --note-ink: #a9bce0;
      --tip-tint: #16241b;
      --tip-ink: #8fceac;
      --code-bg: #1d222b;
      color-scheme: dark;
    }
  }
  :root[data-theme="dark"] {
    --paper: #10131a;
    --surface: #171b23;
    --surface-2: #1d222b;
    --ink: #e8eaed;
    --ink-soft: #a4acb8;
    --ink-faint: #6c7480;
    --line: #262b35;
    --line-strong: #333a46;
    --steel: #8fb0cc;
    --steel-ink: #cfe0ee;
    --steel-tint: #1c2a37;
    --signal: #e3894e;
    --signal-tint: #2c2015;
    --note-tint: #1a2130;
    --note-ink: #a9bce0;
    --tip-tint: #16241b;
    --tip-ink: #8fceac;
    --code-bg: #1d222b;
    color-scheme: dark;
  }

  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } *, *::before, *::after { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; } }

  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: var(--sans);
    font-size: 16px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }

  a { color: var(--steel); }
  a:focus-visible, button:focus-visible, input:focus-visible { outline: 2px solid var(--steel); outline-offset: 2px; border-radius: 4px; }

  /* ---------- Top bar ---------- */
  #top { position: absolute; top: 0; }
  .topbar {
    position: sticky; top: 0; z-index: 40;
    display: flex; align-items: center; gap: 14px;
    height: 56px; padding: 0 16px;
    background: var(--surface);
    border-bottom: 1px solid var(--line);
  }
  .topbar .brand { display: flex; align-items: baseline; gap: 8px; font-family: var(--serif); font-weight: 600; font-size: 1.05rem; letter-spacing: -0.01em; color: var(--ink); text-decoration: none; white-space: nowrap; }
  .topbar .brand .sub { font-family: var(--sans); font-weight: 500; font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-faint); }
  .menu-btn { display: none; }
  .topbar-search { flex: 1; max-width: 420px; margin-left: auto; position: relative; }
  .topbar-search input {
    width: 100%; padding: 8px 12px 8px 32px; border-radius: 8px; border: 1px solid var(--line-strong);
    background: var(--surface-2); color: var(--ink); font-size: 0.88rem; font-family: var(--sans);
  }
  .topbar-search svg { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--ink-faint); }
  .topbar-search kbd { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); font-family: var(--mono); font-size: 0.68rem; color: var(--ink-faint); background: var(--surface); border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; }
  .print-btn { border: 1px solid var(--line-strong); background: var(--surface); color: var(--ink-soft); font-size: 0.82rem; padding: 7px 12px; border-radius: 7px; cursor: pointer; font-family: var(--sans); white-space: nowrap; }
  .print-btn:hover { color: var(--ink); border-color: var(--steel); }

  .search-results {
    position: absolute; top: calc(100% + 6px); left: 0; right: 0;
    background: var(--surface); border: 1px solid var(--line-strong); border-radius: 10px;
    box-shadow: var(--shadow); max-height: 60vh; overflow-y: auto; display: none; z-index: 50;
  }
  .search-results.open { display: block; }
  .search-results a { display: block; padding: 9px 12px; color: var(--ink); text-decoration: none; font-size: 0.86rem; border-bottom: 1px solid var(--line); }
  .search-results a:last-child { border-bottom: none; }
  .search-results a:hover, .search-results a.active { background: var(--steel-tint); }
  .search-results .sr-kind { color: var(--ink-faint); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; margin-right: 6px; }
  .search-empty { padding: 14px 12px; color: var(--ink-faint); font-size: 0.85rem; }

  /* ---------- Shell ---------- */
  .shell { display: flex; min-height: calc(100vh - 56px); }

  .sidebar {
    width: 264px; flex: none; position: sticky; top: 56px; align-self: flex-start;
    height: calc(100vh - 56px); overflow-y: auto; padding: 18px 12px 40px;
    border-right: 1px solid var(--line); background: var(--surface);
  }
  .sidebar a.home-link { display: block; padding: 6px 10px; margin-bottom: 10px; font-size: 0.86rem; font-weight: 600; color: var(--ink); text-decoration: none; border-radius: 6px; }
  .sidebar a.home-link:hover { background: var(--surface-2); }
  .nav-group { margin-bottom: 4px; }
  .nav-group-toggle {
    width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 6px;
    background: none; border: none; padding: 8px 10px; cursor: pointer;
    font-family: var(--sans); font-size: 0.72rem; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase;
    color: var(--ink-faint);
  }
  .nav-group-toggle .chev { transition: transform 0.15s ease; }
  .nav-group.collapsed .nav-group-toggle .chev { transform: rotate(-90deg); }
  .nav-group.collapsed .nav-list { display: none; }
  .nav-list { list-style: none; margin: 0 0 8px; padding: 0; }
  .nav-list li a {
    display: block; padding: 7px 10px 7px 18px; border-radius: 6px; font-size: 0.87rem;
    color: var(--ink-soft); text-decoration: none; border-left: 2px solid transparent; margin-left: 2px;
  }
  .nav-list li a:hover { color: var(--ink); background: var(--surface-2); }
  .nav-list li a.active { color: var(--steel-ink); border-left-color: var(--steel); background: var(--steel-tint); font-weight: 600; }

  .content { flex: 1; min-width: 0; display: flex; justify-content: center; }
  .content-inner { width: 100%; max-width: 760px; padding: 0 24px 96px; }

  /* ---------- Landing ---------- */
  .landing { padding: 64px 0 40px; }
  .landing .eyebrow { font-family: var(--sans); font-size: 0.76rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--signal); margin: 0 0 14px; }
  .landing h1 { font-family: var(--serif); font-size: clamp(2.1rem, 4vw, 2.9rem); line-height: 1.12; letter-spacing: -0.015em; margin: 0 0 16px; text-wrap: balance; }
  .landing .deck { font-size: 1.08rem; color: var(--ink-soft); max-width: 56ch; margin: 0 0 30px; line-height: 1.55; }
  .landing .meta-row { display: flex; gap: 18px; flex-wrap: wrap; margin-bottom: 40px; font-size: 0.82rem; color: var(--ink-faint); }
  .landing .meta-row strong { color: var(--ink-soft); font-weight: 600; }

  .group-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; margin-top: 8px; }
  .group-card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 18px 18px 10px; box-shadow: var(--shadow); }
  .group-card-head h3 { font-family: var(--serif); font-size: 1.12rem; margin: 0 0 4px; }
  .group-card-head p { margin: 0 0 12px; font-size: 0.85rem; color: var(--ink-faint); }
  .group-card-list { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
  .group-card-list li a { display: flex; flex-direction: column; gap: 2px; padding: 10px 2px; text-decoration: none; border-bottom: 1px solid var(--line); }
  .group-card-list li:last-child a { border-bottom: none; }
  .gcl-title { color: var(--ink); font-weight: 600; font-size: 0.92rem; }
  .gcl-desc { color: var(--ink-faint); font-size: 0.8rem; line-height: 1.4; }
  .group-card-list li a:hover .gcl-title { color: var(--steel); }

  /* ---------- Module sections ---------- */
  .module { padding-top: 56px; border-top: 1px solid var(--line); margin-top: 8px; }
  .module:first-of-type { border-top: none; }
  .module-head { margin-bottom: 28px; }
  .module-kicker { font-size: 0.74rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--signal); margin: 0 0 8px; }
  .module-head h1 { font-family: var(--serif); font-size: clamp(1.7rem, 3vw, 2.15rem); letter-spacing: -0.01em; margin: 0 0 12px; text-wrap: balance; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { font-size: 0.72rem; font-weight: 600; padding: 3px 9px; border-radius: 999px; background: var(--steel-tint); color: var(--steel-ink); }

  .module-body h2 { font-family: var(--serif); font-size: 1.4rem; letter-spacing: -0.005em; margin: 40px 0 14px; text-wrap: balance; scroll-margin-top: 72px; }
  .module-body h3 { font-family: var(--serif); font-size: 1.12rem; margin: 26px 0 10px; scroll-margin-top: 72px; }
  .module-body p { margin: 0 0 14px; color: var(--ink); }
  .module-body ul, .module-body ol { margin: 0 0 14px; padding-left: 1.35em; }
  .module-body li { margin-bottom: 6px; }
  .module-body li > ol, .module-body li > ul { margin-top: 6px; }
  .module-body strong { font-weight: 650; }
  .module-body code { font-family: var(--mono); font-size: 0.86em; background: var(--code-bg); padding: 0.12em 0.4em; border-radius: 4px; }
  .module-body hr { border: none; border-top: 1px solid var(--line); margin: 32px 0; }
  .module-body blockquote { margin: 0 0 14px; padding: 4px 16px; border-left: 3px solid var(--line-strong); color: var(--ink-soft); }

  h2 .anchor, h3 .anchor {
    text-decoration: none; color: var(--ink-faint); font-weight: 400; margin-right: 8px; opacity: 0;
    transition: opacity 0.1s ease; font-family: var(--sans); font-size: 0.82em; vertical-align: middle;
  }
  h2:hover .anchor, h3:hover .anchor, h2:focus-within .anchor, h3:focus-within .anchor { opacity: 1; }

  .table-scroll { overflow-x: auto; margin: 0 0 20px; border: 1px solid var(--line); border-radius: 10px; }
  table { border-collapse: collapse; width: 100%; font-size: 0.88rem; }
  th, td { text-align: left; padding: 9px 13px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { background: var(--surface-2); font-weight: 650; white-space: nowrap; color: var(--ink-soft); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.03em; }
  tbody tr:last-child td { border-bottom: none; }
  td { font-variant-numeric: tabular-nums; }

  .glance {
    background: var(--surface-2); border: 1px solid var(--line); border-radius: 12px;
    padding: 16px 20px 18px; margin: 0 0 32px;
  }
  .glance-kicker { margin: 0 0 8px; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-faint); }
  .glance ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
  .glance li { margin: 0; font-size: 0.92rem; }
  .glance li strong { color: var(--ink); }

  .callout { display: flex; gap: 12px; border-radius: 10px; padding: 13px 16px; margin: 0 0 18px; }
  .callout-icon { flex: none; font-size: 1.05rem; line-height: 1.5; }
  .callout-label { margin: 0 0 2px; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
  .callout-body p:last-child { margin-bottom: 0; }
  .callout-tip { background: var(--tip-tint); }
  .callout-tip .callout-label { color: var(--tip-ink); }
  .callout-note { background: var(--note-tint); }
  .callout-note .callout-label { color: var(--note-ink); }
  .callout-important { background: var(--signal-tint); }
  .callout-important .callout-label { color: var(--signal); }

  .back-to-top-inline { display: inline-block; margin-top: 30px; font-size: 0.82rem; color: var(--ink-faint); text-decoration: none; }
  .back-to-top-inline:hover { color: var(--steel); }

  .fab-top {
    position: fixed; right: 22px; bottom: 22px; z-index: 30;
    width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--line-strong);
    background: var(--surface); color: var(--ink-soft); box-shadow: var(--shadow);
    display: flex; align-items: center; justify-content: center; cursor: pointer;
    opacity: 0; pointer-events: none; transition: opacity 0.15s ease, transform 0.15s ease;
  }
  .fab-top.show { opacity: 1; pointer-events: auto; }
  .fab-top:hover { transform: translateY(-2px); color: var(--steel); }

  footer.guide-footer { border-top: 1px solid var(--line); margin-top: 64px; padding: 28px 0 0; color: var(--ink-faint); font-size: 0.8rem; }

  @media (max-width: 900px) {
    .menu-btn {
      display: flex; align-items: center; justify-content: center; width: 34px; height: 34px;
      border-radius: 7px; border: 1px solid var(--line-strong); background: var(--surface); color: var(--ink-soft); cursor: pointer;
    }
    .sidebar {
      position: fixed; top: 56px; left: 0; height: calc(100vh - 56px); width: 280px;
      transform: translateX(-100%); transition: transform 0.18s ease; z-index: 35; box-shadow: var(--shadow);
    }
    .sidebar.open { transform: translateX(0); }
    .scrim { position: fixed; inset: 56px 0 0 0; background: rgba(10,12,16,0.35); z-index: 34; display: none; }
    .scrim.show { display: block; }
    .topbar-search { max-width: none; }
    .print-btn span.label { display: none; }
  }

  @media print {
    .topbar, .sidebar, .fab-top, .scrim, .back-to-top-inline, .print-btn { display: none !important; }
    .shell { display: block; }
    .content { display: block; }
    .content-inner { max-width: none; padding: 0; }
    body { background: #fff; color: #000; font-size: 11.5pt; }
    .landing { padding: 0 0 24px; }
    .module { break-before: page; padding-top: 0; border-top: none; }
    .module:first-of-type { break-before: auto; }
    a { color: inherit; text-decoration: none; }
    .glance, .callout { border: 1px solid #ccc; background: #f7f7f7 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .chip { border: 1px solid #999; background: none !important; color: #000; }
  }
</style>

<a id="top"></a>
<div class="scrim" id="scrim"></div>

<header class="topbar">
  <button class="menu-btn" id="menuBtn" aria-label="Toggle navigation" aria-expanded="false">
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
  </button>
  <a class="brand" href="#top"><span>Forson Business Suite</span><span class="sub">User Guide</span></a>
  <div class="topbar-search">
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="6" cy="6" r="4.6" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M9.6 9.6L13 13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
    <input type="text" id="searchInput" placeholder="Search the guide&hellip;" autocomplete="off" aria-label="Search the guide" />
    <div class="search-results" id="searchResults"></div>
  </div>
  <button class="print-btn" id="printBtn" title="Print or save this guide as PDF"><span class="label">Print / Save PDF</span></button>
</header>

<div class="shell">
  <nav class="sidebar" id="sidebar" aria-label="Guide navigation">
    <a class="home-link" href="#top">&larr; Guide Home</a>
    ${navHtml}
  </nav>

  <main class="content">
    <div class="content-inner">

      <section class="landing" id="guide-home">
        <p class="eyebrow">Employee Reference &middot; All Departments</p>
        <h1>Everything you need to run the counter, the back office, and the books.</h1>
        <p class="deck">One reference for every screen in Forson Business Suite &mdash; written for the person doing the job, not the person who built the software. Pick a department below, or search for a task at the top of the page.</p>
        <div class="meta-row">
          <span><strong>${modules.length}</strong> modules</span>
          <span>Last verified <strong>${buildDate}</strong></span>
          <span>New here? Start with <a href="#getting-started">Getting Started</a></span>
        </div>
        <div class="group-grid">
          ${landingHtml}
        </div>
      </section>

      ${sectionsHtml}

      <footer class="guide-footer">
        <p>Forson Business Suite User Guide &middot; compiled ${buildDate} from the module manuals maintained in <code>docs/manuals/</code>. Found something out of date? Flag it to your system administrator.</p>
      </footer>

    </div>
  </main>
</div>

<button class="fab-top" id="fabTop" aria-label="Back to top">
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 12.5V3.5M3.5 8L8 3.5L12.5 8" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
</button>

<script>
  var SEARCH_INDEX = ${JSON.stringify(searchIndex)};

  // Sidebar collapse toggles
  document.querySelectorAll('.nav-group-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var group = btn.closest('.nav-group');
      var collapsed = group.classList.toggle('collapsed');
      btn.setAttribute('aria-expanded', String(!collapsed));
    });
  });

  // Mobile sidebar
  var sidebar = document.getElementById('sidebar');
  var menuBtn = document.getElementById('menuBtn');
  var scrim = document.getElementById('scrim');
  function closeSidebar() { sidebar.classList.remove('open'); scrim.classList.remove('show'); menuBtn.setAttribute('aria-expanded', 'false'); }
  function openSidebar() { sidebar.classList.add('open'); scrim.classList.add('show'); menuBtn.setAttribute('aria-expanded', 'true'); }
  menuBtn.addEventListener('click', function () { sidebar.classList.contains('open') ? closeSidebar() : openSidebar(); });
  scrim.addEventListener('click', closeSidebar);
  sidebar.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', closeSidebar); });

  // Print
  document.getElementById('printBtn').addEventListener('click', function () { window.print(); });

  // Back to top FAB
  var fab = document.getElementById('fabTop');
  window.addEventListener('scroll', function () {
    fab.classList.toggle('show', window.scrollY > 600);
  }, { passive: true });
  fab.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });

  // Scroll-spy: highlight active module in sidebar
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('.nav-list a'));
  var sections = Array.prototype.slice.call(document.querySelectorAll('.module'));
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var id = entry.target.id;
        navLinks.forEach(function (a) { a.classList.toggle('active', a.dataset.target === id); });
      });
    }, { rootMargin: '-15% 0px -70% 0px', threshold: 0 });
    sections.forEach(function (s) { io.observe(s); });
  }

  // Search
  var input = document.getElementById('searchInput');
  var results = document.getElementById('searchResults');
  function renderResults(q) {
    q = q.trim().toLowerCase();
    if (!q) { results.classList.remove('open'); results.innerHTML = ''; return; }
    var matches = SEARCH_INDEX.filter(function (item) {
      return item.title.toLowerCase().indexOf(q) !== -1 || (item.text && item.text.toLowerCase().indexOf(q) !== -1);
    }).slice(0, 18);
    if (!matches.length) {
      results.innerHTML = '<div class="search-empty">No matches for &ldquo;' + q.replace(/</g, '') + '&rdquo;</div>';
    } else {
      results.innerHTML = matches.map(function (m) {
        var href = '#' + (m.anchor || m.slug);
        var kind = m.kind === 'module' ? 'Module' : 'Section';
        return '<a href="' + href + '"><span class="sr-kind">' + kind + '</span>' + m.title.replace(/</g, '') + '</a>';
      }).join('');
    }
    results.classList.add('open');
  }
  input.addEventListener('input', function () { renderResults(input.value); });
  input.addEventListener('focus', function () { if (input.value) renderResults(input.value); });
  results.addEventListener('click', function () { results.classList.remove('open'); input.blur(); });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.topbar-search')) results.classList.remove('open');
  });
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); input.focus(); }
    if (e.key === 'Escape') { results.classList.remove('open'); input.blur(); }
  });
</script>
`;

fs.writeFileSync(OUT, html);
console.log('Wrote', OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB');
