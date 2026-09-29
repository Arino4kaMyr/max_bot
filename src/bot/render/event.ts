/**
 * Карточка события.
 *
 * Текст не пишется вручную — он собирается из фактов. Поэтому карточка
 * всегда согласована с данными, а данные всегда подписаны источником.
 */

import { STATUS_ICON, VERDICT_LABEL, type MatchResult } from '../../domain/matching.js';
import { trustLabel, type Fact } from '../../domain/trust.js';
import type { EventRow } from '../../data/repos.js';
import { formatEventDate } from '../../services/time.js';

const CATEGORY_ICON: Record<string, string> = {
  exhibition: '🖼',
  theater: '🎭',
  concert: '🎵',
  festival: '🎪',
  education: '📚',
  entertainment: '🎉',
  kids: '🧸',
  tour: '🚶',
  photo: '📷',
  party: '🪩',
  cinema: '🎬',
};

export function renderEvent(event: EventRow, match: MatchResult, tz: string): string {
  const icon = CATEGORY_ICON[event.category ?? ''] ?? '📌';
  const lines: string[] = [];

  lines.push(`${icon} ${event.title}`);
  if (event.venueName) {
    lines.push(`📍 ${event.venueName}${event.venueAddress ? `, ${event.venueAddress}` : ''}`);
  }
  lines.push(`📅 ${formatEventDate(event.startsAt, tz, event.isPermanent)}${priceLine(event)}`);
  lines.push('');

  const shown = match.lines.filter((l) => l.level !== 'nice' || l.status !== 'unknown');
  if (shown.length === 0) {
    lines.push('Профиль не задан — показываю всё подряд.');
  } else {
    for (const line of shown) {
      const note = line.note ? ` — ${line.note}` : '';
      const weak = line.weak ? ' (со слов посетителя)' : '';
      lines.push(`${STATUS_ICON[line.status]} ${line.label}${note}${weak}`);
    }
  }

  lines.push('');
  lines.push(sourceLine(match));

  return lines.join('\n');
}

function priceLine(event: EventRow): string {
  if (event.isFree) return ' · бесплатно';
  return event.price ? ` · ${event.price}` : '';
}

/** Подпись по самому слабому из значимых фактов — не приукрашиваем. */
function sourceLine(match: MatchResult): string {
  const relevant = match.lines
    .filter((l) => l.level !== 'nice' && l.status !== 'unknown')
    .map((l) => l.fact);

  if (relevant.length === 0) return 'Данных о доступности пока нет';
  const weakest = relevant.reduce((worst, fact) => (worst ? pickWeaker(worst, fact) : fact), relevant[0]);
  return trustLabel(weakest);
}

function pickWeaker(a: Fact | undefined, b: Fact | undefined): Fact | undefined {
  if (!a) return a;
  if (!b) return b;
  const score = (f: Fact) =>
    f.disagree > 0 ? 0 : f.source === 'user' ? (f.agree >= 2 ? 3 : 1) : f.source === 'demo' ? 2 : 4;
  return score(a) <= score(b) ? a : b;
}

export function verdictHeader(match: MatchResult, count: number): string {
  return `${VERDICT_LABEL[match.verdict]} · ${count}`;
}
