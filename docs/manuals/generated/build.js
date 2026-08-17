const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const MANUALS_DIR = '/home/dev-server/docker/forson-business-suite/docs/manuals';
const OUT_FILE = '/tmp/claude-1000/-home-dev-server-docker-forson-business-suite/d2bf9917-66eb-4aaa-8dba-0d63cec40745/scratchpad/guide-build/user-guide.html';

// Module order + grouping (mirrors INVENTORY.md's grouping of the business into working areas)
const GROUPS = [
  {
    id: 'front-office',
    label: 'Front Office',
    blurb: 'Where the day starts and where the money is taken.',
    files: ['getting_started_manual.md', 'point_of_sale_manual.md', 'sales_history_manual.md', 'invoicing_and_statements_manual.md', 'power_search_manual.md'],
  },
  {
    id: 'money',
    label: 'Money & Collections',
    blurb: 'Who owes you, who you owe, and how it gets paid.',
    files: ['accounts_receivable_manual.md', 'accounts_payable_manual.md', 'cheques_and_treasury_manual.md', 'expenses_manual.md'],
  },
  {
    id: 'stock',
    label: 'Inventory & Purchasing',
    blurb: 'What’s on the shelf, and how it gets there.',
    files: ['inventory_and_parts_manual.md', 'purchasing_and_goods_receipt_manual.md'],
  },
  {
    id: 'people',
    label: 'People',
    blurb: 'Staff records, schedules, and pay.',
    files: ['hr_workforce_manual.md', 'payroll_manual.md'],
  },
  {
    id: 'operations',
    label: 'Operations',
    blurb: 'Records and numbers that cut across every department.',
    files: ['documents_manual.md', 'reporting_manual.md'],
  },
  {
    id: 'system',
    label: 'System',
    blurb: 'Configuring the suite itself.',
    files: ['settings_and_setup_manual.md'],
  },
];

function slugify(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  m[1].split('\n').forEach((line) => {
    const idx = line.indexOf(':');
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    meta[key] = val;
  });
  return { meta, body: m[2] };
}

// Strip the leading HTML comment block (the "Follow docs/manuals/STANDARDS.md..." instructions)
function stripBuilderComment(body) {
  return body.replace(/<!--[\s\S]*?-->\n*/, '');
}

// Give every h2/h3 a stable id + anchor link
const renderer = new marked.Renderer();
const usedIds = new Set();
renderer.heading = function (token) {
  const text = this.parser.parseInline(token.tokens);
  const raw = token.text;
  const level = token.depth;
  let id = slugify(raw);
  let uniq = id, n = 2;
  while (usedIds.has(uniq)) { uniq = `${id}-${n++}`; }
  usedIds.add(uniq);
  const tag = `h${level}`;
  return `<${tag} id="${uniq}"><a class="anchor" href="#${uniq}" aria-label="Link to this section">#</a>${text}</${tag}>\n`;
};
renderer.blockquote = function (token) {
  const raw = token.text;
  const trimmed = raw.trim();
  if (/^\*\*At a Glance\*\*/.test(trimmed)) {
    const rest = raw.replace(/^\*\*At a Glance\*\*\n?/, '');
    return `<div class="glance"><p class="glance-kicker">At a Glance</p>${marked.parse(rest)}</div>\n`;
  }
  const m = trimmed.match(/^(💡|📝|⚠️)\s*/);
  if (m) {
    const cls = m[1] === '💡' ? 'tip' : m[1] === '📝' ? 'note' : 'important';
    const label = cls === 'tip' ? 'Tip' : cls === 'note' ? 'Note' : 'Important';
    let rest = raw.replace(/^\s*(💡|📝|⚠️)\s*/, '');
    rest = rest.replace(/^\*\*(Tip|Note|Important):?\*\*\s*[:—-]?\s*/i, '');
    rest = rest.replace(/^(Tip|Note|Important)\s*[:—-]\s*/i, '');
    return `<div class="callout callout-${cls}"><span class="callout-icon" aria-hidden="true">${m[1]}</span><div class="callout-body"><p class="callout-label">${label}</p>${marked.parse(rest)}</div></div>\n`;
  }
  return `<blockquote>${marked.parse(raw)}</blockquote>\n`;
};
renderer.table = function (token) {
  const header = `<tr>${token.header.map((c) => `<th>${this.parser.parseInline(c.tokens)}</th>`).join('')}</tr>`;
  const body = token.rows.map((row) => `<tr>${row.map((c) => `<td>${this.parser.parseInline(c.tokens)}</td>`).join('')}</tr>`).join('');
  return `<div class="table-scroll"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>\n`;
};

marked.setOptions({ renderer, gfm: true, breaks: false });

function extractGlanceBullet(html) {
  const m2 = html.match(/<li><strong>What it&#39;s for:<\/strong>\s*([\s\S]*?)<\/li>/i);
  if (m2) return m2[1].replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
  return '';
}

const files = fs.readdirSync(MANUALS_DIR).filter((f) => f.endsWith('_manual.md'));
const known = new Set(GROUPS.flatMap((g) => g.files));
const missing = files.filter((f) => !known.has(f));
if (missing.length) console.error('WARNING: ungrouped files found:', missing);

const modules = [];
for (const group of GROUPS) {
  for (const file of group.files) {
    const full = path.join(MANUALS_DIR, file);
    if (!fs.existsSync(full)) { console.error('MISSING FILE referenced in GROUPS:', file); continue; }
    const raw = fs.readFileSync(full, 'utf8');
    const { meta, body } = parseFrontmatter(raw);
    let cleanBody = stripBuilderComment(body);
    // Re-map ./xxx_manual.md links -> #xxx (in-page anchors)
    cleanBody = cleanBody.replace(/\]\(\.\/([a-zA-Z_]+)\.md\)/g, (m0, base) => `](#${slugify(base.replace(/_manual$/, ''))})`);
    usedIds.clear();
    const html = marked.parse(cleanBody);
    const titleMatch = cleanBody.match(/^#\s+(.+)$/m);
    const title = (titleMatch ? titleMatch[1] : meta.module || file).trim();
    const bodyNoH1 = html.replace(/^<h1[^>]*>[\s\S]*?<\/h1>\n?/, '');
    const glance = extractGlanceBullet(bodyNoH1);
    modules.push({
      slug: slugify(title.replace(/&/g, 'and')),
      title,
      group: group.id,
      audience: meta.audience || '',
      html: bodyNoH1,
      glance,
    });
  }
}

fs.writeFileSync(path.join(__dirname, 'modules.json'), JSON.stringify(modules.map(m => ({slug: m.slug, title: m.title, group: m.group, audience: m.audience, glance: m.glance})), null, 2));
console.log(`Parsed ${modules.length} modules.`);
modules.forEach(m => console.log(' -', m.group, '/', m.slug, '::', m.title, '::', m.audience));

fs.writeFileSync(path.join(__dirname, '_modules_full.json'), JSON.stringify(modules));
