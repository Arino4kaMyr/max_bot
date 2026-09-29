import { describe, expect, it } from 'vitest';
import { pickSlot } from '../kudago.js';

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

describe('выбор показа события', () => {
  it('берёт ближайший будущий показ', () => {
    const slot = pickSlot([
      { start: sec('2030-01-10T10:00:00Z'), end: sec('2030-01-10T12:00:00Z') },
      { start: sec('2030-01-05T10:00:00Z'), end: sec('2030-01-05T12:00:00Z') },
    ]);
    expect(slot?.start.toISOString()).toBe('2030-01-05T10:00:00.000Z');
    expect(slot?.permanent).toBe(false);
  });

  it('прошедшие показы отбрасываются', () => {
    const slot = pickSlot([{ start: sec('2000-01-01T10:00:00Z'), end: sec('2000-01-01T12:00:00Z') }]);
    expect(slot).toBeNull();
  });

  it('постоянная экспозиция остаётся в выдаче и помечается идущей сейчас', () => {
    // KudaGo отдаёт такие события с концом в 9999 году
    const slot = pickSlot([{ start: sec('2016-09-09T00:00:00Z'), end: 253370754000 }]);
    expect(slot).not.toBeNull();
    expect(slot?.permanent).toBe(true);
    expect(slot?.end).toBeNull();
  });

  it('длинная выставка считается постоянной', () => {
    const slot = pickSlot([{ start: sec('2030-01-01T00:00:00Z'), end: sec('2030-09-01T00:00:00Z') }]);
    expect(slot?.permanent).toBe(true);
  });
});
