import { describe, expect, it } from 'vitest';
import { buildNPCImagePrompt, buildItemImagePrompt } from './image-prompts.js';

// Environmental nouns that must NEVER appear in entity prompts.
// These cause Flux to render rooms/surfaces/architecture around the subject.
const BANNED_WORDS = [
  'tray', 'workbench', 'grating', 'drawer', 'shelving', 'plating',
  'corridor', 'hatch', 'bulkhead', 'panel', 'deck', 'overhead',
  'fluorescent', 'emergency', 'industrial', 'station', 'compartment',
  'room', 'wall', 'floor', 'ceiling', 'door',
];

function expectNoBannedWords(prompt: string) {
  const lower = prompt.toLowerCase();
  for (const word of BANNED_WORDS) {
    expect(lower, `Prompt contains banned environmental word "${word}": ${prompt}`).not.toContain(word);
  }
}

const npc = { name: 'Dr. Voss', appearance: 'tall woman in a torn lab coat', disposition: 'neutral' };
const item = { name: 'Plasma Cutter', description: 'A handheld cutting tool used for hull repairs.', category: 'tool' };

describe('buildNPCImagePrompt (Void Portrait)', () => {
  it('[Z] zero-length appearance still produces valid void portrait', () => {
    const minimal = { name: 'Unknown', appearance: '', disposition: 'neutral' };
    const prompt = buildNPCImagePrompt(minimal);
    expect(prompt).toContain('Unknown');
    expect(prompt).toContain('Caravaggio lighting');
    expect(prompt).toContain('Dark background');
    expectNoBannedWords(prompt);
  });

  it('[O] one NPC produces complete self-contained portrait without environment', () => {
    const prompt = buildNPCImagePrompt(npc);
    expect(prompt).toContain('Dr. Voss');
    expect(prompt).toContain('Amber side-light');
    expect(prompt).toContain('85mm lens');
    expect(prompt).toContain('Dark background');
    expectNoBannedWords(prompt);
  });

  it('[M] many dispositions all produce environment-free prompts', () => {
    const dispositions = ['neutral', 'friendly', 'fearful'];
    const results = dispositions.map(d => buildNPCImagePrompt({ name: 'Test', appearance: 'figure', disposition: d }));
    expect(results).toHaveLength(3);
    for (const prompt of results) {
      expectNoBannedWords(prompt);
      expect(prompt).toContain('Caravaggio lighting');
    }
  });

  it('[B] unknown disposition falls back to defaults instead of undefined', () => {
    const unknown = { name: 'Stranger', appearance: 'hooded figure', disposition: 'aggressive' };
    const prompt = buildNPCImagePrompt(unknown);
    expect(prompt).toContain('neutral expression');
    expect(prompt).toContain('neutral stance');
    expect(prompt).not.toContain('undefined');
    expectNoBannedWords(prompt);
  });

  it('[I] prompt follows structure: subject → expression → lighting → particles → background → camera', () => {
    const prompt = buildNPCImagePrompt(npc);
    const subjectIdx = prompt.indexOf('Dr. Voss');
    const exprIdx = prompt.indexOf('watchful gaze');
    const lightIdx = prompt.indexOf('Amber side-light');
    const particleIdx = prompt.indexOf('particles');
    const bgIdx = prompt.indexOf('Dark background');
    const cameraIdx = prompt.indexOf('85mm lens');
    expect(subjectIdx).toBeLessThan(exprIdx);
    expect(exprIdx).toBeLessThan(lightIdx);
    expect(lightIdx).toBeLessThan(particleIdx);
    expect(particleIdx).toBeLessThan(bgIdx);
    expect(bgIdx).toBeLessThan(cameraIdx);
  });

  it('[E] rejects invalid disposition without producing undefined or broken prompt', () => {
    for (const disp of ['neutral', 'friendly', 'fearful', 'aggressive', '']) {
      const prompt = buildNPCImagePrompt({ name: 'X', appearance: 'y', disposition: disp });
      expect(prompt).not.toContain('undefined');
      expect(prompt).not.toContain('null');
      expect(prompt).toContain('Caravaggio lighting');
      expectNoBannedWords(prompt);
    }
  });

  it('[S] happy path: friendly NPC with full void portrait treatment', () => {
    const friendly = { name: 'Nurse Kim', appearance: 'young woman in medical scrubs', disposition: 'friendly' };
    const prompt = buildNPCImagePrompt(friendly);
    expect(prompt).toContain('Nurse Kim');
    expect(prompt).toContain('warm, relieved expression');
    expect(prompt).toContain('Warm golden front-fill');
    expect(prompt).toContain('haze');
    expect(prompt).toContain('Dark background dissolving to black');
    expect(prompt).toContain('Caravaggio lighting');
    expectNoBannedWords(prompt);
  });
});

