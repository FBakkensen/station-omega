import { describe, expect, it } from 'vitest';
import { buildBriefingVideoPrompt } from './video-prompts.js';
import type { GeneratedStation } from './types.js';

const AI_VIDEO_PROMPT = 'A handheld tracking shot pushes through the failing reactor core of Tachyon Drift. Overloaded coolant pipes gush steam across buckled deck plates, casting amber emergency light across dead control panels. A cracked monitor blinks cascade failure warnings. The groan of stressed hull metal, hissing coolant leaks, and a repeating evacuation klaxon. Retro 1970s sci-fi aesthetic, muted palette, heavy film grain.';

function makeStation(overrides?: Partial<GeneratedStation>): GeneratedStation {
  return {
    config: { seed: 1, difficulty: 'normal', storyArc: 'cascade_failure', characterClass: 'engineer' },
    stationName: 'Tachyon Drift',
    briefing: 'Restore failing systems. Extract before cascade.',
    backstory: 'Built in 2157. Abandoned after the incident. Now drifting.',
    rooms: new Map(),
    npcs: new Map(),
    items: new Map(),
    objectives: {
      title: 'Restore Station',
      steps: [],
      finalObjective: '',
    },
    entryRoomId: 'room_0',
    escapeRoomId: 'room_1',
    crewRoster: [],
    arrivalScenario: {
      narration: '',
      initialActions: [],
    },
    mapLayout: { nodes: [], edges: [] },
    visualStyleSeed: 'Brutalist industrial with amber lighting',
    briefingVideoPrompt: AI_VIDEO_PROMPT,
    ...overrides,
  } as GeneratedStation;
}

describe('buildBriefingVideoPrompt', () => {
  it('[Z] returns fallback prompt when briefingVideoPrompt is absent', () => {
    const station = makeStation({ briefingVideoPrompt: undefined });
    const prompt = buildBriefingVideoPrompt(station);
    expect(prompt).toContain('Tachyon Drift');
    expect(prompt).toContain('slow dolly forward');
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('[O] returns exactly one AI-generated prompt verbatim when briefingVideoPrompt is present', () => {
    const prompt = buildBriefingVideoPrompt(makeStation());
    expect(prompt).toBe(AI_VIDEO_PROMPT);
  });

  it('[M] fallback includes multiple Veo direction layers: camera, audio, and style', () => {
    const station = makeStation({ briefingVideoPrompt: undefined });
    const prompt = buildBriefingVideoPrompt(station);
    expect(prompt).toContain('slow dolly forward');
    expect(prompt).toContain('metallic groaning');
    expect(prompt).toContain('film grain');
  });

  it('[B] fallback handles absent visualStyleSeed at boundary gracefully', () => {
    const station = makeStation({ briefingVideoPrompt: undefined, visualStyleSeed: undefined });
    const prompt = buildBriefingVideoPrompt(station);
    expect(prompt).not.toContain('undefined');
    expect(prompt).toContain('Tachyon Drift');
  });

  it('[I] fallback follows Veo structure: camera, then audio, then style', () => {
    const station = makeStation({ briefingVideoPrompt: undefined });
    const prompt = buildBriefingVideoPrompt(station);
    const cameraIdx = prompt.indexOf('slow dolly forward');
    const audioIdx = prompt.indexOf('metallic groaning');
    const styleIdx = prompt.indexOf('Retro 1970s sci-fi');
    expect(cameraIdx).toBeLessThan(audioIdx);
    expect(audioIdx).toBeLessThan(styleIdx);
  });

  it('[E] handles empty briefingVideoPrompt without throwing error', () => {
    const station = makeStation({ briefingVideoPrompt: '' });
    const prompt = buildBriefingVideoPrompt(station);
    expect(prompt).toContain('slow dolly forward');
    expect(prompt).toContain('Tachyon Drift');
  });

  it('[S] produces a simple mission-focused prompt with station name and cinematic direction', () => {
    const prompt = buildBriefingVideoPrompt(makeStation());
    expect(prompt).toContain('Tachyon Drift');
    expect(prompt).toContain('evacuation klaxon');
    expect(prompt).toContain('film grain');
  });
});
