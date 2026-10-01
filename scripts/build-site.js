import { mkdir, rm, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { loadJournal } from './content.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'dist');
const CHECK_ONLY = process.argv.includes('--check');
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.URL || '').replace(/\/$/, '');

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const pagePath = (slug, day) => `/${slug}/${String(day).padStart(2, '0')}/`;
const canonical = (pathname) => `${PUBLIC_BASE_URL}${pathname}`;

function page({ title, description, canonicalPath, body }) {
  const url = canonical(canonicalPath);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${url}"><meta property="og:type" content="website"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${url}"><meta name="twitter:card" content="summary"><link rel="stylesheet" href="/assets/site.css"></head><body><header><a class="brand" href="/">Strategic Prayer Journal</a><p>Daily prayer and devotional journey</p></header><main>${body}</main><footer>Share hope. Pray with purpose.</footer><script src="/assets/share.js" defer></script></body></html>`;
}

function nav(month, currentDay) {
  return `<nav aria-label="Journal navigation"><a href="/${month.slug}/">${escapeHtml(month.monthName)} ${month.year}</a>${currentDay ? `<span>Day ${currentDay.day}</span>` : ''}</nav>`;
}

function blockHtml(value) {
  const heading = value.length < 80 && (/^[A-Z][A-Za-z ]+:?$/.test(value) || /^[A-Z][A-Z &–-]+$/.test(value));
  return heading ? `<h2>${escapeHtml(value.replace(/:$/, ''))}</h2>` : `<p>${escapeHtml(value)}</p>`;
}

function whatsappBlock(value) {
  const match = value.match(/^(Five Scripture References|Scripture References|Biblical Reflection|Ancient Examples|Strategic Prayer|Strategic Prayers|Proclamations|Personal Prayer|Prayer|Pray|Mission Action|Reflection):\s*(.*)$/i);
  return match ? `*${match[1]}:*${match[2] ? ` ${match[2]}` : ''}` : value;
}

function whatsappMessage(month, day, dailyUrl) {
  return [
    dailyUrl,
    '',
    `*🔰 STRATEGIC LEVEL PRAYER WARFARE, ${month.monthName.toUpperCase()} ${month.year}*`,
    '',
    `*${day.title}*`,
    '',
    `_${day.date}_`,
    '',
    day.blocks.map(whatsappBlock).join('\n\n')
  ].join('\n').trim();
}

async function writeSiteFile(relativePath, content) {
  const target = path.join(OUT, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

const journal = await loadJournal();
if (CHECK_ONLY) {
  console.log(`Content check passed: ${journal.months.map((month) => `${month.slug} (${month.days.length} days)`).join(', ')}`);
  process.exit(0);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(path.join(OUT, 'assets'), { recursive: true });
await copyFile(path.join(ROOT, 'site', 'site.css'), path.join(OUT, 'assets', 'site.css'));
await copyFile(path.join(ROOT, 'site', 'share.js'), path.join(OUT, 'assets', 'share.js'));
await writeFile(path.join(OUT, 'data.json'), JSON.stringify(journal, null, 2));

const monthCards = journal.months.map((month) => `<article class="card"><p class="eyebrow">${month.days.length}-day journal</p><h1>${escapeHtml(month.monthName)} ${month.year}</h1><p>${escapeHtml(month.subtitle)}</p><a class="button" href="/${month.slug}/">Open the journal</a></article>`).join('');
await writeSiteFile('index.html', page({ title: 'Strategic Prayer Journal', description: 'Read and share daily strategic prayer journals.', canonicalPath: '/', body: `<section class="hero"><p class="eyebrow">Prayer. Obedience. Mission.</p><h1>Strategic Prayer Journal</h1><p>Choose a month to read, pray, and share a daily devotional.</p></section><section class="cards">${monthCards}</section>` }));

for (const month of journal.months) {
  const dayCards = month.days.map((day) => `<li><a href="${pagePath(month.slug, day.day)}"><span>Day ${day.day}</span><strong>${escapeHtml(day.title)}</strong><small>${escapeHtml(day.date)}</small></a></li>`).join('');
  const intro = month.intro.slice(0, 5).map((line) => `<p>${escapeHtml(line)}</p>`).join('');
  const monthBody = `${nav(month)}<section class="hero"><p class="eyebrow">${month.days.length}-day journey</p><h1>${escapeHtml(month.title)}</h1><p>${escapeHtml(month.subtitle)}</p><button class="share button secondary" data-share-title="${escapeHtml(month.title)} — ${escapeHtml(month.monthName)} ${month.year}" data-share-url="${canonical(`/${month.slug}/`)}">Share this month</button></section><section class="intro"><h2>About this month</h2>${intro}<a href="/${escapeHtml(month.source)}" download>Download the original monthly journal</a></section><ol class="day-list">${dayCards}</ol>`;
  await writeSiteFile(`${month.slug}/index.html`, page({ title: `${month.monthName} ${month.year} | ${month.title}`, description: month.subtitle, canonicalPath: `/${month.slug}/`, body: monthBody }));
  await mkdir(path.dirname(path.join(OUT, month.source)), { recursive: true });
  await copyFile(path.join(ROOT, month.source), path.join(OUT, month.source));

  for (const day of month.days) {
    const dailyUrl = canonical(pagePath(month.slug, day.day));
    const shareText = whatsappMessage(month, day, dailyUrl);
    const body = `${nav(month, day)}<article class="devotional"><p class="eyebrow">Day ${day.day}</p><h1>${escapeHtml(day.title)}</h1><p class="date">${escapeHtml(day.date)}</p><div class="share-row"><button class="share button" data-share-channel="whatsapp" data-share-title="${escapeHtml(day.title)}" data-share-text="${escapeHtml(shareText)}" data-share-url="${dailyUrl}">Share on WhatsApp</button><button class="copy-link" data-copy-url="${dailyUrl}">Copy link</button></div><section class="reading">${day.blocks.map(blockHtml).join('')}</section></article>`;
    await writeSiteFile(`${month.slug}/${String(day.day).padStart(2, '0')}/index.html`, page({ title: `${day.title} | ${month.title}`, description: `${day.date}: ${day.title}`, canonicalPath: pagePath(month.slug, day.day), body }));
  }
}
console.log(`Built ${journal.months.length} month(s) into dist/.`);
