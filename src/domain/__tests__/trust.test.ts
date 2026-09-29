import { describe, expect, it } from 'vitest';
import { trustLabel, trustOf, weakestTrust, type Fact } from '../trust.js';

const date = new Date('2026-09-12T00:00:00Z');

const fact = (over: Partial<Fact>): Fact => ({
  value: 'yes',
  source: 'user',
  agree: 0,
  disagree: 0,
  checkedAt: date,
  ...over,
});

describe('уровень доверия', () => {
  it('ручная разметка команды — проверено', () => {
    expect(trustOf(fact({ source: 'manual' }))).toBe('verified');
  });

  it('два согласных отчёта — подтверждено', () => {
    expect(trustOf(fact({ agree: 2 }))).toBe('confirmed');
  });

  it('один отчёт — одиночный', () => {
    expect(trustOf(fact({ agree: 1 }))).toBe('single');
  });

  it('любое опровержение перевешивает подтверждения', () => {
    expect(trustOf(fact({ agree: 5, disagree: 1 }))).toBe('disputed');
  });

  it('опровержение перевешивает и ручную разметку — её тоже надо перепроверить', () => {
    expect(trustOf(fact({ source: 'manual', disagree: 1 }))).toBe('disputed');
  });

  it('отсутствие факта и значение unknown — одно и то же', () => {
    expect(trustOf(undefined)).toBe('none');
    expect(trustOf(fact({ value: 'unknown' }))).toBe('none');
  });
});

describe('подписи', () => {
  it('склоняет число подтверждений', () => {
    expect(trustLabel(fact({ agree: 2 }))).toContain('Подтвердили 2 посетителя');
    expect(trustLabel(fact({ agree: 5 }))).toContain('Подтвердили 5 посетителей');
    expect(trustLabel(fact({ agree: 21 }))).toContain('Подтвердили 21 посетитель');
  });

  it('одиночный отчёт подписан оговоркой', () => {
    expect(trustLabel(fact({ agree: 1 }))).toBe('Со слов одного посетителя — уточните на месте');
  });

  it('подпись карточки берётся по самому слабому факту', () => {
    expect(weakestTrust([fact({ source: 'manual' }), fact({ agree: 1 })])).toBe('single');
  });
});

describe('демонстрационные и заявленные площадкой данные', () => {
  it('данные с сайта площадки достаточны для вердикта, но подписаны как незаверенные', () => {
    const f = fact({ source: 'venue_site' });
    expect(trustOf(f)).toBe('stated');
    expect(trustLabel(f)).toContain('По информации площадки');
  });

  it('демонстрационный набор честно помечен прямо в карточке', () => {
    const f = fact({ source: 'demo' });
    expect(trustOf(f)).toBe('demo');
    expect(trustLabel(f)).toBe('Демонстрационные данные — требуют проверки на месте');
  });

  it('отчёт посетителя слабее демонстрационных данных, но сильнее ничего', () => {
    expect(weakestTrust([fact({ source: 'demo' }), fact({ agree: 1 })])).toBe('single');
  });
});
