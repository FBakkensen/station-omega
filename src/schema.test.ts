import { describe, expect, it } from 'vitest';
import { GameResponseSchema } from './schema.js';

function validResponse(overrides?: Record<string, unknown>) {
  return {
    segments: [
      {
        type: 'narration' as const,
        text: 'I check the pressure gauge.',
        npcId: null,
        crewName: null,
      },
    ],
    imagePrompt: null,
    objectiveVideoPrompt: null,
    ...overrides,
  };
}

describe('GameResponseSchema objectiveVideoPrompt', () => {
  it('[Z] validates response with objectiveVideoPrompt: null', () => {
    const result = GameResponseSchema.safeParse(validResponse());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.objectiveVideoPrompt).toBeNull();
    }
  });

  it('[O] validates response with one non-null objectiveVideoPrompt string', () => {
    const result = GameResponseSchema.safeParse(
      validResponse({ objectiveVideoPrompt: 'A reactor core ignites with blue plasma.' })
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.objectiveVideoPrompt).toBe('A reactor core ignites with blue plasma.');
    }
  });

  it('[M] validates response with multiple segments and non-null video prompt', () => {
    const result = GameResponseSchema.safeParse({
      segments: [
        { type: 'narration', text: 'I insert the keycard.', npcId: null, crewName: null },
        { type: 'thought', text: 'That did it.', npcId: null, crewName: null },
        { type: 'station_pa', text: 'Access granted.', npcId: null, crewName: null },
      ],
      imagePrompt: 'A reactor bay with glowing conduits.',
      objectiveVideoPrompt: 'Machinery activates as energy floods through conduits.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.segments).toHaveLength(3);
      expect(result.data.objectiveVideoPrompt).toBe('Machinery activates as energy floods through conduits.');
    }
  });

  it('[B] validates response at the empty string boundary for objectiveVideoPrompt', () => {
    const result = GameResponseSchema.safeParse(
      validResponse({ objectiveVideoPrompt: '' })
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.objectiveVideoPrompt).toBe('');
    }
  });

  it('[I] schema output type includes objectiveVideoPrompt field', () => {
    const result = GameResponseSchema.safeParse(validResponse());
    expect(result.success).toBe(true);
    if (result.success) {
      expect('objectiveVideoPrompt' in result.data).toBe(true);
    }
  });

  it('[E] rejects response where objectiveVideoPrompt is a number', () => {
    const result = GameResponseSchema.safeParse(
      validResponse({ objectiveVideoPrompt: 42 })
    );
    expect(result.success).toBe(false);
  });

  it('[S] parses a complete valid response with all fields populated', () => {
    const result = GameResponseSchema.safeParse({
      segments: [
        {
          type: 'narration',
          text: 'I slot the **fusion cell** into the reactor housing.',
          npcId: null,
          crewName: null,
          entityRefs: [{ type: 'item', id: 'fusion_cell_0' }],
        },
      ],
      imagePrompt: 'A large reactor bay with glowing conduits and emergency lighting.',
      objectiveVideoPrompt: 'A fusion cell slots into a reactor housing, blue energy cascading upward through transparent coolant lines.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.segments[0].text).toContain('fusion cell');
      expect(result.data.imagePrompt).toBeTruthy();
      expect(result.data.objectiveVideoPrompt).toBeTruthy();
    }
  });
});