describe('buildItemImagePrompt (Void-Isolated Hero Prop)', () => {
  it('[Z] zero-length description still produces valid void-isolated prompt', () => {
    const empty = { name: 'Mystery Box', description: '', category: 'tool' };
    const prompt = buildItemImagePrompt(empty);
    expect(prompt).toContain('Mystery Box');
    expect(prompt).toContain('Dark void background');
    expect(prompt).toContain('No text');
    expectNoBannedWords(prompt);
  });

  it('[O] one item produces self-contained prompt with category light color and self-glow', () => {
    const prompt = buildItemImagePrompt(item);
    expect(prompt).toContain('Plasma Cutter');
    expect(prompt).toContain('amber');
    expect(prompt).toContain('rim light');
    expect(prompt).toContain('Dark void background');
    expectNoBannedWords(prompt);
  });

  it('[M] many categories with self-glow produce glow element in prompt', () => {
    const glowCategories = ['medical', 'tool', 'component', 'chemical', 'key'];
    const results = glowCategories.map(c => buildItemImagePrompt({ name: 'X', description: 'Y.', category: c }));
    expect(results).toHaveLength(5);
    for (const prompt of results) {
      expect(prompt.toLowerCase()).toMatch(/glow|led|lumin|energy|heat/i);
      expectNoBannedWords(prompt);
    }
  });

  it('[B] unknown category falls back to default light without environment', () => {
    const mystery = { name: 'Unknown Device', description: 'Strange object.', category: 'alien' };
    const prompt = buildItemImagePrompt(mystery);
    expect(prompt).toContain('directional light');
    expect(prompt).toContain('rim light');
    expect(prompt).not.toContain('undefined');
    expectNoBannedWords(prompt);
  });

  it('[I] prompt follows structure: subject → description → glow → light → background → camera → exclusions', () => {
    const prompt = buildItemImagePrompt(item);
    const subjectIdx = prompt.indexOf('Plasma Cutter');
    const lightIdx = prompt.indexOf('amber');
    const bgIdx = prompt.indexOf('Dark void background');
    const cameraIdx = prompt.indexOf('macro lens');
    const exclIdx = prompt.indexOf('No text');
    expect(subjectIdx).toBeLessThan(lightIdx);
    expect(lightIdx).toBeLessThan(bgIdx);
    expect(bgIdx).toBeLessThan(cameraIdx);
    expect(cameraIdx).toBeLessThan(exclIdx);
  });

  it('[E] handles item with empty description and unknown category without failure', () => {
    const emptyItem = { name: 'Box', description: '', category: 'misc' };
    const prompt = buildItemImagePrompt(emptyItem);
    expect(prompt).toContain('Box');
    expect(prompt).toContain('No text');
    expect(prompt).not.toContain('undefined');
    expectNoBannedWords(prompt);
  });

  it('[S] standard happy path: medical item with void-isolated treatment', () => {
    const medItem = { name: 'Stim Injector', description: 'A pressurized auto-injector loaded with stimulants.', category: 'medical' };
    const prompt = buildItemImagePrompt(medItem);
    expect(prompt).toContain('Stim Injector');
    expect(prompt).toContain('crimson');
    expect(prompt).toContain('bio-monitor');
    expect(prompt).toContain('Dark void background');
    expect(prompt).toContain('macro lens');
    expect(prompt).toContain('No text');
    expectNoBannedWords(prompt);
  });
});
