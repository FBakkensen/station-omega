import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoadingScreen } from './LoadingScreen';

type ProgressDoc = {
  status: 'pending' | 'topology' | 'systems' | 'objectives' | 'creative' | 'assembly' | 'video' | 'complete' | 'error';
  message: string;
  progress: number;
  stationId?: string;
  error?: string;
};

const convexMocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
}));

vi.mock('convex/react', () => ({
  useQuery: convexMocks.useQuery,
}));

describe('LoadingScreen progress contracts', () => {
  let progressFixture: ProgressDoc | undefined;
  let logSpy: ReturnType<typeof vi.spyOn> | null = null;
  let errorSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    progressFixture = undefined;
    convexMocks.useQuery.mockImplementation(() => progressFixture);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    logSpy?.mockRestore();
    errorSpy?.mockRestore();
    logSpy = null;
    errorSpy = null;
  });

  it('[Z] shows zero-terminal loading state when progress is undefined and fires no callbacks', async () => {
    const onComplete = vi.fn();
    const onError = vi.fn();

    render(
      <LoadingScreen
        progressId={'progress_zero' as never}
        onComplete={onComplete}
        onError={onError}
      />,
    );

    expect(screen.getByText('Generating Station')).toBeInTheDocument();
    expect(screen.getByText('Initializing...')).toBeInTheDocument();
    await waitFor(() => {
      expect(onComplete).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });
  });

  it('[O] calls onComplete once for one complete status with a station id', async () => {
    progressFixture = {
      status: 'complete',
      message: 'done',
      progress: 100,
      stationId: 'station_done',
    };
    const onComplete = vi.fn();
    const onError = vi.fn();

    render(
      <LoadingScreen
        progressId={'progress_one' as never}
        onComplete={onComplete}
        onError={onError}
      />,
    );

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    expect(onComplete).toHaveBeenCalledWith('station_done');
    expect(onError).not.toHaveBeenCalled();
  });

  it('[M] handles many non-terminal statuses without triggering completion or error callbacks', async () => {
    const onComplete = vi.fn();
    const onError = vi.fn();
    const view = render(
      <LoadingScreen
        progressId={'progress_many' as never}
        onComplete={onComplete}
        onError={onError}
      />,
    );

    const sequence: ProgressDoc[] = [
      { status: 'topology', message: 'Designing station layout...', progress: 10 },
      { status: 'systems', message: 'Engineering system failures...', progress: 30 },
      { status: 'objectives', message: 'Designing mission objectives...', progress: 50 },
      { status: 'creative', message: 'Generating creative content...', progress: 70 },
      { status: 'assembly', message: 'Assembling station data...', progress: 90 },
      { status: 'video', message: 'Generating briefing video...', progress: 95 },
    ];

    for (const next of sequence) {
      progressFixture = next;
      view.rerender(
        <LoadingScreen
          progressId={'progress_many' as never}
          onComplete={onComplete}
          onError={onError}
        />,
      );
    }

    await waitFor(() => {
      expect(onComplete).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });
  });

  it('[B] preserves progress-bar boundary rendering at 0% and 100% widths', () => {
    progressFixture = {
      status: 'pending',
      message: 'pending',
      progress: 0,
    };
    const onComplete = vi.fn();
    const onError = vi.fn();
    const view = render(
      <LoadingScreen
        progressId={'progress_boundary' as never}
        onComplete={onComplete}
        onError={onError}
      />,
    );

    expect(view.container.querySelector('[style="width: 0%;"]')).toBeTruthy();

    progressFixture = {
      status: 'complete',
      message: 'done',
      progress: 100,
      stationId: 'station_boundary',
    };
    view.rerender(
      <LoadingScreen
        progressId={'progress_boundary' as never}
        onComplete={onComplete}
        onError={onError}
      />,
    );

    expect(view.container.querySelector('[style="width: 100%;"]')).toBeTruthy();
  });

  it('[I] preserves loading-screen interface elements including stage indicators and progress id text', () => {
    progressFixture = {
      status: 'systems',
      message: 'Engineering system failures...',
      progress: 35,
    };

    render(
      <LoadingScreen
        progressId={'progress_interface' as never}
        onComplete={vi.fn()}
        onError={vi.fn()}
      />,
    );

    expect(screen.getByText('Generating Station')).toBeInTheDocument();
    expect(screen.getByText('Engineering system failures...')).toBeInTheDocument();
    expect(screen.getByText('Progress ID: progress_interface')).toBeInTheDocument();
  });

  it('[E] calls onError for explicit error status and renders diagnostic error text', async () => {
    progressFixture = {
      status: 'error',
      message: 'Station generation failed',
      progress: 0,
      error: 'OpenRouter unavailable',
    };
    const onComplete = vi.fn();
    const onError = vi.fn();

    render(
      <LoadingScreen
        progressId={'progress_error' as never}
        onComplete={onComplete}
        onError={onError}
      />,
    );

    await waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('Error: OpenRouter unavailable')).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('[S] follows standard stage progression and completes only at terminal complete state', async () => {
    const onComplete = vi.fn();
    const onError = vi.fn();
    const view = render(
      <LoadingScreen
        progressId={'progress_standard' as never}
        onComplete={onComplete}
        onError={onError}
      />,
    );

    progressFixture = {
      status: 'topology',
      message: 'Designing station layout...',
      progress: 10,
    };
    view.rerender(
      <LoadingScreen
        progressId={'progress_standard' as never}
        onComplete={onComplete}
        onError={onError}
      />,
    );

    progressFixture = {
      status: 'complete',
      message: 'ready',
      progress: 100,
      stationId: 'station_standard',
    };
    view.rerender(
      <LoadingScreen
        progressId={'progress_standard' as never}
        onComplete={onComplete}
        onError={onError}
      />,
    );

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith('station_standard');
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });
});
