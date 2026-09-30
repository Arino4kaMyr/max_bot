/**
 * Названия и значки категорий событий.
 *
 * Слаги приходят из KudaGo; подписи взяты из их справочника
 * `/event-categories/`, чтобы в интерфейсе не появлялись английские
 * идентификаторы вроде «stock».
 */

interface CategoryDef {
  label: string;
  icon: string;
}

export const CATEGORIES: Record<string, CategoryDef> = {
  exhibition: { label: 'Выставки', icon: '🖼' },
  theater: { label: 'Спектакли', icon: '🎭' },
  concert: { label: 'Концерты', icon: '🎵' },
  festival: { label: 'Фестивали', icon: '🎪' },
  education: { label: 'Обучение', icon: '📚' },
  entertainment: { label: 'Развлечения', icon: '🎉' },
  kids: { label: 'Детям', icon: '🧸' },
  tour: { label: 'Экскурсии', icon: '🚶' },
  photo: { label: 'Фотография', icon: '📷' },
  party: { label: 'Вечеринки', icon: '🪩' },
  cinema: { label: 'Кинопоказы', icon: '🎬' },
  quest: { label: 'Квесты', icon: '🗝' },
  holiday: { label: 'Праздники', icon: '🎊' },
  recreation: { label: 'Активный отдых', icon: '⛰' },
  fashion: { label: 'Мода и стиль', icon: '👗' },
  shopping: { label: 'Шопинг', icon: '🛍' },
  'social-activity': { label: 'Благотворительность', icon: '🤝' },
  'business-events': { label: 'События для бизнеса', icon: '💼' },
  'wellness-and-health': { label: 'Красота и здоровье', icon: '🌿' },
  'yarmarki-razvlecheniya-yarmarki': { label: 'Ярмарки', icon: '🎡' },
  other: { label: 'Разное', icon: '📌' },
};

const FALLBACK: CategoryDef = { label: 'Разное', icon: '📌' };

/** Незнакомая категория подписывается нейтрально, а не своим слагом. */
export function categoryOf(slug: string | null): CategoryDef {
  if (!slug) return FALLBACK;
  return CATEGORIES[slug] ?? FALLBACK;
}
