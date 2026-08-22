import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { DualPaneTranslator } from '../components/MainWindow/DualPaneTranslator';
import type { AppSettings } from '../services/types';
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

const MOCK_IMAGE_RESULT: tauriService.ImageTranslateResponse = {
  imageWidth: 800,
  imageHeight: 400,
  blocks: [
    {
      original: 'Roughness',
      translated: '粗糙度',
      sourceTier: 'Preset (Blender 离线词库)',
      confidence: 0.97,
      x: 40,
      y: 60,
      width: 220,
      height: 34,
      bgCss: 'rgb(42,42,42)',
      fgCss: '#ffffff',
    },
    {
      original: 'Subsurface Scattering',
      translated: '次表面散射',
      sourceTier: 'LLM API (DeepSeek)',
      confidence: 0.94,
      x: 40,
      y: 110,
      width: 320,
      height: 34,
      bgCss: 'rgb(42,42,42)',
      fgCss: '#ffffff',
    },
  ],
};

function makePngFile() {
  return new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'shot.png', {
    type: 'image/png',
  });
}

function pasteImage(target: HTMLElement) {
  const file = makePngFile();
  fireEvent.paste(target, {
    clipboardData: {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
    },
  });
}

function dropImage(target: HTMLElement) {
  const file = makePngFile();
  fireEvent.drop(target, {
    dataTransfer: { files: [file] },
  });
}

describe('DualPaneTranslator 图片粘贴与拖拽翻译', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('粘贴图片后弹出图片翻译面板并展示行级译文', async () => {
    const spy = vi
      .spyOn(tauriService, 'cmdImageOcrTranslate')
      .mockResolvedValue(MOCK_IMAGE_RESULT);

    render(<DualPaneTranslator settings={DEFAULT_SETTINGS} initialText="" />);
    pasteImage(screen.getByRole('textbox'));

    expect(await screen.findByText('图片翻译')).toBeInTheDocument();
    await waitFor(() => {
      // 译文同时渲染在原图叠加层与行级列表两处
      expect(screen.getAllByText('粗糙度').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('次表面散射').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByText('Roughness')).toBeInTheDocument();
    expect(screen.getByText('Subsurface Scattering')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(1);
    // 传入的是 dataURL 去头后的 base64
    const [base64Arg, presetArg] = spy.mock.calls[0];
    expect(typeof base64Arg).toBe('string');
    expect(base64Arg).not.toContain('data:');
    expect(presetArg).toBe('blender');
  });

  it('拖拽图片文件同样触发图片翻译', async () => {
    const spy = vi
      .spyOn(tauriService, 'cmdImageOcrTranslate')
      .mockResolvedValue(MOCK_IMAGE_RESULT);

    render(<DualPaneTranslator settings={DEFAULT_SETTINGS} initialText="" />);
    dropImage(screen.getByRole('textbox'));

    expect(await screen.findByText('图片翻译')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('粗糙度').length).toBeGreaterThanOrEqual(1));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('点击关闭按钮收起图片翻译面板', async () => {
    vi.spyOn(tauriService, 'cmdImageOcrTranslate').mockResolvedValue(MOCK_IMAGE_RESULT);

    render(<DualPaneTranslator settings={DEFAULT_SETTINGS} initialText="" />);
    pasteImage(screen.getByRole('textbox'));

    expect(await screen.findByText('图片翻译')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('关闭图片翻译'));

    await waitFor(() => {
      expect(screen.queryByText('图片翻译')).not.toBeInTheDocument();
    });
  });

  it('OCR 未识别到文本时给出友好提示', async () => {
    vi.spyOn(tauriService, 'cmdImageOcrTranslate').mockResolvedValue({
      imageWidth: 800,
      imageHeight: 400,
      blocks: [],
    });

    render(<DualPaneTranslator settings={DEFAULT_SETTINGS} initialText="" />);
    pasteImage(screen.getByRole('textbox'));

    await waitFor(() => {
      expect(screen.getByText(/未在图片中识别到文本/)).toBeInTheDocument();
    });
  });

  it('复制全部按钮把所有译文按行写入剪贴板', async () => {
    vi.spyOn(tauriService, 'cmdImageOcrTranslate').mockResolvedValue(MOCK_IMAGE_RESULT);
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText, readText: vi.fn() },
    });

    render(<DualPaneTranslator settings={DEFAULT_SETTINGS} initialText="" />);
    pasteImage(screen.getByRole('textbox'));

    await waitFor(() => expect(screen.getAllByText('粗糙度').length).toBeGreaterThanOrEqual(1));
    fireEvent.click(screen.getByTitle('复制全部图片的译文'));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('粗糙度\n次表面散射');
    await waitFor(() => expect(screen.getByText('已复制')).toBeInTheDocument());
  });


  it('批量模式：一次拖入两张图片全部入队并逐张翻译', async () => {
    const spy = vi
      .spyOn(tauriService, 'cmdImageOcrTranslate')
      .mockResolvedValue(MOCK_IMAGE_RESULT);

    render(<DualPaneTranslator settings={DEFAULT_SETTINGS} initialText="" />);
    const fileA = makePngFile();
    const fileB = new File([new Uint8Array([137, 80, 78, 71])], 'shot2.png', {
      type: 'image/png',
    });
    fireEvent.drop(screen.getByRole('textbox'), {
      dataTransfer: { files: [fileA, fileB] },
    });

    // 两张图片都出现在队列中
    await waitFor(() => {
      expect(screen.getAllByTestId('image-queue-item').length).toBe(2);
    });
    // 逐张顺序翻译：两条都完成
    await waitFor(() => {
      expect(spy).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('shot.png')).toBeInTheDocument();
    expect(screen.getByText('shot2.png')).toBeInTheDocument();
    // 队列摘要显示 2 张图片
    expect(screen.getByText(/2 张/)).toBeInTheDocument();
  });

  it('翻译失败后可通过重试按钮用同一张图片恢复', async () => {
    const spy = vi
      .spyOn(tauriService, 'cmdImageOcrTranslate')
      .mockRejectedValueOnce(new Error('OCR 引擎忙'))
      .mockResolvedValue(MOCK_IMAGE_RESULT);

    render(<DualPaneTranslator settings={DEFAULT_SETTINGS} initialText="" />);
    pasteImage(screen.getByRole('textbox'));

    await waitFor(() => {
      expect(screen.getByText(/OCR 引擎忙/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTitle('重试此图片'));

    await waitFor(() => {
      expect(screen.getAllByText('粗糙度').length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText(/OCR 引擎忙/)).not.toBeInTheDocument();
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
