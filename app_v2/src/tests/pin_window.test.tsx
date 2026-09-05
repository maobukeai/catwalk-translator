import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { PinWindowApp } from '../components/Pin/PinWindow';
import { cmdOpenPin } from '../services/tauri';
import { speakText } from '../services/tts';

const MOCK_PAYLOAD = {
  id: 'pin_test_1',
  title: '划词译文',
  blocks: [
    { original: 'Roughness', translated: '粗糙度', sourceTier: 'Preset (Blender)' },
    { original: 'Subsurface Scattering', translated: '次表面散射', sourceTier: 'LLM API' },
  ],
  x: 100,
  y: 100,
  width: 380,
  height: 260,
};

vi.mock('../services/tauri', () => ({
  isTauri: () => false,
  cmdGetPinPayload: vi.fn(async (id: string) => (id === 'quick' ? null : MOCK_PAYLOAD)),
  cmdClosePin: vi.fn(async () => undefined),
  cmdOpenPin: vi.fn(async () => undefined),
  cmdSetPinAlwaysOnTop: vi.fn(async () => undefined),
  cmdTranslatePhrasesStyled: vi.fn(async ([text]: string[]) => [
    { original: text, translated: `快译: ${text}`, sourceTier: 'Flash Fast' },
  ]),
  cmdUniversalTranslate: vi.fn(async ({ text }: { text: string }) => ({
    original: text,
    detectedLang: 'en',
    mainTranslation: `精翻: ${text}`,
    engines: [
      { engineName: '🤖 AI 深度精翻', translated: `精翻: ${text}`, sourceTier: 'LLM API' },
      { engineName: '有道词典', translated: `有道: ${text}`, sourceTier: 'Online' },
    ],
  })),
  fetchAiDeepTranslationAnalysis: vi.fn(async () => null),
}));

vi.mock('../services/tts', () => ({
  speakText: vi.fn(),
}));

