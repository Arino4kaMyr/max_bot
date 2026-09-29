import { Keyboard } from '@maxhub/max-bot-api';
import type { Button } from '@maxhub/max-bot-api/types';
import type { Period } from '../services/time.js';
import { PERIOD_LABEL } from '../services/time.js';
import { SITUATION_DEFS, SITUATIONS, type Situation } from '../domain/profile.js';

const { callback, link } = Keyboard.button;

export type Row = Button[];

export function kb(rows: Row[]) {
  return { attachments: [Keyboard.inlineKeyboard(rows)] };
}

/** Каждый экран имеет выход — тупиков в сценарии быть не должно. */
export const HOME_ROW: Row = [callback('🏠 В начало', 'menu')];

export function mainMenu(hasProfile: boolean): Row[] {
  return [
    [callback('🔎 Подобрать, куда сходить', hasProfile ? 'find:menu' : 'onb:start')],
    [callback('✍️ Помочь с данными о доступности', 'con:start')],
    hasProfile
      ? [callback('⚙️ Мой профиль', 'onb:start')]
      : [callback('👥 Идём компанией', 'grp:start')],
  ];
}

export function situationRows(selected: Situation[], prefix: 'onb' | 'grp'): Row[] {
  const rows: Row[] = SITUATIONS.map((id) => [
    callback(
      `${selected.includes(id) ? '☑️' : '▫️'} ${SITUATION_DEFS[id].label}`,
      `${prefix}:sit:${id}`,
    ),
  ]);
  rows.push([callback(selected.length ? '✅ Готово' : '➡️ Пропустить', `${prefix}:done`)]);
  return rows;
}

export function periodRows(): Row[] {
  const periods: Period[] = ['today', 'weekend', 'week'];
  return [
    periods.map((p) => callback(PERIOD_LABEL[p], `find:${p}`)),
    [callback('🎚 Фильтры', 'filter:menu')],
    HOME_ROW,
  ];
}

export function eventRow(eventId: number, lat: number | null, lon: number | null): Row {
  const row: Row = [];
  if (lat != null && lon != null) {
    row.push(link('🗺 Как добраться', `https://yandex.ru/maps/?rtext=~${lat}%2C${lon}&rtt=mt`));
  }
  row.push(callback('✅ Я пойду', `go:${eventId}`));
  return row;
}

export function yesNoRow(prefix: string): Row {
  return [callback('Да', `${prefix}:yes`), callback('Нет', `${prefix}:no`)];
}
