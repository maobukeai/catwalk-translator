import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { PinWindowApp } from "../components/Pin/PinWindow";
import { PIN_CHAT_SESSION_KEY } from "../components/Pin/PinChatView";
import * as tauriService from "../services/tauri";
import { useSettingsStore } from "../stores/useSettingsStore";

const MOCK_PAYLOAD = {
  id: "pin_chat_test_1",
  title: "贴图查词",
  blocks: [
    { original: "Roughness", translated: "粗糙度", sourceTier: "Preset (Blender)" },
    { original: "Normal Map", translated: "法线贴图", sourceTier: "LLM API" },
  ],
  x: 100,
  y: 100,
  width: 440,
  height: 260,
};

let mockSettings: any = null;

vi.mock("../services/tauri", () => ({
  isTauri: () => false,
  cmdGetSettings: vi.fn(async () => {
    return mockSettings || useSettingsStore.getState().settings;
  }),
  cmdGetPinPayload: vi.fn(async () => MOCK_PAYLOAD),
  cmdClosePin: vi.fn(async () => undefined),
  cmdOpenPin: vi.fn(async () => undefined),
  cmdSetPinAlwaysOnTop: vi.fn(async () => undefined),
  cmdTranslatePhrasesStyled: vi.fn(async ([text]: string[]) => [
    { original: text, translated: `快译: ${text}`, sourceTier: "Flash Fast" },
  ]),
  cmdUniversalTranslate: vi.fn(async ({ text }: { text: string }) => ({
    original: text,
    detectedLang: "en",
    mainTranslation: `精翻: ${text}`,
    engines: [
      { engineName: "🤖 AI 深度精翻", translated: `精翻: ${text}`, sourceTier: "LLM API" },
    ],
  })),
  cmdChatLlmStream: vi.fn(
    async (
      _messages: { role: string; content: string }[],
      _config: any,
      onDelta: (delta: string, reasoning?: string) => void
    ) => {
      onDelta("粗糙度是材质表面微观几何粗糙度的量度。");
      return "粗糙度是材质表面微观几何粗糙度的量度。";
    }
  ),
  cmdChatLlm: vi.fn(async () => "AI 回复成功"),
  cmdShowMainWindow: vi.fn(async () => undefined),
}));

vi.mock("../services/tts", () => ({
  speakText: vi.fn(),
}));

