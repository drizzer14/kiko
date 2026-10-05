#!/usr/bin/env node
// Privacy-policy site tool. Dependency-free, run by hand; no check:* gate calls it
// (the `check` mode touches the network, which no gate may do).
//
//   node scripts/privacy-site.js build [outDir]   docs/privacy-policy*.md -> index.html + en.html
//   node scripts/privacy-site.js check [url]      md date + hosts vs the live page vs the hosts in src/
//
// Exit 0 = in sync, 1 = drift (the release must publish the page first), 2 = usage/fetch error.

const fs = require('node:fs');
const path = require('node:path');

function out(line) {
  process.stdout.write(`${line}\n`);
}

function fail(line) {
  process.stderr.write(`${line}\n`);
}

const ROOT = path.resolve(__dirname, '..');
const LIVE_URL = 'https://drizzer14.github.io/kiko';

// Hosts that appear in src/ only as documentation links or comments, never as a request.
const NON_REQUEST_HOSTS = [
  'www.w3.org',
  'developer.apple.com',
  'developers.binance.com',
  'app.binance.com',
  'raw.githubusercontent.com',
  'drizzer14.github.io',
];

const PAGES = [
  {
    md: 'docs/privacy-policy.md',
    out: 'index.html',
    lang: 'uk',
    title: 'Кіко — Політика конфіденційності',
    other: './en.html',
    otherLabel: 'English',
  },
  {
    md: 'docs/privacy-policy.en.md',
    out: 'en.html',
    lang: 'en',
    title: 'Kiko — Privacy Policy',
    other: './index.html',
    otherLabel: 'Українською',
  },
];

const STYLE = `<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 2rem 1.25rem 4rem;
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1a1a1a; background: #ffffff;
    max-width: 46rem; margin-inline: auto;
  }
  h1 { font-size: 1.9rem; line-height: 1.2; margin: 0 0 .25rem; }
  h2 { font-size: 1.2rem; margin: 2rem 0 .5rem; }
  .eff { color: #666; margin: 0 0 1.5rem; }
  .lang { font-size: .95rem; margin: 0 0 1.5rem; }
  .lead { background: #f4f6f8; border-radius: 10px; padding: .9rem 1.1rem; }
  code { background: #f0f0f0; padding: .1em .35em; border-radius: 4px; font-size: .9em; }
  ul { padding-left: 1.25rem; }
  li { margin: .3rem 0; }
  a { color: #0b6bcb; }
  @media (prefers-color-scheme: dark) {
    body { color: #e6e6e6; background: #161616; }
    .eff { color: #9a9a9a; }
    .lead { background: #232323; }
    code { background: #2a2a2a; }
    a { color: #6db3f2; }
  }
</style>`;

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(>])([\w.-]+@[\w.-]+\.\w+)/g, '$1<a href="mailto:$2">$2</a>');
}

function paragraph(text) {
  if (/^\*\*(Effective date|Дата набрання чинності):\*\*/.test(text))
    return `<p class="eff">${inline(text)}</p>`;
  if (
    /^\*\*(Short version|Коротко|Kiko is an independent app|Кіко — незалежний застосунок)/.test(
      text,
    )
  ) {
    return `<p class="lead">${inline(text)}</p>`;
  }
  return `<p>${inline(text)}</p>`;
}

function languageLine(page) {
  const label = `<a href="${page.other}">${page.otherLabel}</a>`;
  if (page.lang === 'en') return `<p class="lang">🇺🇦 ${label} · 🇬🇧 English</p>`;
  return `<p class="lang">🇺🇦 Українською · 🇬🇧 ${label}</p>`;
}

function list(block) {
  const items = block.split(/\n(?=- )/).map((item) => item.slice(2).replace(/\n\s*/g, ' '));
  return `<ul>\n${items.map((item) => `    <li>${inline(item)}</li>`).join('\n')}\n  </ul>`;
}

