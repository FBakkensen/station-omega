import { describe, expect, it } from 'vitest';
import { buildBriefingVideoPrompt } from './video-prompts.js';
import type { GeneratedStation } from './types.js';

const AI_VIDEO_PROMPT = 'Fixed wall-mounted security camera, high angle. The failing reactor core of Tachyon Drift with overloaded coolant pipes above buckled deck plates. Dead control panels line the walls. A cracked monitor displays cascade failure warnings. CCTV timestamp overlay, scan lines, low-resolution grain.';

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
      briefing: '',
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
    visualStyleGuide: 'Brutalist industrial with amber lighting',
    briefingVideoPrompt: AI_VIDEO_PROMPT,
    ...overrides,
  } as GeneratedStation;
}

describe('buildBriefingVideoPrompt', () => {
  it('[Z] returns the prompt even when it is a zero-length edge case', () => {
    const station = makeStation({ briefingVideoPrompt: '' });
    const prompt = buildBriefingVideoPrompt(station);
    expect(prompt).toBe('');
  });

  it('[O] returns exactly one AI-generated prompt verbatim', () => {
    const prompt = buildBriefingVideoPrompt(makeStation());
    expect(prompt).toBe(AI_VIDEO_PROMPT);
  });

  it('[M] preserves all CCTV layers in the prompt: camera position, visuals, and artifacts', () => {
    const prompt = buildBriefingVideoPrompt(makeStation());
    expect(prompt).toContain('Fixed wall-mounted security camera');
    expect(prompt).toContain('Dead control panels');
    expect(prompt).toContain('scan lines');
  });

  it('[B] returns prompt at minimum length boundary without truncation', () => {
    const shortPrompt = 'Fixed camera.';
    const station = makeStation({ briefingVideoPrompt: shortPrompt });
    const prompt = buildBriefingVideoPrompt(station);
    expect(prompt).toBe(shortPrompt);
    expect(prompt).toHaveLength(shortPrompt.length);
  });

  it('[I] prompt follows CCTV structure: camera position, then visuals, then artifacts', () => {
    const prompt = buildBriefingVideoPrompt(makeStation());
    if (prompt === undefined) throw new Error('expected prompt');
    const cameraIdx = prompt.indexOf('Fixed wall-mounted security camera');
    const visualIdx = prompt.indexOf('Dead control panels');
    const artifactIdx = prompt.indexOf('CCTV timestamp overlay');
    expect(cameraIdx).toBeLessThan(visualIdx);
    expect(visualIdx).toBeLessThan(artifactIdx);
  });

  it('[E] returns undefined when briefingVideoPrompt is missing', () => {
    const station = makeStation({ briefingVideoPrompt: undefined });
    const prompt = buildBriefingVideoPrompt(station);
    expect(prompt).toBeUndefined();
  });

  it('[S] produces a mission-focused prompt with station name and CCTV style', () => {
    const prompt = buildBriefingVideoPrompt(makeStation());
    expect(prompt).toContain('Tachyon Drift');
    expect(prompt).toContain('cascade failure warnings');
    expect(prompt).toContain('scan lines');
  });
});
