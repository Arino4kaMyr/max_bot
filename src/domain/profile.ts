/**
 * Профиль пользователя: ситуация → набор требований.
 *
 * Сегмент определяется ситуацией, а не диагнозом. Человек нажимает кнопку,
 * узнавая в ней себя; раскладка в требования происходит здесь и нигде больше.
 */

import type { FeatureKey } from './features.js';

export const SITUATIONS = [
  'wheelchair',
  'stairs_hard',
  'stroller',
  'temporary',
  'vision',
  'hearing',
  'companion',
] as const;

export type Situation = (typeof SITUATIONS)[number];

export type RequirementLevel = 'critical' | 'important' | 'nice';

export interface Requirement {
  key: FeatureKey;
  level: RequirementLevel;
}

export interface SituationDef {
  id: Situation;
  /** Подпись на кнопке онбординга. */
  label: string;
  /** Короткое имя для состава группы. */
  short: string;
  requirements: Requirement[];
}

const LEVEL_ORDER: Record<RequirementLevel, number> = {
  critical: 3,
  important: 2,
  nice: 1,
};

export const SITUATION_DEFS: Record<Situation, SituationDef> = {
  wheelchair: {
    id: 'wheelchair',
    label: 'Передвигаюсь на коляске',
    short: 'коляска',
    requirements: [
      { key: 'entrance_step_free', level: 'critical' },
      { key: 'wc_accessible', level: 'critical' },
      { key: 'lift', level: 'important' },
      { key: 'wheelchair_seats', level: 'important' },
      { key: 'door_width_90', level: 'important' },
      { key: 'parking_disabled', level: 'nice' },
    ],
  },
  stairs_hard: {
    id: 'stairs_hard',
    label: 'Тяжело даются лестницы',
    short: 'тяжело по лестницам',
    requirements: [
      { key: 'entrance_step_free', level: 'important' },
      { key: 'ramp', level: 'important' },
      { key: 'lift', level: 'important' },
      { key: 'wc_accessible', level: 'nice' },
    ],
  },
  stroller: {
    id: 'stroller',
    label: 'Иду с детской коляской',
    short: 'детская коляска',
    requirements: [
      { key: 'entrance_step_free', level: 'important' },
      { key: 'ramp', level: 'important' },
      { key: 'lift', level: 'important' },
      { key: 'door_width_90', level: 'nice' },
    ],
  },
  temporary: {
    id: 'temporary',
    label: 'Временно ограничен — травма, после операции',
    short: 'временное ограничение',
    requirements: [
      { key: 'entrance_step_free', level: 'critical' },
      { key: 'lift', level: 'important' },
      { key: 'ramp', level: 'important' },
      { key: 'wc_accessible', level: 'important' },
    ],
  },
  vision: {
    id: 'vision',
    label: 'Важно зрение',
    short: 'зрение',
    requirements: [
      { key: 'audio_description', level: 'important' },
      { key: 'tactile_exhibits', level: 'important' },
      { key: 'braille', level: 'important' },
      { key: 'guide_dog_allowed', level: 'nice' },
    ],
  },
  hearing: {
    id: 'hearing',
    label: 'Важно слух',
    short: 'слух',
    requirements: [
      { key: 'sign_language', level: 'important' },
      { key: 'subtitles', level: 'important' },
      { key: 'induction_loop', level: 'nice' },
    ],
  },
  companion: {
    id: 'companion',
    label: 'Иду с сопровождающим',
    short: 'с сопровождающим',
    requirements: [{ key: 'companion_free', level: 'important' }],
  },
};

export function isSituation(value: string): value is Situation {
  return (SITUATIONS as readonly string[]).includes(value);
}

/**
 * Объединяет ситуации в единый набор требований.
 *
 * Та же функция обслуживает и одного человека с несколькими ситуациями,
 * и компанию: группа — это объединение ситуаций участников. При пересечении
 * выигрывает более строгий уровень, потому что компания идёт туда, куда
 * может попасть самый ограниченный участник.
 */
export function requirementsFor(situations: Situation[]): Requirement[] {
  const merged = new Map<FeatureKey, RequirementLevel>();

  for (const situation of situations) {
    for (const req of SITUATION_DEFS[situation].requirements) {
      const current = merged.get(req.key);
      if (!current || LEVEL_ORDER[req.level] > LEVEL_ORDER[current]) {
        merged.set(req.key, req.level);
      }
    }
  }

  return [...merged.entries()]
    .map(([key, level]) => ({ key, level }))
    .sort((a, b) => LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level]);
}

/** Признаки, критичные для профиля — их и спрашиваем при верификации. */
export function criticalKeys(situations: Situation[]): FeatureKey[] {
  return requirementsFor(situations)
    .filter((r) => r.level === 'critical')
    .map((r) => r.key);
}

export function describeGroup(members: Situation[][]): string {
  return members.map((m) => m.map((s) => SITUATION_DEFS[s].short).join(' + ')).join(', ');
}