describe("PinWindow AI 对话与双模态协同测试", () => {
  beforeEach(() => {
    window.location.hash = "#pin=pin_chat_test_1";
    localStorage.clear();
    mockSettings = {
      theme: "system",
      hotkey: "F4",
      llmConfig: {
        id: "llm_openai_default",
        provider: "OpenAI",
        model: "gpt-4o",
        apiKey: "sk-test-mock-key-12345",
        endpoint: "https://api.openai.com/v1",
        enabled: true,
      },
      llmConfigs: [
        {
          id: "llm_openai_default",
          provider: "OpenAI",
          model: "gpt-4o",
          apiKey: "sk-test-mock-key-12345",
          endpoint: "https://api.openai.com/v1",
          enabled: true,
        },
      ],
    };
    localStorage.setItem("cg_translator_settings_v2", JSON.stringify(mockSettings));
    useSettingsStore.setState((s) => ({
      ...s,
      settings: {
        ...s.settings,
        ...mockSettings,
      },
    }));
  });

  afterEach(() => {
    cleanup();
    window.location.hash = "";
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("支持在顶栏自由切换 [⚡ 翻译] 与 [💬 对话] 模式", async () => {
    render(<PinWindowApp />);
    expect(await screen.findByText("粗糙度")).toBeInTheDocument();

    const tabTranslate = screen.getByTestId("tab-translate");
    const tabChat = screen.getByTestId("tab-chat");

    expect(tabTranslate).toBeInTheDocument();
    expect(tabChat).toBeInTheDocument();

    // 点击切换至对话模式
    fireEvent.click(tabChat);

    // 应该渲染 PinChatView
    expect(await screen.findByTestId("pin-chat-view")).toBeInTheDocument();
    expect(screen.getByTestId("pin-chat-input")).toBeInTheDocument();

    // 点击切回翻译模式
    fireEvent.click(tabTranslate);
    expect(await screen.findByText("粗糙度")).toBeInTheDocument();
    expect(screen.queryByTestId("pin-chat-view")).not.toBeInTheDocument();
  });

  it("翻译卡片点击 [💬 追问] 自动跳至对话模式并展示该术语追问胶囊", async () => {
    render(<PinWindowApp />);
    expect(await screen.findByText("粗糙度")).toBeInTheDocument();

    const askBtns = screen.getAllByTitle(/切换至 AI 对话深度追问该术语/);
    expect(askBtns.length).toBeGreaterThan(0);

    // 点击第一项 Roughness 的追问按钮
    fireEvent.click(askBtns[0]);

    // 自动切换到了对话面板
    expect(await screen.findByTestId("pin-chat-view")).toBeInTheDocument();
    const banner = await screen.findByTestId("context-term-banner");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent("Roughness");

    // 验证4个快捷追问胶囊均已就绪
    expect(screen.getByTestId("context-action-explain")).toHaveTextContent("📖 解释术语");
    expect(screen.getByTestId("context-action-examples")).toHaveTextContent("✍️ 3个例句");
    expect(screen.getByTestId("context-action-synonyms")).toHaveTextContent("🔍 同义辨析");
    expect(screen.getByTestId("context-action-grammar")).toHaveTextContent("🧩 语法拆解");
  });

  it("点击术语追问胶囊触发流式 AI 对话生成", async () => {
    const streamSpy = vi.spyOn(tauriService, "cmdChatLlmStream");
    render(<PinWindowApp />);
    await screen.findByText("粗糙度");

    const askBtns = screen.getAllByTitle(/切换至 AI 对话深度追问该术语/);
    fireEvent.click(askBtns[0]);

    const explainBtn = await screen.findByTestId("context-action-explain");
    fireEvent.click(explainBtn);

    await waitFor(() => {
      expect(streamSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("Roughness"),
          }),
        ]),
        expect.anything(),
        expect.any(Function)
      );
    });

    // 渲染出 AI 的流式回复文本
    expect(await screen.findByText(/粗糙度是材质表面微观几何粗糙度的量度/)).toBeInTheDocument();
  });

  it("对话框直接输入问题并按 Enter 发送", async () => {
    render(<PinWindowApp />);
    fireEvent.click(await screen.findByTestId("tab-chat"));

    const input = (await screen.findByTestId("pin-chat-input")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "如何烘焙 Normal Map？" } });

    fireEvent.click(screen.getByTestId("pin-chat-send"));

    expect(await screen.findByText("如何烘焙 Normal Map？")).toBeInTheDocument();
    expect(await screen.findByText(/粗糙度是材质表面微观几何粗糙度的量度/)).toBeInTheDocument();
  });

  it("快捷预设 Chips 切换与附加指令生效", async () => {
    render(<PinWindowApp />);
    fireEvent.click(await screen.findByTestId("tab-chat"));

    const polishPreset = await screen.findByTestId("pin-preset-polish");
    expect(polishPreset).toBeInTheDocument();

    // 点击激活学术润色预设
    fireEvent.click(polishPreset);
    expect(polishPreset).toHaveClass("bg-indigo-600/90");

    const input = (await screen.findByTestId("pin-chat-input")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "We do this to improve speed." } });
    fireEvent.click(screen.getByTestId("pin-chat-send"));

    expect(await screen.findByText("We do this to improve speed.")).toBeInTheDocument();
    // 验证用户消息带有 [学术润色] 标签（此时页面包含预设 Chip 和消息模式 Badge 两处）
    expect(screen.getAllByText("学术润色").length).toBeGreaterThanOrEqual(2);
  });

  it("对话支持一键清空并同步清理 localStorage", async () => {
    // 预存一条历史记录
    localStorage.setItem(
      PIN_CHAT_SESSION_KEY,
      JSON.stringify([
        {
          id: "mock_1",
          role: "user",
          content: "测试历史消息",
          timestamp: "12:00",
        },
      ])
    );

    render(<PinWindowApp />);
    fireEvent.click(await screen.findByTestId("tab-chat"));

    expect(await screen.findByText("测试历史消息")).toBeInTheDocument();

    const clearBtn = screen.getByTestId("pin-chat-clear");
    fireEvent.click(clearBtn);

    expect(screen.queryByText("测试历史消息")).not.toBeInTheDocument();
    expect(localStorage.getItem(PIN_CHAT_SESSION_KEY)).toBeNull();
  });

  it("支持单条消息复制与删除", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText, readText: vi.fn(() => Promise.resolve("")) },
    });

    localStorage.setItem(
      PIN_CHAT_SESSION_KEY,
      JSON.stringify([
        {
          id: "msg_user_1",
          role: "user",
          content: "这是待复制的消息",
          timestamp: "12:30",
        },
      ])
    );

    render(<PinWindowApp />);
    fireEvent.click(await screen.findByTestId("tab-chat"));

    expect(await screen.findByText("这是待复制的消息")).toBeInTheDocument();

    // 复制单条消息
    const copyBtn = screen.getByTitle("复制消息");
    fireEvent.click(copyBtn);
    expect(writeText).toHaveBeenCalledWith("这是待复制的消息");

    // 删除单条消息
    const deleteBtn = screen.getByTitle("删除消息");
    fireEvent.click(deleteBtn);
    expect(screen.queryByText("这是待复制的消息")).not.toBeInTheDocument();
  });

  it("支持中止生成逻辑", async () => {
    vi.spyOn(tauriService, "cmdChatLlmStream").mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve("迟到的回复"), 2000))
    );

    render(<PinWindowApp />);
    fireEvent.click(await screen.findByTestId("tab-chat"));

    const input = (await screen.findByTestId("pin-chat-input")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "生成一段很长的内容" } });
    fireEvent.click(screen.getByTestId("pin-chat-send"));

    // 应该出现停止按钮
    const stopBtn = await screen.findByTestId("pin-chat-stop");
    expect(stopBtn).toBeInTheDocument();

    // 点击停止
    fireEvent.click(stopBtn);
    expect(screen.queryByTestId("pin-chat-stop")).not.toBeInTheDocument();
    expect(screen.getByTestId("pin-chat-send")).toBeInTheDocument();
  });

  it("多模型池下拉切换与智能回退：当前模型未配 Key 时自动选中有 Key 的可用模型", async () => {
    mockSettings = {
      theme: "system",
      hotkey: "F4",
      llmConfig: {
        id: "m_blank",
        provider: "DeepSeek",
        model: "deepseek-chat",
        apiKey: "",
        endpoint: "https://api.deepseek.com/v1",
      },
      llmConfigs: [
        {
          id: "m_blank",
          provider: "DeepSeek",
          model: "deepseek-chat",
          apiKey: "",
          endpoint: "https://api.deepseek.com/v1",
        },
        {
          id: "m_gemini",
          provider: "Custom",
          model: "gemini-3.5-flash-lite",
          apiKey: "sk-gemini-test-123",
          endpoint: "https://api.example.com/v1",
        },
      ],
    };
    localStorage.setItem("cg_translator_settings_v2", JSON.stringify(mockSettings));
    useSettingsStore.setState((s) => ({
      ...s,
      settings: {
        ...s.settings,
        ...mockSettings,
      },
    }));

    render(<PinWindowApp />);
    fireEvent.click(await screen.findByTestId("tab-chat"));

    // 自动回退并渲染包含可用模型的选择器
    const select = (await screen.findByTestId("pin-chat-model-select")) as HTMLSelectElement;
    expect(select).toBeInTheDocument();

    await waitFor(() => {
      expect(select.value).toBe("m_gemini");
    });

    // 支持手动切回或切换其他模型
    fireEvent.change(select, { target: { value: "m_blank" } });
    expect(select.value).toBe("m_blank");
  });

  it("未配置 Key 时提示气泡提供直达设置按钮，点击调用 cmdShowMainWindow", async () => {
    const showMainSpy = vi.spyOn(tauriService, "cmdShowMainWindow");
    mockSettings = {
      theme: "system",
      hotkey: "F4",
      llmConfig: {
        id: "m_none",
        provider: "DeepSeek",
        model: "deepseek-chat",
        apiKey: "",
        endpoint: "https://api.deepseek.com/v1",
      },
      llmConfigs: [
        {
          id: "m_none",
          provider: "DeepSeek",
          model: "deepseek-chat",
          apiKey: "",
          endpoint: "https://api.deepseek.com/v1",
        },
      ],
    };
    localStorage.setItem("cg_translator_settings_v2", JSON.stringify(mockSettings));
    useSettingsStore.setState((s) => ({
      ...s,
      settings: {
        ...s.settings,
        ...mockSettings,
      },
    }));

    render(<PinWindowApp />);
    fireEvent.click(await screen.findByTestId("tab-chat"));

    const input = (await screen.findByTestId("pin-chat-input")) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "你好" } });
    fireEvent.click(screen.getByTestId("pin-chat-send"));

    // 应该出现未检测到有效 API 密钥的提示，以及直达按钮
    expect(await screen.findByText(/未检测到/)).toBeInTheDocument();
    expect(screen.getByText(/有效 API 密钥/)).toBeInTheDocument();
    const btn = screen.getByText("⚙️ 前往主窗口配置 Key");
    expect(btn).toBeInTheDocument();

    fireEvent.click(btn);
    expect(showMainSpy).toHaveBeenCalled();
  });
});
