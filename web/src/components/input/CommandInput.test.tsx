import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandInput } from './CommandInput';

describe('CommandInput behavior contracts', () => {
  afterEach(() => {
    cleanup();
  });

  it('[Z] blocks submission for zero-content whitespace input', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<CommandInput onSubmit={onSubmit} />);

    const input = screen.getByPlaceholderText('What do you do?');
    await user.type(input, '   ');
    await user.keyboard('{Enter}');

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('[O] submits one trimmed command with Enter and clears the input field', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<CommandInput onSubmit={onSubmit} />);

    const input = screen.getByPlaceholderText('What do you do?');
    await user.type(input, '  stabilize relay  ');
    await user.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('stabilize relay');
    expect(input).toHaveValue('');
  });

  it('[M] handles many sequential command submissions through repeated input cycles', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<CommandInput onSubmit={onSubmit} />);

    const input = screen.getByPlaceholderText('What do you do?');
    await user.type(input, 'scan panel');
    await user.keyboard('{Enter}');
    await user.type(input, 'reroute bus');
    await user.keyboard('{Enter}');
    await user.type(input, 'seal breach');
    await user.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledTimes(3);
    const submittedCalls = onSubmit.mock.calls as Array<[string]>;
    expect(submittedCalls.map(([value]) => value)).toEqual([
      'scan panel',
      'reroute bus',
      'seal breach',
    ]);
  });

  it('[B] enforces disabled and empty boundaries by preventing submit and disabling send button', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { rerender } = render(<CommandInput onSubmit={onSubmit} />);

    const sendButton = screen.getByRole('button', { name: 'Send' });
    expect(sendButton).toBeDisabled();

    rerender(<CommandInput onSubmit={onSubmit} disabled />);
    const disabledInput = screen.getByPlaceholderText('Processing...');
    const disabledButton = screen.getByRole('button', { name: 'Send' });
    await user.type(disabledInput, 'repair');
    await user.click(disabledButton);

    expect(disabledButton).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('[I] preserves placeholder interface behavior for default, custom, and processing states', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<CommandInput onSubmit={onSubmit} />);

    expect(screen.getByPlaceholderText('What do you do?')).toBeInTheDocument();

    rerender(<CommandInput onSubmit={onSubmit} placeholder="Issue command" />);
    expect(screen.getByPlaceholderText('Issue command')).toBeInTheDocument();

    rerender(<CommandInput onSubmit={onSubmit} disabled placeholder="Ignored custom placeholder" />);
    expect(screen.getByPlaceholderText('Processing...')).toBeInTheDocument();
  });

  it('[E] ignores non-submit keys and avoids accidental error-prone command dispatch', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<CommandInput onSubmit={onSubmit} />);

    const input = screen.getByPlaceholderText('What do you do?');
    await user.type(input, 'check status');
    await user.keyboard('{Escape}');

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('[S] follows standard click-send flow for ordinary command submission', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<CommandInput onSubmit={onSubmit} />);

    const input = screen.getByPlaceholderText('What do you do?');
    await user.type(input, 'deploy patch');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('deploy patch');
  });
});
