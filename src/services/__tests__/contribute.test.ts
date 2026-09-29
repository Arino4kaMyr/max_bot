import { describe, expect, it } from 'vitest';
import { checklist, questionFor } from '../contribute.js';

describe('вопросы контрибьютору', () => {
  it('задаются без терминов и только по заметным признакам', () => {
    const keys = checklist().map((q) => q.key);
    expect(keys).toContain('entrance_step_free');
    expect(keys).toContain('wc_accessible');
    // экспертное у случайного посетителя не спрашиваем — так собирается мусор
    expect(keys).not.toContain('induction_loop');
    expect(keys).not.toContain('audio_description');
    expect(keys).not.toContain('door_width_90');
  });

  it('инвертированный вопрос корректно раскладывается в значение признака', () => {
    const q = questionFor('entrance_step_free')!;
    expect(q.text).toContain('ступенькам');
    // «да, нужно подниматься» означает, что вход НЕ без ступеней
    expect(q.yesMeans).toBe('no');
    expect(q.noMeans).toBe('yes');
  });

  it('у экспертного признака вопроса нет', () => {
    expect(questionFor('sign_language')).toBeNull();
  });
});
