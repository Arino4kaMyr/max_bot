import { describe, expect, it } from 'vitest';
import { categoryOf } from '../categories.js';

describe('подписи категорий', () => {
  it('переводит слаги KudaGo на русский', () => {
    expect(categoryOf('exhibition').label).toBe('Выставки');
    expect(categoryOf('tour').label).toBe('Экскурсии');
  });

  it('незнакомая категория не показывается сырым слагом', () => {
    expect(categoryOf('some-new-slug').label).toBe('Разное');
    // промоакции магазинов в афишу не попадают
    expect(categoryOf('stock').label).toBe('Разное');
    expect(categoryOf(null).label).toBe('Разное');
  });

  it('у каждой категории есть значок', () => {
    expect(categoryOf('theater').icon).not.toBe('');
  });
});