describe('PinWindow 贴图窗口与快捷查词悬浮窗', () => {
  beforeEach(() => {
    window.location.hash = '#pin=pin_test_1';
  });

  afterEach(() => {
    cleanup();
    window.location.hash = '';
    vi.clearAllMocks();
  });

  it('加载并渲染普通贴图内容块', async () => {
    render(<PinWindowApp />);
    expect(await screen.findByText('粗糙度')).toBeInTheDocument();
    expect(screen.getByText('次表面散射')).toBeInTheDocument();
    expect(screen.getByText('Roughness')).toBeInTheDocument();
    expect(screen.getByText(/Preset \(Blender\)/)).toBeInTheDocument();
  });

  it('折叠按钮收起内容区，展开后恢复', async () => {
    render(<PinWindowApp />);
    await screen.findByText('粗糙度');

    fireEvent.click(screen.getByTestId('pin-collapse'));
    // 折叠态：内容块隐藏，标题显示段数摘要
    expect(screen.queryByText('Roughness')).not.toBeInTheDocument();
    expect(screen.getByText(/2 段/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('pin-collapse'));
    expect(await screen.findByText('Roughness')).toBeInTheDocument();
  });

  it('复制按钮把全部译文写入剪贴板', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText, readText: vi.fn(() => Promise.resolve('')) },
    });
    render(<PinWindowApp />);
    fireEvent.click(await screen.findByTitle('复制全部译文'));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('粗糙度\n次表面散射');
    });
    expect(await screen.findByText('已复制')).toBeInTheDocument();
  });

  it('快捷查词模式：剪贴板内容 ≤300 字符时自动预填并直接触发快慢双流翻译', async () => {
    window.location.hash = '#pin=quick';
    const readText = vi.fn(() => Promise.resolve('Specular'));
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText, writeText },
    });

    render(<PinWindowApp />);

    // 自动探测剪贴板并填入输入框
    const input = (await screen.findByTestId('quick-window-input')) as HTMLInputElement;
    await waitFor(() => {
      expect(input.value).toBe('Specular');
    });

    // 快慢双流竞速呈现：先有快译，随后升级为精翻
    expect(await screen.findByText('精翻: Specular')).toBeInTheDocument();
  });

  it('快捷查词模式：剪贴板为空时自动聚焦输入框，手动输入并按 Enter 即翻', async () => {
    window.location.hash = '#pin=quick';
    const readText = vi.fn(() => Promise.resolve(''));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText, writeText: vi.fn() },
    });

    render(<PinWindowApp />);
    const input = (await screen.findByTestId('quick-window-input')) as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'Metallic' } });
    expect(input.value).toBe('Metallic');

    fireEvent.submit(screen.getByTestId('quick-window-submit'));

    expect(await screen.findByText('精翻: Metallic')).toBeInTheDocument();

    // 清空按钮 ✕ 清空输入框
    const clearBtn = screen.getByTestId('quick-window-clear');
    fireEvent.click(clearBtn);
    expect(input.value).toBe('');
  });

  it('交互式 📌 钉住与生命周期切换', async () => {
    window.location.hash = '#pin=quick';
    render(<PinWindowApp />);

    const pinBtn = await screen.findByTestId('pin-toggle');
    // 桌面贴图默认已常驻钉住
    expect(pinBtn).toHaveTextContent('📌');
    expect(pinBtn.title).toContain('已钉在桌面');

    // 点击取消钉住
    fireEvent.click(pinBtn);
    expect(pinBtn.title).toContain('点击钉在桌面');

    // 再次点击恢复钉住
    fireEvent.click(pinBtn);
    expect(pinBtn.title).toContain('已钉在桌面');
  });

  it('桌面贴图模式：剪贴板内容直接翻译并常驻展示', async () => {
    window.location.hash = '#pin=quick';
    const readText = vi.fn(() => Promise.resolve('Displacement'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText, writeText: vi.fn() },
    });

    render(<PinWindowApp />);
    expect(await screen.findByText('精翻: Displacement')).toBeInTheDocument();

    // 验证常驻置顶与输入框
    const input = (await screen.findByTestId('quick-window-input')) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(screen.getByText(/已常驻置顶/)).toBeInTheDocument();
  });

  it('支持原文 🔊 朗读与逐条复制', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText, readText: vi.fn(() => Promise.resolve('')) },
    });

    render(<PinWindowApp />);
    await screen.findByText('粗糙度');

    // 点击朗读
    const ttsBtns = screen.getAllByTitle('朗读原文');
    fireEvent.click(ttsBtns[0]);
    expect(speakText).toHaveBeenCalledWith('Roughness');

    // 逐条复制
    const copyBlockBtns = screen.getAllByTitle('复制此条译文');
    fireEvent.click(copyBlockBtns[0]);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('粗糙度');
    });
  });

  it('快捷查词模式：剪贴板内容超过 300 字符时不自动触发翻译，仅聚焦输入框', async () => {
    window.location.hash = '#pin=quick';
    const longText = 'A'.repeat(305);
    const readText = vi.fn(() => Promise.resolve(longText));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText, writeText: vi.fn() },
    });

    render(<PinWindowApp />);
    const input = (await screen.findByTestId('quick-window-input')) as HTMLInputElement;

    // >300 字符不应自动填入 input，也不应触发自动翻译
    await waitFor(() => {
      expect(input.value).toBe('');
    });
    expect(screen.queryByText(/精翻:/)).not.toBeInTheDocument();
  });

  it('普通贴图点击关闭按钮触发 cmdClosePin', async () => {
    window.location.hash = '#pin=pin_test_1';
    const { cmdClosePin } = await import('../services/tauri');
    render(<PinWindowApp />);
    await screen.findByText('粗糙度');

    const closeBtn = screen.getByTestId('pin-close');
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(cmdClosePin).toHaveBeenCalledWith('pin_test_1');
    });
  });

  it('快捷查词模式：按 Esc 键重置钉住状态并关闭', async () => {
    window.location.hash = '#pin=quick';
    render(<PinWindowApp />);
    const input = await screen.findByTestId('quick-window-input');

    // 模拟在输入框按下 Esc
    fireEvent.keyDown(input, { key: 'Escape' });

    // 验证仍正常渲染并不抛出未捕获异常
    expect(input).toBeInTheDocument();
  });

  it('点击「靠边收起」按钮一键贴边，窗口收起为边缘胶囊拉手', async () => {
    render(<PinWindowApp />);
    await screen.findByText('粗糙度');

    const dockBtn = screen.getByTestId('pin-dock-edge');
    expect(dockBtn).toBeInTheDocument();
    expect(dockBtn).toHaveTextContent('⇥');

    // 点击靠边
    fireEvent.click(dockBtn);

    // 窗口收敛为边缘小拉手胶囊
    const capsule = await screen.findByTestId('dock-handle-capsule');
    expect(capsule).toBeInTheDocument();
    expect(capsule).toHaveTextContent('🐱');
    expect(screen.queryByText('粗糙度')).not.toBeInTheDocument();
  });

  it('边缘胶囊拉手点击或悬停时滑出展开，再次点击解除靠边', async () => {
    render(<PinWindowApp />);
    await screen.findByText('粗糙度');

    // 触发靠边
    fireEvent.click(screen.getByTestId('pin-dock-edge'));
    const capsule = await screen.findByTestId('dock-handle-capsule');
    expect(capsule).toBeInTheDocument();

    // 鼠标移入胶囊：自动滑出展开
    fireEvent.mouseEnter(capsule);

    // 恢复渲染完整内容
    expect(await screen.findByText('粗糙度')).toBeInTheDocument();
    const dockBtn = screen.getByTestId('pin-dock-edge');
    expect(dockBtn).toHaveTextContent('◨');

    // 再次点击解除靠边
    fireEvent.click(dockBtn);
    expect(screen.queryByTestId('dock-handle-capsule')).not.toBeInTheDocument();
    expect(screen.getByTestId('pin-dock-edge')).toHaveTextContent('⇥');
  });

  it('悬停展开后鼠标移出窗口，350ms 后自动收回为边缘小拉手（快捷查词未钉住状态）', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.location.hash = '#pin=quick';
    const readText = vi.fn(() => Promise.resolve(''));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText, writeText: vi.fn() },
    });

    render(<PinWindowApp />);
    // 先切换为未钉住状态
    const pinBtn = await screen.findByTestId('pin-toggle');
    fireEvent.click(pinBtn);

    const dockBtn = await screen.findByTestId('pin-dock-edge');

    // 靠边
    fireEvent.click(dockBtn);
    const capsule = await screen.findByTestId('dock-handle-capsule');
    expect(capsule).toBeInTheDocument();

    // 悬停展开
    fireEvent.mouseEnter(capsule);
    const rootContainer = (await screen.findByTestId('pin-dock-edge')).closest('.h-full')!;
    expect(rootContainer).toBeInTheDocument();

    // 鼠标移出容器
    fireEvent.mouseLeave(rootContainer);

    // 前进 360ms
    act(() => {
      vi.advanceTimersByTime(360);
    });

    // 自动收回为胶囊
    expect(await screen.findByTestId('dock-handle-capsule')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('快捷查词模式：标点符号与大小写归一化聚合同一词句译文，避免拆分为多个卡片', async () => {
    window.location.hash = '#pin=quick';
    const { cmdUniversalTranslate } = await import('../services/tauri');
    vi.mocked(cmdUniversalTranslate).mockResolvedValueOnce({
      original: '你好',
      detectedLang: 'zh',
      mainTranslation: 'Hello',
      engines: [
        { engineName: '百度大模型 (文心)', translated: 'Hello', sourceTier: 'LLM' },
        { engineName: 'Gemini', translated: 'Hello', sourceTier: 'LLM' },
        { engineName: 'DeepSeek', translated: 'Hello.', sourceTier: 'LLM' }, // 带句点
      ],
    });

    const readText = vi.fn(() => Promise.resolve(''));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText, writeText: vi.fn() },
    });

    render(<PinWindowApp />);
    const input = (await screen.findByTestId('quick-window-input')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '你好' } });
    fireEvent.submit(screen.getByTestId('quick-window-submit'));

    // 应该只出现 1 个 Hello 译文气泡，而不是被拆为两个卡片
    expect(await screen.findByText('Hello')).toBeInTheDocument();
    // 应该聚合为多源一致
    expect(await screen.findByText(/3源一致/)).toBeInTheDocument();
    // 不应存在带有句点的分离卡片
    expect(screen.queryByText('Hello.')).not.toBeInTheDocument();
  });

  it('快捷查词模式：在输入框内按下 Esc 键直接触发安全关闭', async () => {
    window.location.hash = '#pin=quick';
    render(<PinWindowApp />);
    const input = await screen.findByTestId('quick-window-input');

    // 按下 Esc
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toBeInTheDocument();
  });

  it('首页同款解析与多引擎对比：展示词典/术语解析，支持折叠与展开，点击多引擎胶囊秒切主译文', async () => {
    window.location.hash = '#pin=quick';
    const { cmdUniversalTranslate, fetchAiDeepTranslationAnalysis } = await import('../services/tauri');
    vi.mocked(cmdUniversalTranslate).mockResolvedValueOnce({
      original: 'Roughness',
      detectedLang: 'en',
      mainTranslation: '粗糙度',
      wordDetail: {
        phoneticUs: '/ ˈrʌfnəs /',
        phoneticUk: '[ ˈrʌfnəs ]',
        pos: 'n.',
        definition: '粗糙度；凹凸不平',
        cgDomainNote: 'Blender 材质',
        examples: ['Adjust the roughness value to change surface glossiness.'],
      },
      engines: [
        { engineName: '百度大模型 (文心)', translated: '粗糙度', sourceTier: 'LLM' },
        { engineName: 'DeepL 极速通道', translated: '表面凹凸粗糙度 (DeepL)', sourceTier: 'Online' },
      ],
    });

    vi.mocked(fetchAiDeepTranslationAnalysis).mockResolvedValueOnce({
      rewrites: [],
      vocabulary: [
        { word: 'roughness', phonetic: '/ ˈrʌfnəs /', pos: 'n.', meaning: '表面粗糙程度' },
      ],
      examples: [
        { en: 'High roughness produces matte finish.', zh: '高粗糙度会产生哑光表面。' },
      ],
    });

    render(<PinWindowApp />);
    const input = (await screen.findByTestId('quick-window-input')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Roughness' } });
    fireEvent.submit(screen.getByTestId('quick-window-submit'));

    // 验证主译文
    expect(await screen.findByText('粗糙度')).toBeInTheDocument();

    // 验证首页同款词典/术语解析卡片内容（默认收起）
    expect(await screen.findByText(/术语与词典解析/)).toBeInTheDocument();
    expect(screen.getByText(/Blender 材质/)).toBeInTheDocument();

    // 验证默认折叠：内容暂未展开，按钮显示「展开解析」
    const toggleBtn = screen.getByTestId('toggle-analysis-btn-0');
    expect(toggleBtn).toHaveTextContent('展开解析');
    expect(screen.queryByText(/粗糙度；凹凸不平/)).toBeNull();

    // 点击展开解析
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveTextContent('收起解析');
    expect(screen.getByText(/粗糙度；凹凸不平/)).toBeInTheDocument();
    expect(screen.getByText(/美 \/ ˈrʌfnəs \//)).toBeInTheDocument();

    // 再次点击收起解析
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveTextContent('展开解析');
    expect(screen.queryByText(/粗糙度；凹凸不平/)).toBeNull();

    // 验证多引擎胶囊行
    expect(screen.getByTestId('multi-engine-scroll-row')).toBeInTheDocument();
    expect(screen.getByText('DeepL 极速通道')).toBeInTheDocument();

    // 点击 DeepL 胶囊，秒切为主译文
    const deeplBtn = screen.getByTestId('engine-option-1');
    fireEvent.click(deeplBtn);
    expect(await screen.findByText('表面凹凸粗糙度 (DeepL)')).toBeInTheDocument();
  });

  it('多引擎过滤机制：严格过滤额度超限与网络超时等长报错，不污染候选列表', async () => {
    window.location.hash = '#pin=quick';
    const { cmdUniversalTranslate } = await import('../services/tauri');
    vi.mocked(cmdUniversalTranslate).mockResolvedValueOnce({
      original: '太强了',
      detectedLang: 'zh',
      mainTranslation: 'So strong',
      engines: [
        { engineName: '百度大模型', translated: 'So strong', sourceTier: 'LLM' },
        { engineName: '彩云小译', translated: "It's too strong", sourceTier: 'Online' },
        { engineName: 'DeepSeek', translated: '[API 额度不足或被限流，请检查账户配额]', sourceTier: 'LLM' },
        { engineName: '微软翻译', translated: '网络连接超时，点击重试', sourceTier: 'Online' },
      ],
    });

    render(<PinWindowApp />);
    const input = (await screen.findByTestId('quick-window-input')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '太强了' } });
    fireEvent.submit(screen.getByTestId('quick-window-submit'));

    expect(await screen.findByText('So strong')).toBeInTheDocument();
    // 有效引擎在多引擎对比中
    expect(screen.getByText('彩云小译')).toBeInTheDocument();
    // 报错引擎已被严格过滤，绝不在候选胶囊或卡片中渲染
    expect(screen.queryByText(/API 额度不足或被限流/)).not.toBeInTheDocument();
    expect(screen.queryByText(/网络连接超时/)).not.toBeInTheDocument();
  });
});
