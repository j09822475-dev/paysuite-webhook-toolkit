import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consoleLogger, noopLogger } from '../logger/index.js';
import { fromPino } from '../logger/pino.js';

describe('noopLogger', () => {
  it('should expose the four log levels and not throw when called', () => {
    expect(noopLogger.debug('m')).toBeUndefined();
    expect(noopLogger.info('m')).toBeUndefined();
    expect(noopLogger.warn('m')).toBeUndefined();
    expect(noopLogger.error('m')).toBeUndefined();
  });
});

describe('consoleLogger', () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    debugSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('should forward debug calls to console.debug', () => {
    consoleLogger.debug('hello', { k: 1 });
    expect(debugSpy).toHaveBeenCalledWith('hello', { k: 1 });
  });

  it('should forward info, warn, and error calls to console', () => {
    consoleLogger.info('i');
    consoleLogger.warn('w');
    consoleLogger.error('e');
    expect(infoSpy).toHaveBeenCalledWith('i', undefined);
    expect(warnSpy).toHaveBeenCalledWith('w', undefined);
    expect(errorSpy).toHaveBeenCalledWith('e', undefined);
  });
});

describe('fromPino', () => {
  it('should swap arg order to (meta, msg) when forwarding', () => {
    const calls: Array<{ method: string; meta: unknown; msg: unknown }> = [];
    const pino = {
      debug: (meta: unknown, msg?: unknown) => calls.push({ method: 'debug', meta, msg }),
      info: (meta: unknown, msg?: unknown) => calls.push({ method: 'info', meta, msg }),
      warn: (meta: unknown, msg?: unknown) => calls.push({ method: 'warn', meta, msg }),
      error: (meta: unknown, msg?: unknown) => calls.push({ method: 'error', meta, msg }),
    } satisfies Record<string, unknown> as unknown as import('../logger/pino.js').PinoLikeLogger;
    const logger = fromPino(pino);
    logger.debug('hello', { k: 1 });
    logger.info('i', { k: 2 });
    logger.warn('w');
    logger.error('e');
    expect(calls).toEqual([
      { method: 'debug', meta: { k: 1 }, msg: 'hello' },
      { method: 'info', meta: { k: 2 }, msg: 'i' },
      { method: 'warn', meta: {}, msg: 'w' },
      { method: 'error', meta: {}, msg: 'e' },
    ]);
  });
});
