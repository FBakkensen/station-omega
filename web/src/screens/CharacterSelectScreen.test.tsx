import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CharacterSelectScreen } from './CharacterSelectScreen';

describe('CharacterSelectScreen contracts', () => {
  afterEach(() => {
    cleanup();
  });

  it('[Z] keeps zero-selected class state with a disabled confirm control', () => {
    render(
      <CharacterSelectScreen
        selectedClass={null}
        selectedDifficulty="normal"
        onSelectClass={vi.fn()}
        onSelectDifficulty={vi.fn()}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    const confirmButton = screen.getByRole('button', { name: 'Select a Class' });
    expect(confirmButton).toBeDisabled();
    expect(screen.getByText('Select a crew member to view details')).toBeInTheDocument();
  });

  it('[O] selects one class and emits one callback with the matching class id', async () => {
    const user = userEvent.setup();
    const onSelectClass = vi.fn();

    render(
      <CharacterSelectScreen
        selectedClass={null}
        selectedDifficulty="normal"
        onSelectClass={onSelectClass}
        onSelectDifficulty={vi.fn()}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Systems Engineer/i }));

    expect(onSelectClass).toHaveBeenCalledTimes(1);
    expect(onSelectClass).toHaveBeenCalledWith('engineer');
  });

  it('[M] supports many selection updates across classes and difficulty options', async () => {
    const user = userEvent.setup();
    const onSelectClass = vi.fn();
    const onSelectDifficulty = vi.fn();

    render(
      <CharacterSelectScreen
        selectedClass={'engineer'}
        selectedDifficulty="normal"
        onSelectClass={onSelectClass}
        onSelectDifficulty={onSelectDifficulty}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Flight Surgeon/i }));
    await user.click(screen.getByRole('button', { name: /Station Commander/i }));
    await user.click(screen.getByRole('button', { name: 'Hard' }));
    await user.click(screen.getByRole('button', { name: 'Nightmare' }));

    const classCalls = onSelectClass.mock.calls as Array<['engineer' | 'scientist' | 'medic' | 'commander']>;
    const difficultyCalls = onSelectDifficulty.mock.calls as Array<['normal' | 'hard' | 'nightmare']>;
    expect(classCalls.map(([value]) => value)).toEqual(['medic', 'commander']);
    expect(difficultyCalls.map(([value]) => value)).toEqual(['hard', 'nightmare']);
  });

  it('[B] keeps boundary difficulty selection behavior stable for normal hard and nightmare labels', () => {
    render(
      <CharacterSelectScreen
        selectedClass={'scientist'}
        selectedDifficulty="nightmare"
        onSelectClass={vi.fn()}
        onSelectDifficulty={vi.fn()}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Normal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nightmare' })).toBeInTheDocument();
  });

  it('[I] renders interface detail fields for the currently selected build contract', () => {
    render(
      <CharacterSelectScreen
        selectedClass={'scientist'}
        selectedDifficulty="normal"
        onSelectClass={vi.fn()}
        onSelectDifficulty={vi.fn()}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getAllByText('Research Scientist').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Proficiencies')).toBeInTheDocument();
    expect(screen.getByText('Weaknesses')).toBeInTheDocument();
    expect(screen.getByText('Starting Item')).toBeInTheDocument();
    expect(screen.getByText('Inventory Slots')).toBeInTheDocument();
  });

  it('[E] prevents disabled confirm clicks and avoids error-prone premature progression', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <CharacterSelectScreen
        selectedClass={null}
        selectedDifficulty="normal"
        onSelectClass={vi.fn()}
        onSelectDifficulty={vi.fn()}
        onConfirm={onConfirm}
        onBack={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Select a Class' }));

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('[S] follows standard navigation flow for back and confirm when a class is selected', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onBack = vi.fn();

    render(
      <CharacterSelectScreen
        selectedClass={'engineer'}
        selectedDifficulty="normal"
        onSelectClass={vi.fn()}
        onSelectDifficulty={vi.fn()}
        onConfirm={onConfirm}
        onBack={onBack}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Continue/i }));
    await user.click(screen.getByRole('button', { name: /Back/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
