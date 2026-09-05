import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { HistoryPanel } from '../components/Vocabulary/HistoryPanel';
import { createMockIpcHarness, getActiveHarness } from './harness/tauriIpcMock';
import type { HistoryItem } from '../services/types';

const INITIAL_ITEMS: HistoryItem[] = [
  { id: 'v1', original: 'Subsurface Scattering', translated: '次表面散射', sourceTier: 'Preset', timestamp: '2026/09/04 10:00', isFavorite: true },
  { id: 'v2', original: 'Ambient Occlusion', translated: '环境光遮蔽', sourceTier: 'Preset', timestamp: '2026/09/04 10:01', isFavorite: true },
  { id: 'h1', original: 'Hello World', translated: '你好世界', sourceTier: 'google', timestamp: '2026/09/04 10:02', isFavorite: false },
  { id: 'h2', original: 'Random OCR snippet', translated: '随机截图碎片', sourceTier: 'ocr', timestamp: '2026/09/04 10:03', isFavorite: false },
];

describe('Vocabulary and History physical separation', () => {
  let mockHistoryState: HistoryItem[];

  beforeAll(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    (window as any).speechSynthesis = { cancel: vi.fn(), speak: vi.fn() };
    (window as any).SpeechSynthesisUtterance = class { text = ''; lang = ''; constructor(t: string) { this.text = t; } };
    vi.spyOn(window, 'confirm').mockImplementation(() => true);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (window as any).__TAURI_INTERNALS__;
    window.localStorage.clear();
  });

  function setupPanel(items = INITIAL_ITEMS) {
    mockHistoryState = items.map((i) => ({ ...i }));
    createMockIpcHarness();
    (getActiveHarness()!.invokeMock as any).mockImplementation(async (cmd: string, args?: any): Promise<any> => {
      switch (cmd) {
        case 'cmd_get_history':
          return mockHistoryState.map((i) => ({ ...i }));
        case 'cmd_toggle_favorite': {
          mockHistoryState = mockHistoryState.map((i) =>
            i.id === args?.id ? { ...i, isFavorite: !i.isFavorite } : i
          );
          return true;
        }
        case 'cmd_clear_unfavorited_history': {
          mockHistoryState = mockHistoryState.filter((i) => i.isFavorite);
          return null;
        }
        case 'cmd_clear_history': {
          mockHistoryState = [];
          return null;
        }
        case 'cmd_delete_history_entry': {
          mockHistoryState = mockHistoryState.filter((i) => i.id !== args?.id);
          return null;
        }
        case 'cmd_delete_history_entries': {
          const ids: string[] = args?.ids || [];
          const idSet = new Set(ids);
          mockHistoryState = mockHistoryState.filter((i) => !idSet.has(i.id));
          return ids.length;
        }
        case 'cmd_batch_set_favorite': {
          const ids: string[] = args?.ids || [];
          const isFav: boolean = args?.isFavorite ?? false;
          const idSet = new Set(ids);
          mockHistoryState = mockHistoryState.map((i) =>
            idSet.has(i.id) ? { ...i, isFavorite: isFav } : i
          );
          return ids.length;
        }
        case 'cmd_get_capture_sessions':
          return [];
        case 'cmd_get_clipboard_history':
          return [];
        case 'cmd_export_anki':
          return 'csv-data';
        case 'cmd_get_settings':
          return { theme: 'system', hotkey: 'F4', defaultPreset: 'blender', llmConfig: null, translationTiers: [], presetDicts: {} };
        default:
          return null;
      }
    });
    (window as any).__TAURI_INTERNALS__ = {};
  }

  it('defaults to "我的生词本" tab and displays ONLY favorited items', async () => {
    setupPanel();
    render(<HistoryPanel />);

    // Favorited items should be visible
    await screen.findByText('Subsurface Scattering');
    expect(screen.getByText('Ambient Occlusion')).toBeInTheDocument();

    // Non-favorited history items must NOT be visible under "我的生词本"
    expect(screen.queryByText('Hello World')).not.toBeInTheDocument();
    expect(screen.queryByText('Random OCR snippet')).not.toBeInTheDocument();

    // Stats header check
    expect(screen.getByText(/已收藏 2 条生词/)).toBeInTheDocument();
  });

  it('switches to "查询历史" tab and displays all history items', async () => {
    setupPanel();
    render(<HistoryPanel />);

    await screen.findByText('Subsurface Scattering');

    // Click "🕒 查询历史" subtab
    const historySubTabBtn = screen.getByText('🕒 查询历史').closest('button') as HTMLElement;
    fireEvent.click(historySubTabBtn);

    // Now all items should be visible
    await screen.findByText('Hello World');
    expect(screen.getByText('Random OCR snippet')).toBeInTheDocument();
    expect(screen.getByText('Subsurface Scattering')).toBeInTheDocument();
    expect(screen.getByText('Ambient Occlusion')).toBeInTheDocument();

    // Header says 查询历史记录
    expect(screen.getByText('查询历史记录')).toBeInTheDocument();
    expect(screen.getByText(/已保存 4 条查询记录/)).toBeInTheDocument();
  });

  it('can clear unfavorited history safely without affecting favorites', async () => {
    setupPanel();
    render(<HistoryPanel />);

    await screen.findByText('Subsurface Scattering');

    // Switch to history tab
    const historySubTabBtn = screen.getByText('🕒 查询历史').closest('button') as HTMLElement;
    fireEvent.click(historySubTabBtn);
    await screen.findByText('Hello World');

    // Click "清空未收藏历史" button
    const clearUnfavBtn = screen.getByText('清空未收藏历史').closest('button') as HTMLElement;
    expect(clearUnfavBtn).not.toBeDisabled();
    fireEvent.click(clearUnfavBtn);

    // Confirm in custom React modal
    const confirmClearBtn = await screen.findByTestId('confirm-dialog-submit');
    fireEvent.click(confirmClearBtn);

    // After clearing, non-favorites are gone
    await waitFor(() => {
      expect(screen.queryByText('Hello World')).not.toBeInTheDocument();
      expect(screen.queryByText('Random OCR snippet')).not.toBeInTheDocument();
    });

    // Favorites are preserved!
    expect(screen.getByText('Subsurface Scattering')).toBeInTheDocument();
    expect(screen.getByText('Ambient Occlusion')).toBeInTheDocument();

    // Switch back to "⭐ 我的生词本"
    const vocabTabBtn = screen.getByText('⭐ 我的生词本').closest('button') as HTMLElement;
    fireEvent.click(vocabTabBtn);

    // Favorites are still intact in Vocabulary tab
    expect(screen.getByText('Subsurface Scattering')).toBeInTheDocument();
    expect(screen.getByText('Ambient Occlusion')).toBeInTheDocument();
  });

  it('toggling favorite on an item removes it from "我的生词本" view', async () => {
    setupPanel();
    render(<HistoryPanel />);

    await screen.findByText('Subsurface Scattering');

    // Click favorite toggle star button for 'v1'
    const starBtn = screen.getByTestId('fav-toggle-v1');
    expect(starBtn).toBeInTheDocument();

    fireEvent.click(starBtn);

    // It should now disappear from vocabulary view since it is no longer a favorite
    await waitFor(() => {
      expect(screen.queryByText('Subsurface Scattering')).not.toBeInTheDocument();
    });

    // But Ambient Occlusion remains
    expect(screen.getByText('Ambient Occlusion')).toBeInTheDocument();
  });

  it('enters batch mode, selects all items, and batch unfavorites items from "我的生词本" preserving them in "查询历史"', async () => {
    setupPanel();
    render(<HistoryPanel />);

    await screen.findByText('Subsurface Scattering');
    expect(screen.getByText('Ambient Occlusion')).toBeInTheDocument();

    // Click "批量管理" button to enter batch mode
    const batchToggle = screen.getByTestId('batch-mode-toggle');
    fireEvent.click(batchToggle);

    // Floating batch bar appears
    expect(screen.getByTestId('batch-selected-count')).toHaveTextContent('0 / 2');
    expect(screen.getByTestId('batch-select-all')).toBeInTheDocument();

    // Click "全选当前"
    fireEvent.click(screen.getByTestId('batch-select-all'));
    expect(screen.getByTestId('batch-selected-count')).toHaveTextContent('2 / 2');

    // Click "移出生词本 (2)"
    const unfavBtn = screen.getByTestId('batch-unfavorite-btn');
    expect(unfavBtn).not.toBeDisabled();
    fireEvent.click(unfavBtn);

    // Both items are removed from vocabulary view
    await waitFor(() => {
      expect(screen.queryByText('Subsurface Scattering')).not.toBeInTheDocument();
      expect(screen.queryByText('Ambient Occlusion')).not.toBeInTheDocument();
    });

    // Switch to "查询历史" tab - both items are STILL there!
    const historySubTabBtn = screen.getByText('🕒 查询历史').closest('button') as HTMLElement;
    fireEvent.click(historySubTabBtn);

    await screen.findByText('Subsurface Scattering');
    expect(screen.getByText('Ambient Occlusion')).toBeInTheDocument();
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('in "查询历史" tab, can select items and batch add them to生词本 (favorite)', async () => {
    setupPanel();
    render(<HistoryPanel />);

    // Switch to history tab
    const historySubTabBtn = screen.getByText('🕒 查询历史').closest('button') as HTMLElement;
    fireEvent.click(historySubTabBtn);
    await screen.findByText('Hello World');

    // Enter batch mode
    const batchToggle = screen.getByTestId('batch-mode-toggle');
    fireEvent.click(batchToggle);

    // Click checkbox for Hello World ('h1') and Random OCR snippet ('h2')
    const cbH1 = screen.getByTestId('batch-checkbox-h1');
    const cbH2 = screen.getByTestId('batch-checkbox-h2');
    fireEvent.click(cbH1);
    fireEvent.click(cbH2);

    expect(screen.getByTestId('batch-selected-count')).toHaveTextContent('2 / 4');

    // Click "加入生词本 (2)"
    const favBtn = screen.getByTestId('batch-favorite-btn');
    fireEvent.click(favBtn);

    // Switch back to "⭐ 我的生词本"
    const vocabTabBtn = screen.getByText('⭐ 我的生词本').closest('button') as HTMLElement;
    fireEvent.click(vocabTabBtn);

    // Now Hello World and Random OCR snippet are in Vocabulary tab!
    await screen.findByText('Hello World');
    expect(screen.getByText('Random OCR snippet')).toBeInTheDocument();
  });

  it('can batch delete items permanently from database', async () => {
    setupPanel();
    render(<HistoryPanel />);

    await screen.findByText('Subsurface Scattering');

    // Enter batch mode
    const batchToggle = screen.getByTestId('batch-mode-toggle');
    fireEvent.click(batchToggle);

    // Select 'v1' (Subsurface Scattering)
    const cbV1 = screen.getByTestId('batch-checkbox-v1');
    fireEvent.click(cbV1);

    // Click "彻底删除 (1)"
    const deleteBtn = screen.getByTestId('batch-delete-btn');
    fireEvent.click(deleteBtn);

    // Confirm in custom React modal
    const confirmDeleteBtn = await screen.findByTestId('confirm-dialog-submit');
    fireEvent.click(confirmDeleteBtn);

    // Subsurface Scattering is permanently removed
    await waitFor(() => {
      expect(screen.queryByText('Subsurface Scattering')).not.toBeInTheDocument();
    });

    // Check in "查询历史" - it's also gone from history!
    const historySubTabBtn = screen.getByText('🕒 查询历史').closest('button') as HTMLElement;
    fireEvent.click(historySubTabBtn);

    await screen.findByText('Ambient Occlusion');
    expect(screen.queryByText('Subsurface Scattering')).not.toBeInTheDocument();
  });
});
