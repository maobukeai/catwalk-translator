import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import * as api from '../services/tauri';

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

it('keeps the translator input and result when a screenshot is cancelled', async () => {
  localStorage.setItem('catwalk_onboarding_v1', '1');
  vi.spyOn(api, 'cmdTranslatePhrasesStyled').mockResolvedValue([]);
  const translate = vi.spyOn(api, 'cmdUniversalTranslate').mockResolvedValue({
    original: 'Keep my draft', detectedLang: 'en', mainTranslation: '保留草稿',
    engines: [{ engineName: 'Bing', translated: '保留草稿', sourceTier: 'Online Fallback' }],
  });
  render(<App />);
  const input = await screen.findByRole('textbox', { name: '原文输入' });
  fireEvent.change(input, { target: { value: 'Keep my draft' } });
  await screen.findByText('保留草稿');
  const requestCount = translate.mock.calls.length;
  fireEvent(window, new Event('trigger-capture'));
  await screen.findByText(/猫步划词/);
  expect(screen.queryByRole('textbox', { name: '原文输入' })).not.toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
  await waitFor(() => expect(screen.getByRole('textbox', { name: '原文输入' })).toBe(input));
  expect(input).toHaveValue('Keep my draft');
  expect(screen.getByText('保留草稿')).toBeVisible();
  await act(async () => { await new Promise(r => setTimeout(r, 400)); });
  expect(translate).toHaveBeenCalledTimes(requestCount);
});