// Markdown subset the two policy files use: # / ## headings, a `>` language line, paragraphs, `- ` lists.
function blockToHtml(block, page) {
  if (block.startsWith('> ')) return languageLine(page);
  if (block.startsWith('# ')) return `<h1>${inline(block.slice(2))}</h1>`;
  if (block.startsWith('## ')) return `<h2>${inline(block.slice(3))}</h2>`;
  if (block.startsWith('- ')) return list(block);
  return paragraph(block.replace(/\n/g, ' '));
}

function convert(markdown, page) {
  const blocks = markdown
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  // The live layout puts the language line above the title, the markdown puts it below.
  const lang = blocks.findIndex((block) => block.startsWith('> '));
  const ordered = [blocks[lang], ...blocks.filter((_, index) => index !== lang)];
  const body = ordered.map((block) => blockToHtml(block, page));

  return `<!doctype html>
<html lang="${page.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.title}</title>
${STYLE}
</head>
<body>
  ${body.join('\n\n  ')}
</body>
</html>
`;
}

function build(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const page of PAGES) {
    const markdown = fs.readFileSync(path.join(ROOT, page.md), 'utf8');
    fs.writeFileSync(path.join(outDir, page.out), convert(markdown, page));
    out(`wrote ${path.join(outDir, page.out)}`);
  }
}

function hostsIn(text) {
  return new Set(
    [...text.matchAll(/<code>([a-z0-9.-]+\.[a-z]+)<\/code>|`([a-z0-9.-]+\.[a-z]+)`/g)].map(
      (match) => match[1] || match[2],
    ),
  );
}

function dateIn(text) {
  const match = text.match(
    /(?:Effective date|Дата набрання чинності):(?:\*\*|<\/strong>)\s*([^<\n]+)/,
  );
  return match ? match[1].trim() : null;
}

function codeHosts() {
  const found = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) {
        for (const match of fs.readFileSync(full, 'utf8').matchAll(/https:\/\/([a-z0-9.-]+)/g))
          found.add(match[1]);
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  return [...found].filter((host) => !NON_REQUEST_HOSTS.includes(host));
}

async function fetchLive(url) {
  const response = await fetch(url);
  if (!response.ok) {
    fail(`cannot fetch ${url}: HTTP ${response.status}`);
    process.exit(2);
  }
  return response.text();
}

function drift(page, markdown, live, code) {
  const mdHosts = hostsIn(markdown);
  const liveHosts = hostsIn(live);
  const tag = page.lang;
  out(`${tag}: md date "${dateIn(markdown)}", live date "${dateIn(live)}"`);
  return [
    ...(dateIn(markdown) === dateIn(live) ? [] : [`${tag}: effective date differs (md vs live)`]),
    ...[...mdHosts]
      .filter((host) => !liveHosts.has(host))
      .map((host) => `${tag}: md names ${host}, live page does not`),
    ...[...liveHosts]
      .filter((host) => !mdHosts.has(host))
      .map((host) => `${tag}: live page names ${host}, md does not`),
    ...code
      .filter((host) => !mdHosts.has(host))
      .map((host) => `${tag}: src/ contacts ${host}, md does not name it`),
  ];
}

async function check(url) {
  const code = codeHosts();
  const problems = [];

  for (const page of PAGES) {
    const markdown = fs.readFileSync(path.join(ROOT, page.md), 'utf8');
    const live = await fetchLive(`${url}/${page.lang === 'en' ? 'en.html' : ''}`);
    problems.push(...drift(page, markdown, live, code));
  }

  if (problems.length === 0) {
    out('privacy policy: md, live page and code hosts agree');
    return;
  }
  for (const problem of problems) fail(`DRIFT ${problem}`);
  process.exit(1);
}

const [mode, argument] = process.argv.slice(2);
if (mode === 'build') build(path.resolve(argument || path.join(ROOT, 'docs/privacy-site')));
else if (mode === 'check')
  check((argument || LIVE_URL).replace(/\/$/, '')).catch((failure) => {
    fail(failure.message);
    process.exit(2);
  });
else {
  fail('usage: node scripts/privacy-site.js build [outDir] | check [url]');
  process.exit(2);
}
