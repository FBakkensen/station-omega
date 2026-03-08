import type {
  AIStreamPart,
  AITextClient,
  AITextObjectStream,
  StreamStructuredObjectRequest,
} from '../../src/io/ai-text-client.js';

type QueuedResult = {
  kind: 'result';
  payload: unknown;
  fullStreamEvents: AIStreamPart[];
};

type QueuedThrow = {
  kind: 'throw';
  error: unknown;
};

type QueuedItem = QueuedResult | QueuedThrow;

export class StrictAIMockQueue {
  private readonly queue: QueuedItem[] = [];
  private readonly requests: Array<StreamStructuredObjectRequest<unknown>> = [];

  enqueueResult(payload: unknown, fullStreamEvents: AIStreamPart[] = []): void {
    this.queue.push({ kind: 'result', payload, fullStreamEvents });
  }

  enqueueThrow(error: unknown): void {
    this.queue.push({ kind: 'throw', error });
  }

  reset(): void {
    this.queue.length = 0;
    this.requests.length = 0;
  }

  pendingCount(): number {
    return this.queue.length;
  }

  requestCount(): number {
    return this.requests.length;
  }

  requestAt(index: number): StreamStructuredObjectRequest<unknown> | undefined {
    return this.requests[index];
  }

  assertDrained(): void {
    if (this.queue.length > 0) {
      throw new Error(
        `Strict AI mock queue not fully consumed. Pending items: ${String(this.queue.length)}`,
      );
    }
  }

  asClient(): AITextClient {
    return {
      streamStructuredObject: <TSchema>(
        request: StreamStructuredObjectRequest<TSchema>,
      ): AITextObjectStream<TSchema> => {
        this.requests.push(request as StreamStructuredObjectRequest<unknown>);
        const item = this.queue.shift();
        if (!item) {
          throw new Error('Strict AI mock queue underflow: no queued response for AI call.');
        }

        if (item.kind === 'throw') {
          throw item.error;
        }

        const parsed = request.schema.parse(item.payload);
        return {
          fullStream: this.toAsyncIterable(item.fullStreamEvents),
          output: Promise.resolve(parsed),
          usage: Promise.resolve({}),
        };
      },
    };
  }

  private toAsyncIterable(events: AIStreamPart[]): AsyncIterable<AIStreamPart> {
    return {
      async *[Symbol.asyncIterator]() {
        for (const event of events) {
          await Promise.resolve();
          yield event;
        }
      },
    };
  }
}
