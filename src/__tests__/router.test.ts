import { describe, expect, it } from 'vitest';
import { createRouter } from '../router/index.js';

type Event =
  | { type: 'a'; value: number }
  | { type: 'b'; name: string }
  | { type: 'c' };

describe('createRouter', () => {
  it('should dispatch to the matching handler when handle is called', async () => {
    const seen: Array<unknown> = [];
    const r = createRouter<Event>()
      .on('a', (e) => { seen.push(['a', e.value]); })
      .on('b', (e) => { seen.push(['b', e.name]); });

    await r.handle({ type: 'a', value: 7 });
    await r.handle({ type: 'b', name: 'hi' });
    expect(seen).toEqual([['a', 7], ['b', 'hi']]);
  });

  it('should call fallback when no on() handler matches', async () => {
    const seen: Array<unknown> = [];
    const r = createRouter<Event>()
      .on('a', () => { seen.push('a-handler'); })
      .fallback((e) => { seen.push(['fallback', e.type]); });

    await r.handle({ type: 'c' });
    expect(seen).toEqual([['fallback', 'c']]);
  });

  it('should silently no-op when no handler and no fallback', async () => {
    const r = createRouter<Event>();
    await expect(r.handle({ type: 'a', value: 1 })).resolves.toBeUndefined();
  });

  it('should await async handlers', async () => {
    const seen: string[] = [];
    const r = createRouter<Event>()
      .on('a', async () => {
        await new Promise<void>((res) => setTimeout(res, 1));
        seen.push('done');
      });
    await r.handle({ type: 'a', value: 1 });
    expect(seen).toEqual(['done']);
  });

  it('should override fallback when called twice (last wins)', async () => {
    const r = createRouter<Event>()
      .fallback(() => undefined)
      .fallback(() => { throw new Error('second'); });
    await expect(r.handle({ type: 'a', value: 1 })).rejects.toThrow('second');
  });

  it('should override on() handler when same type registered twice (runtime allows)', async () => {
    // Note: TypeScript would prevent this at compile time, but runtime accepts.
    const seen: string[] = [];
    const r = createRouter<Event>()
      .on('a', () => { seen.push('first'); })
      // @ts-expect-error duplicate registration intentionally
      .on('a', () => { seen.push('second'); });
    await r.handle({ type: 'a', value: 1 });
    expect(seen).toEqual(['second']);
  });
});
