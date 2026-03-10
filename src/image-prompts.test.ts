import { describe, expect, it } from 'vitest';
import { buildNPCImagePrompt, buildItemImagePrompt } from './image-prompts.js';
import type { Room, RoomSensory } from './types.js';

function makeSensory(overrides?: Partial<RoomSensory>): RoomSensory {
  return {
    sounds: [],
    smells: [],
    visuals: [],
    tactile: '',
    ...overrides,
  };
}

function makeRoom(overrides?: Partial<Room>): Room {
  return {
    id: 'room_0',
    archetype: 'reactor',
    name: 'Reactor Core',
    descriptionSeed: 'A vast reactor chamber.',
    depth: 0,
    connections: ['room_1'],
    lockedBy: null,
    loot: [],
    sensory: makeSensory(),
    crewLogs: [],
    isObjectiveRoom: false,
    secretConnection: null,
    roomModifiers: [],
    systemFailures: [],
    engineeringNotes: '',
    ...overrides,
  };
}

const npc = { name: 'Dr. Voss', appearance: 'tall woman in a torn lab coat', disposition: 'neutral' };
const item = { name: 'Plasma Cutter', description: 'A handheld cutting tool used for emergency hull repairs.', category: 'tool' };

describe('buildNPCImagePrompt', () => {
  it('[Z] zero room context falls back to black background', () => {
    const prompt = buildNPCImagePrompt(npc);
    expect(prompt).toContain('black background');
  });

  it('[O] one room with sensory visual includes room context', () => {
    const room = makeRoom({ sensory: makeSensory({ visuals: ['Amber warning lights pulse across corroded walls.'] }) });
    const prompt = buildNPCImagePrompt(npc, room);
    expect(prompt).toContain('reactor compartment');
    expect(prompt).toContain('Amber warning lights');
    expect(prompt).not.toContain('black background');
  });

  it('[M] multiple sensory visuals uses only the first', () => {
    const room = makeRoom({ sensory: makeSensory({ visuals: ['First visual detail.', 'Second visual detail.'] }) });
    const prompt = buildNPCImagePrompt(npc, room);
    expect(prompt).toContain('First visual detail.');
    expect(prompt).not.toContain('Second visual detail.');
  });

  it('[B] empty-string visual boundary still gets archetype phrase', () => {
    const room = makeRoom({ archetype: 'medical', sensory: makeSensory({ visuals: [] }) });
    const prompt = buildNPCImagePrompt(npc, room);
    expect(prompt).toContain('medical compartment');
    expect(prompt).not.toContain('black background');
  });

  it('[I] prompt structure: subject first, room context second, style guide last', () => {
    const room = makeRoom();
    const guide = 'Brutalist industrial with amber lighting';
    const prompt = buildNPCImagePrompt(npc, room, guide);
    const subjectIdx = prompt.indexOf('Dr. Voss');
    const roomIdx = prompt.indexOf('reactor compartment');
    const guideIdx = prompt.indexOf('Brutalist');
    expect(subjectIdx).toBeLessThan(roomIdx);
    expect(roomIdx).toBeLessThan(guideIdx);
  });

  it('[E] missing visualStyleGuide does not fail or include guide text', () => {
    const room = makeRoom();
    const prompt = buildNPCImagePrompt(npc, room);
    expect(prompt).toContain('reactor compartment');
    expect(prompt).not.toContain('Brutalist');
  });

  it('[S] happy path: NPC in reactor room with style guide', () => {
    const room = makeRoom({ sensory: makeSensory({ visuals: ['Glowing pipes hum overhead.'] }) });
    const prompt = buildNPCImagePrompt(npc, room, 'Brutalist industrial');
    expect(prompt).toContain('Dr. Voss');
    expect(prompt).toContain('calm, guarded expression');
    expect(prompt).toContain('vast industrial reactor compartment');
    expect(prompt).toContain('Glowing pipes hum overhead.');
    expect(prompt).toContain('Brutalist industrial');
  });
});

describe('buildItemImagePrompt', () => {
  it('[Z] zero room context falls back to black background', () => {
    const prompt = buildItemImagePrompt(item);
    expect(prompt).toContain('black background');
  });

  it('[O] one room with sensory visual includes room context', () => {
    const room = makeRoom({ archetype: 'medical', sensory: makeSensory({ visuals: ['Sterile white panels line the walls.'] }) });
    const prompt = buildItemImagePrompt(item, room);
    expect(prompt).toContain('medical compartment');
    expect(prompt).toContain('Sterile white panels');
    expect(prompt).not.toContain('black background');
  });

  it('[M] multiple sensory visuals uses only the first', () => {
    const room = makeRoom({ sensory: makeSensory({ visuals: ['First detail.', 'Second detail.'] }) });
    const prompt = buildItemImagePrompt(item, room);
    expect(prompt).toContain('First detail.');
    expect(prompt).not.toContain('Second detail.');
  });

  it('[B] empty-string visual boundary still gets archetype phrase', () => {
    const room = makeRoom({ archetype: 'cargo' });
    const prompt = buildItemImagePrompt(item, room);
    expect(prompt).toContain('cargo compartment');
    expect(prompt).not.toContain('black background');
  });

  it('[I] prompt structure: subject first, room context second, style guide last', () => {
    const room = makeRoom();
    const guide = 'Brutalist industrial with amber lighting';
    const prompt = buildItemImagePrompt(item, room, guide);
    const subjectIdx = prompt.indexOf('Plasma Cutter');
    const roomIdx = prompt.indexOf('reactor compartment');
    const guideIdx = prompt.indexOf('Brutalist');
    expect(subjectIdx).toBeLessThan(roomIdx);
    expect(roomIdx).toBeLessThan(guideIdx);
  });

  it('[E] missing room does not fail and falls back to black background', () => {
    const prompt = buildItemImagePrompt(item);
    expect(prompt).toContain('Plasma Cutter');
    expect(prompt).toContain('black background');
  });

  it('[S] happy path: item in medical bay with style guide', () => {
    const room = makeRoom({ archetype: 'medical', sensory: makeSensory({ visuals: ['Bright surgical lights overhead.'] }) });
    const prompt = buildItemImagePrompt(item, room, 'Clean minimalist');
    expect(prompt).toContain('Plasma Cutter');
    expect(prompt).toContain('emergency hull repairs');
    expect(prompt).toContain('long sterile medical compartment');
    expect(prompt).toContain('Bright surgical lights');
    expect(prompt).toContain('Clean minimalist');
  });
});
