import { readFile } from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';

const ROOT = path.resolve(import.meta.dirname, '..');
const WEEKDAYS = 'SUNDAY|MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY';

function normalise(value) {
  return value
    .replace(/\r/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '–')
    .replace(/\uFFFD/g, '')
    // Word tables sometimes merge adjacent cells in Mammoth's raw text output.
    .replace(/(Topic:[^\n]*?)(?=Frontier Focus:)/gi, '$1\n')
    .replace(/(Frontier Focus:[^\n]*?)(?=(?:Scripture Reflection|Scripture References|Biblical Examples|Five Reference Scriptures|Testimonies|Strategic Prayers|Personal Prayer|Proclamation|Pray|Prayer|Mission Response|Mission Action|Reflection)\b)/gi, '$1\n')
    .trim();
}

function titleFromLines(lines, dateMatch) {
  const inline = normalise(dateMatch[2] || '');
  if (inline && !/^\d/.test(inline)) return inline;
  return normalise(lines.find((line) =>
    line &&
    !/^(Topic|Frontier Focus|Scripture Reflection|Scripture References|Biblical Examples|Five Reference Scriptures|Testimonies|Strategic Prayers|Personal Prayer|Proclamation|Pray|Prayer|Mission Response|Mission Action|Reflection)\b/i.test(line)
  ) || 'Daily devotional');
}

function dateMatcher(monthName, year) {
  return new RegExp(
    `^(?:${WEEKDAYS})?\\s*,?\\s*${monthName}\\s+(\\d{1,2})(?:\\s*,?\\s*${year})?\\s*(?:[–—-]\\s*(.*))?$`,
    'i'
  );
}

function isRangeHeading(line, match) {
  return new RegExp(`^${match[0].split(/\s+/)[0]}\\s+\\d+\\s*[–—-]\\s*\\d+`, 'i').test(line)
    || normalise(match[2] || '').toLowerCase().includes('september');
}

export function monthSlug(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function dayKey(year, month, day) {
  return `${monthSlug(year, month)}-${String(day).padStart(2, '0')}`;
}

export async function loadJournal() {
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'content', 'months.json'), 'utf8'));
  const months = [];

  for (const definition of manifest) {
    const source = path.join(ROOT, definition.source);
    const { value } = await mammoth.extractRawText({ path: source });
    const rawLines = value.split('\n').map(normalise);
    const endAt = definition.dailyEndAt
      ? rawLines.findIndex((line) => line.toUpperCase() === definition.dailyEndAt.toUpperCase())
      : -1;
    const lines = endAt >= 0 ? rawLines.slice(0, endAt) : rawLines;
    const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' })
      .format(new Date(Date.UTC(definition.year, definition.month - 1, 1)));
    const matchDate = dateMatcher(monthName, definition.year);
    const starts = [];

    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(matchDate);
      if (match && !isRangeHeading(lines[index], match)) starts.push({ index, match });
    }

    const expectedDays = new Date(Date.UTC(definition.year, definition.month, 0)).getUTCDate();
    const days = starts.map((start, position) => {
      const end = starts[position + 1]?.index ?? lines.length;
      const segment = lines.slice(start.index, end).filter(Boolean);
      const day = Number(start.match[1]);
      const heading = segment.shift();
      const title = titleFromLines(segment, start.match);
      if (segment[0] === title) segment.shift();
      const date = new Date(Date.UTC(definition.year, definition.month - 1, day));
      const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(date);
      const displayDate = `${weekday}, ${monthName} ${day}, ${definition.year}`;
      const messageLines = [
        `*${definition.title.toUpperCase()}*`,
        '',
        `*${displayDate.toUpperCase()}*`,
        '',
        `*${title}*`,
        '',
        ...segment
      ];
      return {
        key: dayKey(definition.year, definition.month, day),
        day,
        date: displayDate,
        title,
        sourceHeading: heading,
        blocks: segment,
        messageText: messageLines.join('\n').trim()
      };
    });

    const seen = new Set(days.map((day) => day.day));
    const expected = Array.from({ length: expectedDays }, (_, index) => index + 1);
    const missing = expected.filter((day) => !seen.has(day));
    const duplicateCount = days.length - seen.size;
    if (missing.length || duplicateCount) {
      throw new Error(`${definition.source}: expected ${expectedDays} unique daily headings; missing ${missing.join(', ') || 'none'}, duplicates ${duplicateCount}.`);
    }

    months.push({
      ...definition,
      slug: monthSlug(definition.year, definition.month),
      monthName,
      intro: lines.slice(0, starts[0].index).filter(Boolean),
      days: days.sort((a, b) => a.day - b.day)
    });
  }

  return { months };
}
