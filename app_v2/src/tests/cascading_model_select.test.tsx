import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CascadingModelSelect } from '../components/MainWindow/CascadingModelSelect';
import type { LlmConfig } from '../services/types';

describe('CascadingModelSelect Component', () => {
  const mockVendorGroups = [
    {
      vendor: 'DeepSeek',
      models: [
        {
          id: 'ds-v3',
          provider: 'DeepSeek',
          model: 'deepseek-chat',
          apiKey: 'key-1',
          endpoint: 'https://api.deepseek.com',
        } as LlmConfig,
        {
          id: 'ds-r1',
          provider: 'DeepSeek',
          model: 'deepseek-reasoner',
          apiKey: 'key-1',
          endpoint: 'https://api.deepseek.com',
        } as LlmConfig,
      ],
    },
    {
      vendor: 'Google Gemini',
      models: [
        {
          id: 'gemini-flash',
          provider: 'Custom',
          model: 'gemini-2.5-flash',
          apiKey: 'key-2',
          endpoint: 'https://gateway.ai/google',
        } as LlmConfig,
      ],
    },
    {
      vendor: 'Ollama (本地私有化)',
      models: [
        {
          id: 'ollama-qwen',
          provider: 'Ollama',
          model: 'qwen2.5:7b',
          apiKey: '',
          endpoint: 'http://localhost:11434',
        } as LlmConfig,
      ],
    },
  ];

  const getKey = (cfg: Partial<LlmConfig>) => cfg.id || cfg.model || '';

  it('renders trigger button with current active vendor and model label', () => {
    render(
      <CascadingModelSelect
        activeVendor="DeepSeek"
        activeModelLabel="deepseek-chat"
        activeModelKey="ds-v3"
        vendorGroups={mockVendorGroups}
        onSelectModel={vi.fn()}
        getConfigKey={getKey}
      />
    );

    const button = screen.getByTestId('cascading-trigger');
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent('DeepSeek');
    expect(button).toHaveTextContent('deepseek-chat');
  });

  it('opens vendor flyout menu when trigger button is clicked', () => {
    render(
      <CascadingModelSelect
        activeVendor="DeepSeek"
        activeModelLabel="deepseek-chat"
        activeModelKey="ds-v3"
        vendorGroups={mockVendorGroups}
        onSelectModel={vi.fn()}
        getConfigKey={getKey}
      />
    );

    const button = screen.getByTestId('cascading-trigger');
    fireEvent.click(button);

    const menu = screen.getByTestId('cascading-menu');
    expect(menu).toBeInTheDocument();
    expect(within(menu).getByText('选择厂商')).toBeInTheDocument();
    expect(within(menu).getByText('3 厂商')).toBeInTheDocument();
    expect(screen.getByTestId('cascading-vendor-DeepSeek')).toBeInTheDocument();
    expect(screen.getByTestId('cascading-vendor-Google Gemini')).toBeInTheDocument();
    expect(screen.getByTestId('cascading-vendor-Ollama (本地私有化)')).toBeInTheDocument();
  });

  it('displays sub-models when hovering over a vendor with multiple models', () => {
    render(
      <CascadingModelSelect
        activeVendor="DeepSeek"
        activeModelLabel="deepseek-chat"
        activeModelKey="ds-v3"
        vendorGroups={mockVendorGroups}
        onSelectModel={vi.fn()}
        getConfigKey={getKey}
      />
    );

    fireEvent.click(screen.getByTestId('cascading-trigger'));

    const dsVendorRow = screen.getByTestId('cascading-vendor-DeepSeek');
    fireEvent.mouseEnter(dsVendorRow);

    const flyout = screen.getByTestId('cascading-flyout');
    expect(flyout).toBeInTheDocument();
    expect(within(flyout).getByText('deepseek-reasoner')).toBeInTheDocument();
    expect(within(flyout).getByText('deepseek-chat')).toBeInTheDocument();
  });

  it('triggers onSelectModel when clicking a model in the submenu', () => {
    const handleSelectModel = vi.fn();
    render(
      <CascadingModelSelect
        activeVendor="DeepSeek"
        activeModelLabel="deepseek-chat"
        activeModelKey="ds-v3"
        vendorGroups={mockVendorGroups}
        onSelectModel={handleSelectModel}
        getConfigKey={getKey}
      />
    );

    fireEvent.click(screen.getByTestId('cascading-trigger'));

    const dsVendorRow = screen.getByTestId('cascading-vendor-DeepSeek');
    fireEvent.mouseEnter(dsVendorRow);

    const reasonerOption = screen.getByTestId('cascading-model-ds-r1');
    fireEvent.click(reasonerOption);

    expect(handleSelectModel).toHaveBeenCalledTimes(1);
    expect(handleSelectModel).toHaveBeenCalledWith(mockVendorGroups[0].models[1]);
  });

  it('directly selects single model when vendor has only 1 model and is clicked', () => {
    const handleSelectModel = vi.fn();
    render(
      <CascadingModelSelect
        activeVendor="DeepSeek"
        activeModelLabel="deepseek-chat"
        activeModelKey="ds-v3"
        vendorGroups={mockVendorGroups}
        onSelectModel={handleSelectModel}
        getConfigKey={getKey}
      />
    );

    fireEvent.click(screen.getByTestId('cascading-trigger'));

    const geminiVendorRow = screen.getByTestId('cascading-vendor-Google Gemini');
    fireEvent.click(geminiVendorRow);

    expect(handleSelectModel).toHaveBeenCalledWith(mockVendorGroups[1].models[0]);
  });
});
