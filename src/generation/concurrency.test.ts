import { describe, expect, it } from 'vitest';
import { ConcurrencyLimiter } from './concurrency.js';

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('ConcurrencyLimiter', () => {
  it('[Z] handles a no-op async task', async () => {
    const limiter = new ConcurrencyLimiter(1);
    const result = await limiter.run(() => Promise.resolve(1));
    expect(result).toBe(1);
  });

  it('[O] executes a single task immediately', async () => {
    const limiter = new ConcurrencyLimiter(1);
    let ran = false;
    await limiter.run(() => {
      ran = true;
      return Promise.resolve();
    });
    expect(ran).toBe(true);
  });

  it('[M] preserves ordering through queued parallel tasks', async () => {
    const limiter = new ConcurrencyLimiter(2);
    const output: string[] = [];

    await Promise.all([
      limiter.run(async () => {
        output.push('task-1-start');
        await new Promise((resolve) => setTimeout(resolve, 10));
        output.push('task-1-end');
      }),
      limiter.run(async () => {
        output.push('task-2-start');
        await new Promise((resolve) => setTimeout(resolve, 10));
        output.push('task-2-end');
      }),
      limiter.run(() => {
        output.push('task-3-start');
        output.push('task-3-end');
        return Promise.resolve();
      }),
    ]);

    expect(output).toContain('task-3-start');
    expect(output.indexOf('task-3-start')).toBeGreaterThan(output.indexOf('task-1-start'));
  });

  it('[B] never exceeds max concurrency under load', async () => {
    const limiter = new ConcurrencyLimiter(2);
    let running = 0;
    let peak = 0;

    await Promise.all(
      [1, 2, 3, 4, 5].map(() =>
        limiter.run(async () => {
          running++;
          peak = Math.max(peak, running);
          await new Promise((resolve) => setTimeout(resolve, 5));
          running--;
        }),
      ),
    );

    expect(peak).toBe(2);
  });

  it('[I] returns task results without modification', async () => {
    const limiter = new ConcurrencyLimiter(1);
    const value = { id: 'result', status: 'ok' };
    await expect(limiter.run(() => Promise.resolve(value))).resolves.toBe(value);
  });

  it('[E] releases a queue slot when a running task throws', async () => {
    const limiter = new ConcurrencyLimiter(1);
    const gate = deferred<undefined>();
    const secondRan = deferred<boolean>();

    const first = limiter.run(async () => {
      await gate.promise;
      throw new Error('boom');
    });
    const second = limiter.run(() => {
      secondRan.resolve(true);
      return Promise.resolve(true);
    });

    gate.resolve(undefined);
    await expect(first).rejects.toThrow('boom');
    await expect(secondRan.promise).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
  });

  it('[S] supports standard sequential usage with one worker', async () => {
    const limiter = new ConcurrencyLimiter(1);
    const events: string[] = [];

    await limiter.run(() => {
      events.push('first');
      return Promise.resolve();
    });
    await limiter.run(() => {
      events.push('second');
      return Promise.resolve();
    });

    expect(events).toEqual(['first', 'second']);
  });
});
