import { describe, expect, it } from 'vitest';
import { isCaptureOnlineEngine, resolveCaptureLlmConfig } from '../services/engineOptions';
import { useSettingsStore } from '../stores/useSettingsStore';
import type { LlmConfig } from '../services/types';

const model = (id: string, extra: Partial<LlmConfig> = {}): LlmConfig => ({
  id, provider: '', model: '', apiKey: 'test', endpoint: 'https://example.test/v1', ...extra,
});

describe('capture model identity', () => {
  it('does not let an empty provider or model steal a later selected model', () => {
    const first = model('first');
    const selected = model('chosen', { model: 'Chosen Model' });
    const settings = { ...useSettingsStore.getState().settings, llmConfig: first, llmConfigs: [first, selected] };
    expect(resolveCaptureLlmConfig(settings, 'llm:chosen')).toBe(selected);
    expect(resolveCaptureLlmConfig(settings, 'Chosen Model')).toBe(selected);
    expect(resolveCaptureLlmConfig(settings, 'llm:deleted')).toBeNull();
    expect(resolveCaptureLlmConfig(settings, 'google')).toBeNull();
  });

  it('chooses a ready model for auto and never runs a disabled model', () => {
    const disabled = model('disabled', { enabled: false });
    const unconfigured = model('empty', { apiKey: '' });
    const local = model('local', { endpoint: 'http://localhost:11434/v1', apiKey: '' });
    const settings = { ...useSettingsStore.getState().settings, llmConfig: disabled, llmConfigs: [disabled, unconfigured, local] };
    expect(resolveCaptureLlmConfig(settings, 'auto')).toBe(local);
    expect(resolveCaptureLlmConfig(settings, 'llm:disabled')).toBeNull();
    expect(isCaptureOnlineEngine('baiduLlm')).toBe(true);
    expect(isCaptureOnlineEngine('llm:chosen')).toBe(false);
    expect(isCaptureOnlineEngine('blender')).toBe(false);
  });
});
