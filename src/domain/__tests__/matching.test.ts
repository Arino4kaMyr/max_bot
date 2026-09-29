import { describe, expect, it } from 'vitest';
import { evaluate, type FactMap } from '../matching.js';
import { requirementsFor, criticalKeys } from '../profile.js';
import type { Fact } from '../trust.js';

const checked = new Date('2026-09-12T00:00:00Z');

function verified(value: Fact['value'], note?: string): Fact {
  return { value, source: 'manual', agree: 0, disagree: 0, checkedAt: checked, note };
}

function reported(value: Fact['value'], agree = 1, disagree = 0): Fact {
  return { value, source: 'user', agree, disagree, checkedAt: checked };
}

const wheelchair = requirementsFor(['wheelchair']);

describe('вердикт', () => {
  it('подходит, когда все критичные признаки проверены командой', () => {
    const facts: FactMap = {
      entrance_step_free: verified('yes'),
      wc_accessible: verified('yes'),
      lift: verified('yes'),
      wheelchair_seats: verified('yes'),
      door_width_90: verified('yes'),
      parking_disabled: verified('yes'),
    };
    expect(evaluate(wheelchair, facts).verdict).toBe('fits');
  });

  it('не подходит, когда критичный признак отсутствует на площадке', () => {
    const facts: FactMap = {
      entrance_step_free: verified('no'),
      wc_accessible: verified('yes'),
    };
    expect(evaluate(wheelchair, facts).verdict).toBe('unfit');
  });

  it('нет данных, а не «не подходит», когда критичный признак неизвестен', () => {
    const facts: FactMap = { wc_accessible: verified('yes') };
    expect(evaluate(wheelchair, facts).verdict).toBe('unknown');
  });

  it('частично, когда критичные в порядке, но важный признак отсутствует', () => {
    const facts: FactMap = {
      entrance_step_free: verified('yes'),
      wc_accessible: verified('yes'),
      lift: verified('no'),
      wheelchair_seats: verified('yes'),
      door_width_90: verified('yes'),
    };
    expect(evaluate(wheelchair, facts).verdict).toBe('partial');
  });

  it('nice-требования не мешают зелёному вердикту', () => {
    const facts: FactMap = {
      entrance_step_free: verified('yes'),
      wc_accessible: verified('yes'),
      lift: verified('yes'),
      wheelchair_seats: verified('yes'),
      door_width_90: verified('yes'),
      // parking_disabled (nice) не заполнен
    };
    expect(evaluate(wheelchair, facts).verdict).toBe('fits');
  });
});

describe('доверие ограничивает вердикт', () => {
  const rest: FactMap = {
    lift: verified('yes'),
    wheelchair_seats: verified('yes'),
    door_width_90: verified('yes'),
  };

  it('одиночный отчёт посетителя не даёт зелёный вердикт', () => {
    const result = evaluate(wheelchair, {
      ...rest,
      entrance_step_free: reported('yes', 1),
      wc_accessible: verified('yes'),
    });
    expect(result.verdict).toBe('partial');
    expect(result.lines.find((l) => l.key === 'entrance_step_free')?.weak).toBe(true);
  });

  it('два согласных отчёта дают зелёный вердикт', () => {
    const result = evaluate(wheelchair, {
      ...rest,
      entrance_step_free: reported('yes', 2),
      wc_accessible: verified('yes'),
    });
    expect(result.verdict).toBe('fits');
  });

  it('оспоренный факт трактуется как отсутствие данных', () => {
    const result = evaluate(wheelchair, {
      ...rest,
      entrance_step_free: reported('yes', 3, 1),
      wc_accessible: verified('yes'),
    });
    expect(result.verdict).toBe('unknown');
    expect(result.lines.find((l) => l.key === 'entrance_step_free')?.status).toBe('unknown');
  });
});

describe('групповой профиль', () => {
  it('объединяет требования и берёт более строгий уровень', () => {
    const group = requirementsFor(['wheelchair', 'stroller', 'stairs_hard']);
    const entrance = group.find((r) => r.key === 'entrance_step_free');
    // у коляски critical, у остальных important — остаётся critical
    expect(entrance?.level).toBe('critical');
    expect(group.some((r) => r.key === 'ramp')).toBe(true);
  });

  it('компания не проходит туда, куда не попадает самый ограниченный участник', () => {
    const group = requirementsFor(['stroller', 'wheelchair']);
    const facts: FactMap = {
      entrance_step_free: verified('yes'),
      wc_accessible: verified('no'),
    };
    expect(evaluate(group, facts).verdict).toBe('unfit');
  });
});

describe('разбор для карточки', () => {
  it('переносит уточнение из факта в строку', () => {
    const result = evaluate(wheelchair, {
      entrance_step_free: verified('yes', 'пандус слева от главного входа'),
      wc_accessible: verified('yes'),
    });
    const line = result.lines.find((l) => l.key === 'entrance_step_free');
    expect(line?.note).toBe('пандус слева от главного входа');
    expect(line?.status).toBe('ok');
  });

  it('критичные признаки профиля — это то, что спрашиваем при верификации', () => {
    expect(criticalKeys(['wheelchair'])).toEqual(['entrance_step_free', 'wc_accessible']);
  });

  it('пустой профиль не отсекает ничего', () => {
    expect(evaluate([], {}).verdict).toBe('fits');
  });
});
