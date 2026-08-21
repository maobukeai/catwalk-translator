import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ClipboardToast } from '../components/ClipboardToast';

describe('ClipboardToast passive-watch payload', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('shows the 自动监听 badge and disable button for watched payloads', () => {
    render(
      <ClipboardToast
        payload={{
          id: 'clip_watch_1',
          original: 'Subsurface Scattering',
          translated: '次表面散射',
          sourceTier: 'Preset',
          fromWatch: true,
        }}
        onClose={vi.fn()}
        onDisableWatch={vi.fn()}
      />
    );

    expect(screen.getByTestId('clipboard-watch-badge')).toBeInTheDocument();
    expect(screen.getByTestId('disable-watch-btn')).toBeInTheDocument();
    expect(screen.getByText('次表面散射')).toBeInTheDocument();
    expect(screen.getByText(/Subsurface Scattering/)).toBeInTheDocument();
  });

  it('hides the badge for plain hotkey-triggered payloads', () => {
    render(
      <ClipboardToast
        payload={{ id: 'clip_1', original: 'Roughness', translated: '粗糙度', sourceTier: 'llm' }}
        onClose={vi.fn()}
        onDisableWatch={vi.fn()}
      />
    );

    expect(screen.queryByTestId('clipboard-watch-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('disable-watch-btn')).not.toBeInTheDocument();
  });

  it('disable button invokes the handler (one-click stop watching)', () => {
    const onDisableWatch = vi.fn();
    render(
      <ClipboardToast
        payload={{ id: 'w', original: 'x y', translated: '译文', sourceTier: 't', fromWatch: true }}
        onClose={vi.fn()}
        onDisableWatch={onDisableWatch}
      />
    );

    fireEvent.click(screen.getByTestId('disable-watch-btn'));
    expect(onDisableWatch).toHaveBeenCalledTimes(1);
  });
});
