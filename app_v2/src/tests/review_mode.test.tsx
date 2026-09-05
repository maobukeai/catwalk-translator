import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { HistoryPanel } from '../components/Vocabulary/HistoryPanel';
import { createMockIpcHarness, getActiveHarness } from './harness/tauriIpcMock';
import type { HistoryItem } from '../services/types';

const REVIEW_KEY = 'maobu_review_progress_v1';

const ITEMS: HistoryItem[] = [
  { id: 'h1', original: 'Principled BSDF', translated: '原理化 BSDF', sourceTier: 'Preset', timestamp: '2026/08/16 10:00', isFavorite: true },
  { id: 'h2', original: 'Roughness', translated: '粗糙度', sourceTier: 'Preset', timestamp: '2026/08/16 10:01', isFavorite: true },
  { id: 'h3', original: 'Transient Lookup', translated: '临时查询', sourceTier: 'llm', timestamp: '2026/08/16 10:02', isFavorite: false },
];

function wirePanel(items: HistoryItem[] = ITEMS) {
  createMockIpcHarness();
  (getActiveHarness()!.invokeMock as any).mockImplementation(async (cmd: string, args?: any): Promise<any> => {
    switch (cmd) {
      case 'cmd_get_history':
        return items;
      case 'cmd_toggle_favorite':
        return true;
      case 'cmd_delete_history_entry':
      case 'cmd_clear_history':
      case 'cmd_clear_capture_sessions':
      case 'cmd_save_capture_session':
        return null;
      case 'cmd_get_capture_sessions':
        return [];
      case 'cmd_export_anki':
        return 'original,translated\n';
      case 'cmd_get_settings':
        return { theme: 'system', hotkey: 'F4', defaultPreset: 'blender', llmConfig: null, translationTiers: [], presetDicts: {} };
      default:
        return null;
    }
  });
  (window as any).__TAURI_INTERNALS__ = {};
}

const pressKey = (key: string, code: string, init: KeyboardEventInit = {}) =>
  fireEvent(window, new KeyboardEvent('keydown', { key, code, bubbles: true, ...init }));

describe('vocabulary review mode (Leitner flashcards)', () => {
  beforeAll(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    (window as any).speechSynthesis = { cancel: vi.fn(), speak: vi.fn() };
    (window as any).SpeechSynthesisUtterance = class { text = ''; lang = ''; constructor(t: string) { this.text = t; } };
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (window as any).__TAURI_INTERNALS__;
    window.localStorage.clear();
  });

  it('review pool = favourites only; non-favourites never enter the queue', async () => {
    // Seed: h1 never reviewed (due), h2 reviewed to box 4 recently (not due for days)
    window.localStorage.setItem(REVIEW_KEY, JSON.stringify({
      h2: { box: 4, lastReviewedAt: Date.now() },
    }));
    wirePanel();

    render(<HistoryPanel />);
    await screen.findByText('Principled BSDF');

    // 待复习 stat counts only h1
    expect(screen.getByText('待复习')).toBeInTheDocument();
    const startBtn = screen.getByText(/开始复习 \(1\)/).closest('button') as HTMLElement;
    expect(startBtn).not.toBeDisabled();

    fireEvent.click(startBtn);
    await screen.findByText('生词复习');
    // Only h1 is queued (h2 not due, h3 not a favourite): pill reads 1 / 1
    expect(screen.getByText('1 / 1')).toBeInTheDocument();

    // Space reveals the answer — the grading buttons appear
    pressKey(' ', 'Space');
    await screen.findByText('不认识');

    // Grade 3 (认识) → queue exhausted → finished summary
    pressKey('3', 'Digit3');
    await screen.findByText('本轮复习完成');
    expect(screen.getByText(/认识/)).toBeInTheDocument();

    // Progress persisted: h1 advanced out of box 0 → due badge becomes future-dated
    const stored = JSON.parse(window.localStorage.getItem(REVIEW_KEY)!);
    expect(stored.h1.box).toBeGreaterThanOrEqual(1);
  });

  it('grading 不认识 resets the box to 0', async () => {
    window.localStorage.setItem(REVIEW_KEY, JSON.stringify({
      h2: { box: 3, lastReviewedAt: Date.now() - 20 * 86_400_000 }, // long overdue
    }));
    wirePanel();

    render(<HistoryPanel />);
    await screen.findByText('Roughness');

    fireEvent.click(screen.getByText(/开始复习/).closest('button') as HTMLElement);
    await screen.findByText('生词复习');
    // Both favourites are due: h1 (new) + h2 (overdue)
    expect(screen.getByText('1 / 2')).toBeInTheDocument();

    const gradeCard = async (key: string) => {
      pressKey(' ', 'Space');
      await screen.findByText('不认识');
      pressKey(key, key === '1' ? 'Digit1' : 'Digit3');
    };

    await gradeCard('1'); // h1 忘记
    await waitFor(() => screen.getByText('2 / 2'));
    await gradeCard('1'); // h2 忘记
    await screen.findByText('本轮复习完成');

    const stored = JSON.parse(window.localStorage.getItem(REVIEW_KEY)!);
    expect(stored.h2.box).toBe(0);
    expect(stored.h1.box).toBe(0);
  });

  it('Esc exits the review session', async () => {
    wirePanel();
    render(<HistoryPanel />);
    await screen.findByText('Principled BSDF');

    fireEvent.click(screen.getByText(/开始复习/).closest('button') as HTMLElement);
    await screen.findByText('生词复习');

    pressKey('Escape', 'Escape');
    await waitFor(() => {
      expect(screen.queryByText('生词复习')).not.toBeInTheDocument();
    });
  });

  it('favourite rows show a next-due badge; new words read 新词', async () => {
    wirePanel();
    render(<HistoryPanel />);
    await screen.findByText('Principled BSDF');

    expect(screen.getByTestId('due-badge-h1').textContent).toContain('新词');
    expect(screen.getByTestId('due-badge-h2').textContent).toContain('新词');
    expect(screen.queryByTestId('due-badge-h3')).not.toBeInTheDocument();
  });

  it('no favourites → review disabled with guidance', async () => {
    wirePanel(ITEMS.map((i) => ({ ...i, isFavorite: false })));
    render(<HistoryPanel />);
    await screen.findByText(/生词本暂无收藏/);

    const startBtn = screen.getByText('开始复习').closest('button') as HTMLElement;
    expect(startBtn).toBeDisabled();
    expect(startBtn.getAttribute('title')).toContain('收藏');

    // Switch to 查询历史 sub-tab to see non-favourited history entries
    const historyTabBtn = screen.getByText('🕒 查询历史').closest('button') as HTMLElement;
    fireEvent.click(historyTabBtn);
    await screen.findByText('Transient Lookup');
  });
});
