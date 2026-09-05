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

  it('单行复制按钮可将该行译文单独写入剪贴板', async () => {
    vi.spyOn(tauriService, 'cmdImageOcrTranslate').mockResolvedValue(MOCK_IMAGE_RESULT);
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText, readText: vi.fn() },
    });

    render(<DualPaneTranslator settings={DEFAULT_SETTINGS} initialText="" />);
    pasteImage(screen.getByRole('textbox'));

    await waitFor(() => expect(screen.getAllByText('粗糙度').length).toBeGreaterThanOrEqual(1));
    const singleCopyButtons = screen.getAllByTitle('复制单行译文');
    expect(singleCopyButtons.length).toBeGreaterThanOrEqual(2);

    fireEvent.click(singleCopyButtons[0]);
    expect(writeText).toHaveBeenCalledWith('粗糙度');
  });

  it('auto 模式下优先从多模型池选用已就绪的 AI 大模型', async () => {
    const spy = vi
      .spyOn(tauriService, 'cmdImageOcrTranslate')
      .mockResolvedValue(MOCK_IMAGE_RESULT);

    const settingsWithPool: AppSettings = {
      ...DEFAULT_SETTINGS,
      defaultPreset: 'auto',
      llmConfig: null, // 旧单项配置为空
      llmConfigs: [
        {
          id: 'cfg-deepseek',
          provider: 'DeepSeek',
          model: 'deepseek-chat',
          apiKey: 'sk-ready-key',
          endpoint: 'https://api.deepseek.com',
          enabled: true,
        },
      ],
    };

    render(<DualPaneTranslator settings={settingsWithPool} initialText="" />);
    pasteImage(screen.getByRole('textbox'));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const [, presetArg, llmConfigArg] = spy.mock.calls[0];
    expect(presetArg).toBe('auto');
    expect(llmConfigArg).not.toBeNull();
    expect(llmConfigArg?.apiKey).toBe('sk-ready-key');
    expect(llmConfigArg?.provider).toBe('DeepSeek');
  });

  it('点击查看大图按钮可弹出高清大图模态框，且模态框内完整保留并放大原位译文图层', async () => {
    vi.spyOn(tauriService, 'cmdImageOcrTranslate').mockResolvedValue(MOCK_IMAGE_RESULT);

    render(<DualPaneTranslator settings={DEFAULT_SETTINGS} initialText="" />);
    pasteImage(screen.getByRole('textbox'));

    await waitFor(() => expect(screen.getAllByText('粗糙度').length).toBeGreaterThanOrEqual(1));
    const zoomBtn = screen.getByTitle('查看大图');
    fireEvent.click(zoomBtn);

    // 验证大图模态框弹出
    expect(await screen.findByText(/高清大图/)).toBeInTheDocument();

    // 核心断言：验证模态框内依然能看到译文覆写，彻底解决“放大图片译文就没有了”的问题
    expect(screen.getAllByText('粗糙度').length).toBeGreaterThanOrEqual(2);

    // 验证模态框内提供的模式切换功能与复制译文按钮
    expect(screen.getByTitle('查看原位覆写译文')).toBeInTheDocument();
    expect(screen.getByTitle('查看双语对照')).toBeInTheDocument();
    expect(screen.getByTitle('查看纯译文排版通读')).toBeInTheDocument();
    expect(screen.getByTitle('查看纯原图')).toBeInTheDocument();
    expect(screen.getByTitle('复制整张图片所有译文')).toBeInTheDocument();

    // 切换到双语对照模式
    fireEvent.click(screen.getByTitle('查看双语对照'));
    expect(screen.getAllByText('Roughness').length).toBeGreaterThanOrEqual(1);

    // 切换到纯文排版通读模式
    fireEvent.click(screen.getByTitle('查看纯译文排版通读'));
    expect(await screen.findByText(/纯译文排版通读/)).toBeInTheDocument();

    // 关闭大图预览
    fireEvent.click(screen.getByTitle('关闭大图预览'));
    await waitFor(() => {
      expect(screen.queryByText(/高清大图/)).not.toBeInTheDocument();
    });
  });

  it('图片翻译通道下拉菜单中严格不包含任何字典或词库选项', async () => {
    vi.spyOn(tauriService, 'cmdImageOcrTranslate').mockResolvedValue(MOCK_IMAGE_RESULT);

    render(<DualPaneTranslator settings={DEFAULT_SETTINGS} initialText="" />);
    pasteImage(screen.getByRole('textbox'));

    await waitFor(() => expect(screen.getByText('图片翻译')).toBeInTheDocument());

    // 验证下拉菜单中没有任何 3D/CG 专业词库或离线词典条目
    expect(screen.queryByText(/3D\/CG 专业词库与离线词典/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Blender CG 词库/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ECDICT 通用离线词典/)).not.toBeInTheDocument();
  });

  it('支持切换到纯文排版视图通读整篇译文', async () => {
    vi.spyOn(tauriService, 'cmdImageOcrTranslate').mockResolvedValue(MOCK_IMAGE_RESULT);

    render(<DualPaneTranslator settings={DEFAULT_SETTINGS} initialText="" />);
    pasteImage(screen.getByRole('textbox'));

    await waitFor(() => expect(screen.getAllByText('粗糙度').length).toBeGreaterThanOrEqual(1));

    const textModeBtn = screen.getByTitle(/纯译文排版/);
    fireEvent.click(textModeBtn);

    expect(await screen.findByText(/纯译文排版通读/)).toBeInTheDocument();
    expect(screen.getByText('复制整篇译文')).toBeInTheDocument();
  });

  it('首页工具栏渲染【图片】选择按钮且 placeholder 提示支持图片翻译', async () => {
    render(<DualPaneTranslator settings={DEFAULT_SETTINGS} initialText="" />);

    const imgBtn = screen.getByTitle(/选择本地图片翻译/);
    expect(imgBtn).toBeInTheDocument();
    expect(imgBtn).toHaveTextContent('图片');

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.placeholder).toContain('直接拖入图片、按 Ctrl+V 粘贴图片翻译');
  });
});

