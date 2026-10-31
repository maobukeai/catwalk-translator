import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../stores/useSettingsStore';
import { DEFAULT_SETTINGS, DEFAULT_APPEARANCE } from '../services/defaultSettings';
import * as ipc from '../services/tauri';
import type { AppSettings } from '../services/types';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

describe('settings persistence ordering', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const settings = structuredClone(DEFAULT_SETTINGS);
    useSettingsStore.setState({ settings, initialSettings: settings, isDirty: false, isSaving: false, toastMessage: null });
  });

  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('serializes IPC writes and saves the newest snapshot after rapid changes', async () => {
    const first = deferred(), second = deferred();
    const save = vi.spyOn(ipc, 'cmdSaveSettings')
      .mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const store = useSettingsStore.getState();
    store.setAlwaysOnTop(true);
    store.setCloseAction('minimize');
    store.setAutoSilentUpdate(true);
    const complete = store.saveSettings();
    expect(save).toHaveBeenCalledTimes(1);
    first.resolve();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(useSettingsStore.getState().isDirty).toBe(true);
    expect(useSettingsStore.getState().isSaving).toBe(true);
    expect(save.mock.calls[1][0]).toMatchObject({ alwaysOnTop: true, closeAction: 'minimize', autoSilentUpdate: true });
    second.resolve();
    await complete;
    expect(useSettingsStore.getState().isDirty).toBe(false);
    expect(useSettingsStore.getState().isSaving).toBe(false);
  });

  it('keeps a pending slider edit dirty until the debounced snapshot is saved', async () => {
    vi.useFakeTimers();
    const first = deferred();
    const save = vi.spyOn(ipc, 'cmdSaveSettings').mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const store = useSettingsStore.getState();
    store.setAlwaysOnTop(true);
    store.setTtsRate(1.5);
    first.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(useSettingsStore.getState().isDirty).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].ttsRate).toBe(1.5);
    expect(useSettingsStore.getState().isDirty).toBe(false);
  });

  it('reports write failures and allows an explicit retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const save = vi.spyOn(ipc, 'cmdSaveSettings').mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, alwaysOnTop: true } });
    await useSettingsStore.getState().saveSettings();
    expect(useSettingsStore.getState().isDirty).toBe(true);
    expect(useSettingsStore.getState().toastMessage).toContain('保存失败');
    await useSettingsStore.getState().saveSettings();
    expect(save).toHaveBeenCalledTimes(2);
    expect(useSettingsStore.getState().isDirty).toBe(false);
  });

  it('fills missing legacy fields and keeps the Small OCR default', async () => {
    vi.spyOn(ipc, 'cmdGetSettings').mockResolvedValue({ theme: 'light', appearance: { theme: 'light' } } as AppSettings);
    await useSettingsStore.getState().fetchSettings();
    const settings = useSettingsStore.getState().settings;
    expect(settings.ocrVersion).toBe('v6');
    expect(settings.presetDicts).toEqual(DEFAULT_SETTINGS.presetDicts);
    expect(settings.appearance).toEqual({ ...DEFAULT_APPEARANCE, theme: 'light' });
  });

  it('does not replace edits made while a settings refresh is pending', async () => {
    let resolve!: (settings: AppSettings) => void;
    vi.spyOn(ipc, 'cmdGetSettings').mockReturnValue(new Promise((done) => { resolve = done; }));
    const refresh = useSettingsStore.getState().fetchSettings();
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, defaultPreset: 'maya' }, isDirty: true });
    resolve(structuredClone(DEFAULT_SETTINGS));
    await refresh;
    expect(useSettingsStore.getState().settings.defaultPreset).toBe('maya');
    expect(useSettingsStore.getState().isDirty).toBe(true);
    expect(useSettingsStore.getState().isLoading).toBe(false);
  });
});
