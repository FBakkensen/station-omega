import { describe, expect, it } from 'vitest';
import { buildTurnMessages, mapChoicesForPersistence } from './streamTurn.helpers';

describe('streamTurn helper contracts', () => {
  it('[Z] builds a minimal user-only message when context/history are empty', () => {
    const messages = buildTurnMessages([], null, 'look around');
    expect(messages).toEqual([{ role: 'user', content: 'look around' }]);
  });

  it('[O] appends turn context before player input when provided', () => {
    const messages = buildTurnMessages([], 'status context', 'repair relay');
    expect(messages).toEqual([
      { role: 'system', content: 'status context' },
      { role: 'user', content: 'repair relay' },
    ]);
  });

  it('[M] preserves full conversation history ordering', () => {
    const messages = buildTurnMessages(
      [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'response' },
      ],
      'turn context',
      'next action',
    );
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'system', 'user']);
  });

  it('[B] treats empty-string context as absent context', () => {
    const messages = buildTurnMessages([], '', 'scan room');
    expect(messages).toEqual([{ role: 'user', content: 'scan room' }]);
  });

  it('[I] maps choices to persisted ID/label/description contract', () => {
    const mapped = mapChoicesForPersistence({
      title: 'Actions',
      choices: [
        { label: 'Inspect relay', description: 'Run diagnostics on the panel.' },
        { label: 'Stabilize coolant', description: 'Prevent thermal cascade.' },
      ],
    });

    expect(mapped).toEqual([
      { id: '0', label: 'Inspect relay', description: 'Run diagnostics on the panel.' },
      { id: '1', label: 'Stabilize coolant', description: 'Prevent thermal cascade.' },
    ]);
  });

  it('[E] safely handles empty choice sets', () => {
    expect(mapChoicesForPersistence({ title: 'none', choices: [] })).toEqual([]);
  });

  it('[S] produces deterministic IDs for standard choice arrays', () => {
    const first = mapChoicesForPersistence({
      title: 'Options',
      choices: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }],
    });
    const second = mapChoicesForPersistence({
      title: 'Options',
      choices: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }],
    });
    expect(first).toEqual(second);
  });
});
