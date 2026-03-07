import { describe, expect, it } from 'vitest';
import { getBuild } from './character.js';
import { buildOrchestratorPrompt } from './prompt.js';
import { createTestStation } from '../test/fixtures/factories.js';

type PromptObjectiveStep = ReturnType<typeof createTestStation>['objectives']['steps'][number] & {
  revealed?: boolean;
};

function setRevealed(step: PromptObjectiveStep, revealed: boolean): void {
  step.revealed = revealed;
}

function buildPromptFixture(): string {
  const station = createTestStation();
  const build = getBuild('engineer');
  return buildOrchestratorPrompt(station, build);
}

describe('buildOrchestratorPrompt mission visibility', () => {
  it('[Z] falls back to the indexed objective when reveal metadata is absent', () => {
    const prompt = buildPromptFixture();
    expect(prompt).toContain('Description: Diagnose the relay fault in Docking Vestibule.');
    expect(prompt).not.toContain('Description: Reach the Escape Gantry.');
  });

  it('[O] includes the one active revealed objective in the mission section', () => {
    const station = createTestStation();
    const build = getBuild('engineer');
    setRevealed(station.objectives.steps[0] as PromptObjectiveStep, true);
    setRevealed(station.objectives.steps[1] as PromptObjectiveStep, false);

    const prompt = buildOrchestratorPrompt(station, build);

    expect(prompt).toContain('<current_objective>');
    expect(prompt).toContain('Description: Diagnose the relay fault in Docking Vestibule.');
    expect(prompt).not.toContain('Description: Reach the Escape Gantry.');
  });

  it('[M] keeps future hidden steps out of the prompt after many prior completions', () => {
    const station = createTestStation();
    const build = getBuild('engineer');
    station.objectives.steps.push({
      id: 'step_2',
      description: 'Restore final telemetry uplink.',
      roomId: 'room_1',
      requiredItemId: null,
      requiredSystemRepair: null,
      revealed: false,
      completed: false,
    });
    station.objectives.currentStepIndex = 1;
    station.objectives.steps[0].completed = true;
    setRevealed(station.objectives.steps[0] as PromptObjectiveStep, true);
    setRevealed(station.objectives.steps[1] as PromptObjectiveStep, true);
    setRevealed(station.objectives.steps[2] as PromptObjectiveStep, false);

    const prompt = buildOrchestratorPrompt(station, build);

    expect(prompt).toContain('Description: Reach the Escape Gantry.');
    expect(prompt).not.toContain('Restore final telemetry uplink.');
  });

  it('[B] switches to extraction-only guidance when currentStepIndex reaches the chain boundary', () => {
    const station = createTestStation();
    const build = getBuild('engineer');
    station.objectives.completed = true;
    station.objectives.currentStepIndex = station.objectives.steps.length;
    for (const step of station.objectives.steps as PromptObjectiveStep[]) {
      step.completed = true;
      setRevealed(step, true);
    }

    const prompt = buildOrchestratorPrompt(station, build);

    expect(prompt).toContain('All known mission steps are resolved. Extraction is now the only remaining objective.');
    expect(prompt).not.toContain('Description: Diagnose the relay fault in Docking Vestibule.');
  });

  it('[I] uses the current-objective contract and removes the full objective list wrapper', () => {
    const prompt = buildPromptFixture();
    expect(prompt).toContain('<current_objective>');
    expect(prompt).not.toContain('<objective_steps>');
    expect(prompt).toContain('Only the current revealed mission step is known to me at runtime.');
  });

  it('[E] excludes hidden completed future steps from the system prompt and rejects unrevealed text leakage', () => {
    const station = createTestStation();
    const build = getBuild('engineer');
    setRevealed(station.objectives.steps[0] as PromptObjectiveStep, true);
    setRevealed(station.objectives.steps[1] as PromptObjectiveStep, false);
    station.objectives.steps[1].completed = true;

    const prompt = buildOrchestratorPrompt(station, build);

    expect(prompt).not.toContain('Description: Reach the Escape Gantry.');
    expect(prompt).not.toContain('Reach the Escape Gantry.');
  });

  it('[S] includes location and blocker details for the standard active objective', () => {
    const prompt = buildPromptFixture();
    expect(prompt).toContain('Location: Docking Vestibule (room_0)');
    expect(prompt).toContain('Known blockers: repair **power_relay**');
  });
});
