import { describe, expect, it } from 'vitest';
import { buildItemImagePrompt } from './image-prompts.js';

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

const item = { name: 'Plasma Cutter', description: 'A handheld cutting tool used for hull repairs.', category: 'tool' };

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
