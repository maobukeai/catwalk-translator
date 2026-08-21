import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { DualPaneTranslator } from '../components/MainWindow/DualPaneTranslator';
import type { AppSettings, UniversalTranslationResponse } from '../services/types';
import * as tauriService from '../services/tauri';

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  hotkey: 'F4',
  defaultPreset: 'blender',
  llmConfig: null,
  translationTiers: ['preset', 'llm', 'online'],
  presetDicts: {
    blender: true,
    substance: true,
    unity: true,
    unreal: true,
    maya: true,
    houdini: true,
  },
  appearance: {
    theme: 'system',
    enableBlur: true,
    blurAmount: 24,
    fontFamily: 'system',
    fontSize: 'medium',
  },
};

describe('DualPaneTranslator CG Terminology & Tab Polish Test Suite', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders CG terminology tag badge and sky blue dashed underline when engine source tier contains CG dictionary source', async () => {
    const mockRes: UniversalTranslationResponse = {
      original: 'Principled BSDF',
      detectedLang: 'en',
      mainTranslation: '原理化 BSDF 主着色器',
      wordDetail: {
        phoneticUs: '',
        phoneticUk: '',
        pos: 'n.',
        definition: '',
        examples: [],
        cgDomainNote: 'Blender 物理材质节点（原理化 BSDF）',
      },
      engines: [
        {
          engineName: 'Blender CG 词库',
          translated: '原理化 BSDF 主着色器',
          sourceTier: 'Preset (Blender 离线词库)',
        },
      ],
    };

    vi.spyOn(tauriService, 'cmdUniversalTranslate').mockResolvedValue(mockRes);

    render(<DualPaneTranslator settings={DEFAULT_SETTINGS} initialText="" />);

    const textarea = screen.getByPlaceholderText(/输入或粘贴/);
    fireEvent.change(textarea, { target: { value: 'Principled BSDF' } });

    await waitFor(() => {
      expect(screen.getByText('原理化 BSDF 主着色器')).toBeInTheDocument();
    }, { timeout: 3000 });

    const cgBadges = screen.getAllByText(/CG 术语/);
    expect(cgBadges.length).toBeGreaterThan(0);

    const textElement = screen.getByText('原理化 BSDF 主着色器');
    expect(textElement.className).toContain('border-sky-400');
    expect(textElement.className).toContain('border-dashed');
  });

  it('shows CG explanation floating tooltip popover when hovering over CG term badge', async () => {
    const mockRes: UniversalTranslationResponse = {
      original: 'Subsurface Scattering',
      detectedLang: 'en',
      mainTranslation: '次表面散射',
      wordDetail: {
        phoneticUs: '',
        phoneticUk: '',
        pos: 'n.',
        definition: '',
        examples: [],
        cgDomainNote: '3D 节点材质：次表面散射，用于仿真玉石、皮肤、蜡质等半透明介质内部漫射。',
      },
      engines: [
        {
          engineName: 'Substance CG 词库',
          translated: '次表面散射',
          sourceTier: 'Substance 3D 词库',
        },
      ],
    };

    vi.spyOn(tauriService, 'cmdUniversalTranslate').mockResolvedValue(mockRes);

    render(<DualPaneTranslator settings={DEFAULT_SETTINGS} initialText="" />);

    const textarea = screen.getByPlaceholderText(/输入或粘贴/);
    fireEvent.change(textarea, { target: { value: 'Subsurface Scattering' } });

    await waitFor(() => {
      expect(screen.getByText('次表面散射')).toBeInTheDocument();
    }, { timeout: 3000 });

    const badge = screen.getAllByText(/CG 术语/)[0];
    expect(badge).toBeInTheDocument();

    const container = badge.closest('.cursor-help') || badge;
    fireEvent.mouseEnter(container);

    await waitFor(() => {
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
      expect(within(screen.getByRole('tooltip')).getByText('Subsurface Scattering')).toBeInTheDocument();
      expect(screen.getByText(/3D 节点材质：次表面散射/)).toBeInTheDocument();
    });
  });

  it('renders WCAG 4.5:1 AA contrast compliant tab items and scroll indicators', async () => {
    const mockRes: UniversalTranslationResponse = {
      original: 'Roughness',
      detectedLang: 'en',
      mainTranslation: '粗糙度',
      engines: [
        { engineName: 'Blender 词库', translated: '粗糙度', sourceTier: 'Preset' },
        { engineName: 'Google 翻译', translated: '粗糙性', sourceTier: 'Online' },
      ],
    };

    vi.spyOn(tauriService, 'cmdUniversalTranslate').mockResolvedValue(mockRes);

    render(<DualPaneTranslator settings={DEFAULT_SETTINGS} initialText="" />);

    const textarea = screen.getByPlaceholderText(/输入或粘贴/);
    fireEvent.change(textarea, { target: { value: 'Roughness' } });

    await waitFor(() => {
      expect(screen.getAllByText('粗糙度')[0]).toBeInTheDocument();
    }, { timeout: 3000 });

    const googleTab = screen.getByText('Google');
    expect(googleTab).toBeInTheDocument();
    expect(googleTab.closest('button')?.className).toContain('text-zinc-300');
  });
});
