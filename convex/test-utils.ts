import type { Id } from './_generated/dataModel';

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function extractHandler<TCtx, TArgs, TReturn>(
  fn: unknown,
): (ctx: TCtx, args: TArgs) => Promise<TReturn> {
  return (fn as { _handler: (ctx: TCtx, args: TArgs) => Promise<TReturn> })._handler;
}

export type QueryBuilder = {
  eq: (field: string, value: unknown) => QueryBuilder;
};

export function createQueryBuilder(onGameId: (gameId: Id<'games'>) => void): QueryBuilder {
  return {
    eq: (field: string, value: unknown) => {
      if (field === 'gameId') onGameId(value as Id<'games'>);
      return createQueryBuilder(onGameId);
    },
  };
}
