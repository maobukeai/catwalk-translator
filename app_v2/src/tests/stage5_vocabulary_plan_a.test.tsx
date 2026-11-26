import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { HistoryPanel } from '../components/Vocabulary/HistoryPanel';
import { AnkiSyncModal } from '../components/Vocabulary/AnkiSyncModal';
import { createMockIpcHarness, getActiveHarness } from './harness/tauriIpcMock';
import type { HistoryItem } from '../services/types';

const SAMPLE_ITEMS: HistoryItem[] = [
  {
    id: 'v1',
    original: 'Subsurface Scattering',
    translated: '次表面散射',
    sourceTier: 'Blender',
    timestamp: '2026/09/05 10:00',
    isFavorite: true,
  },
  {
    id: 'v2',
    original: 'Ambient Occlusion',
    translated: '环境光遮蔽',
    sourceTier: 'Blender',
    timestamp: '2026/09/05 10:05',
    isFavorite: true,
  },
];

function setupIpc() {
  createMockIpcHarness();
  let clipboardCleared = false;
  (getActiveHarness()!.invokeMock as any).mockImplementation(async (cmd: string): Promise<any> => {
    switch (cmd) {
      case 'cmd_get_history':
        return SAMPLE_ITEMS.map((x) => ({ ...x }));
      case 'cmd_get_capture_sessions':
        return [];
      case 'cmd_get_clipboard_history':
        return clipboardCleared
          ? []
          : [
              {
                original: 'Normal Map',
                translated: '法线贴图',
                sourceTier: 'Preset',
                atMs: Date.now(),
              },
            ];
      case 'cmd_clear_clipboard_history':
        clipboardCleared = true;
        return null;
      case 'cmd_anki_check_connection':
        return {
          connected: false,
          version: 0,
          decks: [],
          models: [],
          message: 'offline',
        };
      case 'cmd_get_settings':
        return { theme: 'system', hotkey: 'F4', defaultPreset: 'blender', llmConfig: null, translationTiers: [], presetDicts: {} };
      default:
        return null;
    }
  });
  (window as any).__TAURI_INTERNALS__ = {};
  return () => clipboardCleared;
}

describe('Stage 5 Plan B: HistoryPanel & AnkiSyncModal 学习工作台升级', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete (window as any).__TAURI_INTERNALS__;
    localStorage.clear();
  });

  it('renders left learning workspace sidebar with dense list and eliminates duplicate floating batch portal bar', async () => {
    setupIpc();
    render(<HistoryPanel />);

    await screen.findByText('Subsurface Scattering');
    const sidebar = screen.getByTestId('vocab-workspace-sidebar');
    expect(within(sidebar).getByText('我的生词本')).toBeInTheDocument();
    expect(within(sidebar).getByText('待复习')).toBeInTheDocument();
    expect(within(sidebar).getByText(/已掌握 0 \/ 2 词/)).toBeInTheDocument();

    const denseList = screen.getByTestId('vocab-dense-list');
    expect(within(denseList).getByText('Subsurface Scattering')).toBeInTheDocument();

    // Toggle batch mode on: only a single inline batch bar exists
    fireEvent.click(screen.getByTestId('batch-mode-toggle'));
    expect(screen.getAllByTestId('batch-selected-count')).toHaveLength(1);
    expect(screen.queryByTestId('batch-selected-count-floating')).not.toBeInTheDocument();
  });

  it('supports clicking the 3D flashcard to flip and reveal grading buttons', async () => {
    setupIpc();
    render(<HistoryPanel />);

    await screen.findByText('Subsurface Scattering');
    fireEvent.click(screen.getByText(/开始复习/).closest('button')!);

    const flipCard = await screen.findByTestId('review-flip-card');
    expect(flipCard.className).not.toContain('is-flipped');

    fireEvent.click(flipCard);
    expect(flipCard.className).toContain('is-flipped');
    expect(screen.getByText('不认识')).toBeInTheDocument();
    expect(screen.getByText('模糊')).toBeInTheDocument();
    expect(screen.getByText('认识')).toBeInTheDocument();
  });

  it('uses custom Vision confirm modal instead of window.confirm when clearing clipboard history', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => false);
    const isCleared = setupIpc();
    render(<HistoryPanel />);

    await screen.findByText('Subsurface Scattering');
    fireEvent.click(screen.getByTestId('subtab-clipboard'));

    expect(await screen.findByText('法线贴图')).toBeInTheDocument();
    const clearBtn = within(screen.getByTestId('clipboard-history-section')).getByRole('button', { name: /清空/ });
    fireEvent.click(clearBtn);

    expect(confirmSpy).not.toHaveBeenCalled();
    const modalSubmit = await screen.findByTestId('confirm-dialog-submit');
    fireEvent.click(modalSubmit);

    await waitFor(() => {
      expect(isCleared()).toBe(true);
    });
  });

  it('renders AnkiSyncModal via React Portal into document.body with glass shell and null-safe copy', async () => {
    setupIpc();
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });

    try {
      const { container } = render(
        <AnkiSyncModal isOpen={true} onClose={vi.fn()} items={SAMPLE_ITEMS} />
      );

      const modal = await screen.findByTestId('anki-sync-modal');
      expect(modal.className).toContain('vision-modal-shell');
      // Mounted to document.body via createPortal, not inside component root container
      expect(container.contains(modal)).toBe(false);
      expect(document.body.contains(modal)).toBe(true);

      const copyCodeBtn = await screen.findByText('2055492159');
      expect(() => fireEvent.click(copyCodeBtn)).not.toThrow();
    } finally {
      Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
    }
  });
});
