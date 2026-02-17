/**
 * Simple concurrency limiter (semaphore) for bounding parallel async work.
 *
 * Used by the creative layer to cap simultaneous `runLayer()` calls,
 * preventing OpenRouter rate-limit storms when many sublayers fire at once.
 */

export class ConcurrencyLimiter {
    private running = 0;
    private readonly queue: Array<() => void> = [];

    constructor(private readonly maxConcurrent: number) {}

    async run<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }

    private acquire(): Promise<void> {
        if (this.running < this.maxConcurrent) {
            this.running++;
            return Promise.resolve();
        }
        return new Promise<void>(resolve => {
            this.queue.push(resolve);
        });
    }

    private release(): void {
        const next = this.queue.shift();
        if (next) {
            next();
        } else {
            this.running--;
        }
    }
}
