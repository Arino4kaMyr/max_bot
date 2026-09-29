/**
 * Словарь признаков доступности — ядро продукта.
 *
 * Не меняется при переносе в другой город: меняются только значения фактов
 * по конкретным площадкам. Живёт в коде, а не в базе, чтобы ключи нельзя
 * было рассинхронизировать и чтобы опечатки ловил компилятор.
 */

export const FEATURE_KEYS = [
  'entrance_step_free',
  'ramp',
  'door_width_90',
  'lift',
  'wc_accessible',
  'wheelchair_seats',
  'parking_disabled',
  'audio_description',
  'tactile_exhibits',
  'braille',
  'guide_dog_allowed',
  'sign_language',
  'induction_loop',
  'subtitles',
  'companion_free',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type FeatureValue = 'yes' | 'no' | 'partial' | 'unknown';

export type FeatureGroup = 'mobility' | 'vision' | 'hearing' | 'general';

/**
 * Вопрос посетителю без специальных знаний.
 *
 * Задаётся не для всех признаков: спрашивать у случайного человека про
 * индукционную петлю или ширину проёма бессмысленно — так собирается мусор.
 * Такие признаки заполняют команда и партнёрские организации.
 *
 * `yesMeans` нужен, потому что естественная формулировка вопроса часто
 * инвертирована: «нужно подниматься по ступенькам?» → «да» означает,
 * что вход НЕ без ступеней.
 */
export interface VisitorQuestion {
  question: string;
  yesMeans: FeatureValue;
  noMeans: FeatureValue;
}

export interface FeatureDef {
  key: FeatureKey;
  group: FeatureGroup;
  /** Подпись в карточке события. */
  label: string;
  /** Вопрос контрибьютору; отсутствует — значит признак экспертный. */
  visitor?: VisitorQuestion;
}

export const FEATURES: Record<FeatureKey, FeatureDef> = {
  entrance_step_free: {
    key: 'entrance_step_free',
    group: 'mobility',
    label: 'Вход без ступеней',
    visitor: {
      question: 'Чтобы войти, нужно подниматься по ступенькам?',
      yesMeans: 'no',
      noMeans: 'yes',
    },
  },
  ramp: {
    key: 'ramp',
    group: 'mobility',
    label: 'Пандус или пологий съезд',
    visitor: {
      question: 'Рядом с лестницей есть пандус или пологий съезд?',
      yesMeans: 'yes',
      noMeans: 'no',
    },
  },
  door_width_90: {
    key: 'door_width_90',
    group: 'mobility',
    label: 'Дверной проём от 90 см',
  },
  lift: {
    key: 'lift',
    group: 'mobility',
    label: 'Лифт на все этажи',
    visitor: {
      question: 'Есть лифт между этажами?',
      yesMeans: 'yes',
      noMeans: 'no',
    },
  },
  wc_accessible: {
    key: 'wc_accessible',
    group: 'mobility',
    label: 'Доступный туалет',
    visitor: {
      question: 'В туалете есть широкая кабина с поручнями?',
      yesMeans: 'yes',
      noMeans: 'no',
    },
  },
  wheelchair_seats: {
    key: 'wheelchair_seats',
    group: 'mobility',
    label: 'Места для колясок в зале',
  },
  parking_disabled: {
    key: 'parking_disabled',
    group: 'mobility',
    label: 'Парковка для инвалидов',
    visitor: {
      question: 'У входа есть размеченные места для машин инвалидов?',
      yesMeans: 'yes',
      noMeans: 'no',
    },
  },
  audio_description: {
    key: 'audio_description',
    group: 'vision',
    label: 'Тифлокомментирование',
  },
  tactile_exhibits: {
    key: 'tactile_exhibits',
    group: 'vision',
    label: 'Тактильные экспонаты',
  },
  braille: {
    key: 'braille',
    group: 'vision',
    label: 'Брайль или крупный шрифт',
  },
  guide_dog_allowed: {
    key: 'guide_dog_allowed',
    group: 'vision',
    label: 'Можно с собакой-проводником',
  },
  sign_language: {
    key: 'sign_language',
    group: 'hearing',
    label: 'Перевод на РЖЯ',
  },
  induction_loop: {
    key: 'induction_loop',
    group: 'hearing',
    label: 'Индукционная петля',
  },
  subtitles: {
    key: 'subtitles',
    group: 'hearing',
    label: 'Субтитры',
  },
  companion_free: {
    key: 'companion_free',
    group: 'general',
    label: 'Сопровождающий бесплатно',
    visitor: {
      question: 'На кассе указано, что сопровождающий проходит бесплатно?',
      yesMeans: 'yes',
      noMeans: 'no',
    },
  },
};

/** Признаки, которые можно спрашивать у посетителя без специальных знаний. */
export const VISITOR_ASKABLE: FeatureKey[] = FEATURE_KEYS.filter(
  (k) => FEATURES[k].visitor !== undefined,
);

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}
