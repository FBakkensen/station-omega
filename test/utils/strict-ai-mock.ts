type SchemaLike<T = unknown> = {
  parse: (input: unknown) => T;
};

type StrictOutputCarrier = {
  __strictSchema: SchemaLike;
};

type StreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'error'; error: unknown }
  | { type: string; [key: string]: unknown };

type QueuedResult = {
  kind: 'result';
  payload: unknown;
  fullStreamEvents: StreamEvent[];
};

type QueuedThrow = {
  kind: 'throw';
  error: unknown;
};

type QueuedItem = QueuedResult | QueuedThrow;

function asSchemaFromOutput(output: unknown): SchemaLike {
  if (!output || typeof output !== 'object' || !('__strictSchema' in output)) {
    throw new Error(
      'Strict AI mock expected output from Output.object({ schema }) to include __strictSchema.',
    );
  }

  const maybeSchema = (output as { __strictSchema?: unknown }).__strictSchema;
  if (!maybeSchema || typeof maybeSchema !== 'object' || !('parse' in maybeSchema)) {
    throw new Error('Strict AI mock output carrier did not include a valid schema.parse method.');
  }
  if (typeof (maybeSchema as { parse?: unknown }).parse !== 'function') {
    throw new Error('Strict AI mock output carrier did not include a valid schema.parse method.');
  }

  return maybeSchema as SchemaLike;
}

export class StrictAIMockQueue {
  private readonly queue: QueuedItem[] = [];

  enqueueResult(payload: unknown, fullStreamEvents: StreamEvent[] = []): void {
    this.queue.push({ kind: 'result', payload, fullStreamEvents });
  }

  enqueueThrow(error: unknown): void {
    this.queue.push({ kind: 'throw', error });
  }

  reset(): void {
    this.queue.length = 0;
  }

  pendingCount(): number {
    return this.queue.length;
  }

  assertDrained(): void {
    if (this.queue.length > 0) {
      throw new Error(`Strict AI mock queue not fully consumed. Pending items: ${String(this.queue.length)}`);
    }
  }

  outputObjectFactory(args: { schema: SchemaLike }): StrictOutputCarrier {
    return { __strictSchema: args.schema };
  }

  streamTextFactory(options: { output: unknown }): {
    fullStream: AsyncIterable<StreamEvent>;
    output: Promise<unknown>;
  } {
    const item = this.queue.shift();
    if (!item) {
      throw new Error('Strict AI mock queue underflow: no queued response for streamText call.');
    }

    if (item.kind === 'throw') {
      throw item.error;
    }

    const schema = asSchemaFromOutput(options.output);
    const parsed = schema.parse(item.payload);

    return {
      fullStream: this.toAsyncIterable(item.fullStreamEvents),
      output: Promise.resolve(parsed),
    };
  }

  private toAsyncIterable(events: StreamEvent[]): AsyncIterable<StreamEvent> {
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
