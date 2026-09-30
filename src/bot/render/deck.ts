/**
 * Колода карточек: одна карточка в чате, листается на месте.
 *
 * Лента мессенджера — плохое место для выдачи: пять сообщений подряд
 * невозможно сравнить, а сверху они уезжают. Одна карточка с навигацией
 * ведёт себя как стопка, которую перебираешь.
 */

import { Keyboard } from '@maxhub/max-bot-api';
import type { Verdict } from '../../domain/matching.js';
import type { Recommendation } from '../../services/recommend.js';
import type { Row } from '../keyboards.js';
import { renderEvent } from './event.js';

const { callback, link } = Keyboard.button;

export interface DeckState {
  /** Идентификаторы событий текущего набора. */
  ids: number[];
  /** Позиция в наборе. */
  index: number;
  /** Какой набор открыт. */
  bucket: Verdict;
  /** Размеры остальных наборов — для подписи кнопок переключения. */
  counts: Partial<Record<Verdict, number>>;
}

const BUCKET_TAB: Record<Verdict, string> = {
  fits: '✅ Подходят',
  partial: '⚠️ С оговорками',
  unknown: '❓ Без данных',
  unfit: '❌ Не подходят',
};

export function renderCard(item: Recommendation, state: DeckState, tz: string): string {
  const position = `${state.index + 1} из ${state.ids.length}`;
  const header = `${BUCKET_TAB[state.bucket]} · ${position}`;
  return `${header}\n\n${renderEvent(item.event, item.match, tz)}`;
}

export function deckKeyboard(item: Recommendation, state: DeckState): Row[] {
  const rows: Row[] = [];
  const { index, ids } = state;

  // Навигация показывается, только когда есть что листать.
  if (ids.length > 1) {
    rows.push([
      callback('◀️', index > 0 ? 'deck:prev' : 'deck:edge'),
      callback(`${index + 1}/${ids.length}`, 'deck:noop'),
      callback('▶️', index < ids.length - 1 ? 'deck:next' : 'deck:edge'),
    ]);
  }

  const actions: Row = [];
  if (item.event.lat != null && item.event.lon != null) {
    actions.push(
      link('🗺 Как добраться', `https://yandex.ru/maps/?rtext=~${item.event.lat}%2C${item.event.lon}&rtt=mt`),
    );
  }
  actions.push(callback('✅ Я пойду', `go:${item.event.id}`));
  rows.push(actions);

  if (state.bucket === 'unknown' && item.event.venueId != null) {
    rows.push([callback('🔍 Запросить проверку', `req:${item.event.venueId}`)]);
  }

  // Переключение наборов — теми же кнопками, что и раньше, но без новых сообщений.
  const tabs: Row = [];
  for (const bucket of ['fits', 'partial', 'unknown', 'unfit'] as Verdict[]) {
    const count = state.counts[bucket] ?? 0;
    if (count === 0 || bucket === state.bucket) continue;
    tabs.push(callback(`${BUCKET_TAB[bucket]} ${count}`, `deck:tab:${bucket}`));
  }
  for (let i = 0; i < tabs.length; i += 2) rows.push(tabs.slice(i, i + 2));

  rows.push([callback('🔎 Другой период', 'find:menu'), callback('🏠 В начало', 'menu')]);
  return rows;
}
