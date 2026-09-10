import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DualPaneTranslator } from '../components/MainWindow/DualPaneTranslator';
import * as tauriService from '../services/tauri';
import { DEFAULT_SETTINGS } from '../services/defaultSettings';

const mockTransResponse = {
  original: 'Hello world',
  detectedLang: 'en' as const,
  mainTranslation: '你好世界',
  engines: [
    {
      engineName: 'Google 翻译',
      translated: '你好世界',
      sourceTier: 'Online Fallback',
    },
  ],
};

describe('Language Selection Retention Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(tauriService, 'cmdUniversalTranslate').mockResolvedValue(mockTransResponse);
  });

  it('preserves user manual target language choice when source language is auto', async () => {
    render(
      <DualPaneTranslator settings={DEFAULT_SETTINGS} initialText="Hello world" />
    );

    await waitFor(() => {
      expect(screen.getByText('Hello world')).toBeInTheDocument();
    });

    // Find the target dropdown trigger
    const targetTrigger = screen.getByRole('button', { name: /简体中文 \(Chinese\)/i });
    expect(targetTrigger).toBeInTheDocument();

    // Open target dropdown
    fireEvent.click(targetTrigger);

    // The popover contains the search placeholder
    const searchInput = await screen.findByPlaceholderText(/搜索语言名称或代码/i);
    expect(searchInput).toBeInTheDocument();

    // Filter by typing 'en'
    fireEvent.change(searchInput, { target: { value: 'en' } });

    // The filtered option for English
    const option = await screen.findByText('英语 (English)');
    const optionButton = option.closest('button');
    expect(optionButton).not.toBeNull();
    fireEvent.click(optionButton!);

    // Verify target language dropdown now shows "英语 (English)"
    await waitFor(() => {
      const targetLabel = screen.getByText('目标语言：');
      const targetBtn = targetLabel.parentElement?.querySelector('button');
      expect(targetBtn?.textContent).toContain('英语 (English)');
    });

    // Wait past debounce timer (350ms) to ensure it does NOT revert to "简体中文 (Chinese)"
    await new Promise((r) => setTimeout(r, 450));

    // Confirm target language is STILL "英语 (English)"
    const targetLabelAfter = screen.getByText('目标语言：');
    const targetBtnAfter = targetLabelAfter.parentElement?.querySelector('button');
    expect(targetBtnAfter?.textContent).toContain('英语 (English)');
  });
});