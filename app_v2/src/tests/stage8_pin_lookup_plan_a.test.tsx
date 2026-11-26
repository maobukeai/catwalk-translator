import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { PinWindowApp } from "../components/Pin/PinWindow";
import { LookupPopupApp } from "../components/Lookup/LookupPopup";
import { useSettingsStore } from "../stores/useSettingsStore";
import { speakText } from "../services/tts";

const mockState = vi.hoisted(() => ({
  isTauriEnv: false,
  lookupPayload: null as any,
}));

const MOCK_PIN_PAYLOAD = {
  id: "stage8_pin_1",
  title: "贴图对照",
  blocks: [
    {
      original: "Subsurface Scattering",
      translated: "次表面散射",
      sourceTier: "LLM API",
      selectedEngineName: "DeepSeek-V3",
      engineOptions: [
        { engineName: "DeepSeek-V3", translated: "次表面散射", sourceTier: "LLM API" },
        { engineName: "DeepL", translated: "次表层散射", sourceTier: "Online" },
      ],
    },
  ],
  x: 100,
  y: 100,
  width: 440,
  height: 520,
};

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("../services/tauri", () => ({
  isTauri: () => mockState.isTauriEnv,
  cmdGetSettings: vi.fn(async () => useSettingsStore.getState().settings),
  cmdGetPinPayload: vi.fn(async () => MOCK_PIN_PAYLOAD),
  cmdClosePin: vi.fn(async () => undefined),
  cmdOpenPin: vi.fn(async () => undefined),
  cmdSetPinAlwaysOnTop: vi.fn(async () => undefined),
  cmdTranslatePhrasesStyled: vi.fn(async ([text]: string[]) => [
    { original: text, translated: `快译: ${text}`, sourceTier: "Flash" },
  ]),
  cmdUniversalTranslate: vi.fn(async ({ text }: { text: string }) => ({
    original: text,
    detectedLang: "en",
    mainTranslation: `精翻: ${text}`,
    engines: [{ engineName: "DeepSeek", translated: `精翻: ${text}`, sourceTier: "LLM" }],
  })),
  fetchAiDeepTranslationAnalysis: vi.fn(async () => null),
  cmdChatLlmStream: vi.fn(async () => "OK"),
  cmdChatLlm: vi.fn(async () => "OK"),
  cmdShowMainWindow: vi.fn(async () => undefined),
  cmdGetLookupPayload: vi.fn(async () => mockState.lookupPayload),
  cmdHideLookupPopup: vi.fn(async () => undefined),
}));

vi.mock("../services/tts", () => ({
  speakText: vi.fn(),
}));

describe("Stage 8 · 贴图悬浮窗与取词浮窗 (方案 A: Vision 液态棱镜)", () => {
  beforeEach(() => {
    mockState.isTauriEnv = false;
    mockState.lookupPayload = null;
    window.location.hash = "#pin=stage8_pin_1";
    localStorage.clear();

    const pool = [
      {
        id: "m1",
        provider: "DeepSeek",
        model: "deepseek-chat",
        apiKey: "sk-test-1",
        endpoint: "https://api.deepseek.com/v1",
        enabled: true,
      },
      {
        id: "m2",
        provider: "OpenAI",
        model: "gpt-4o",
        apiKey: "sk-test-2",
        endpoint: "https://api.openai.com/v1",
        enabled: true,
      },
    ];
    const nextSettings = {
      theme: "light" as const,
      llmConfig: pool[0],
      llmConfigs: pool,
    };
    localStorage.setItem("cg_translator_settings_v2", JSON.stringify(nextSettings));
    useSettingsStore.setState((s) => ({
      ...s,
      settings: {
        ...s.settings,
        ...nextSettings,
      },
    }));
  });

  afterEach(() => {
    cleanup();
    window.location.hash = "";
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("PinWindow 渲染 Vision 液态棱镜机身、气泡、多引擎滑块、输入舱与靠边胶囊", async () => {
    const { container } = render(<PinWindowApp />);
    expect(await screen.findByText("次表面散射")).toBeInTheDocument();

    expect(container.querySelector(".pin-vision-shell")).toBeInTheDocument();
    expect(container.querySelector(".pin-vision-header")).toBeInTheDocument();
    expect(container.querySelector(".pin-vision-bubble-user")).toBeInTheDocument();
    expect(container.querySelector(".pin-vision-bubble-ai")).toBeInTheDocument();
    expect(container.querySelector(".pin-vision-composer")).toBeInTheDocument();

    expect(screen.getByTestId("pin-mode-tab-slider")).toHaveClass("vision-sliding-indicator");
    expect(screen.getByTestId("pin-engine-slider")).toHaveClass("vision-sliding-indicator");

    // 切换靠边收纳态，验证方案 1 Vision 液态棱镜微胶囊拉手（矢量猫爪 + 竖向呼吸灯柱 + 防裁切类）
    fireEvent.click(screen.getByTestId("pin-dock-edge"));
    const capsule = await screen.findByTestId("dock-handle-capsule");
    expect(capsule).toHaveClass("pin-dock-capsule");
    expect(screen.getByTestId("pin-dock-paw-icon")).toBeInTheDocument();
    expect(screen.getByTestId("pin-dock-light-bar")).toHaveClass("pin-dock-breathe-bar");
  });

  it("PinWindow 切至 AI 对话模式时渲染 PinChatView 玻璃模型下拉、预设滑块与术语追问横幅", async () => {
    render(<PinWindowApp />);
    expect(await screen.findByText("次表面散射")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("pin-pursuit-btn"));

    const chatView = await screen.findByTestId("pin-chat-view");
    expect(chatView).toBeInTheDocument();
    expect(screen.getByTestId("pin-chat-model-select")).toBeInTheDocument();
    expect(screen.getByTestId("pin-preset-slider")).toHaveClass("vision-sliding-indicator");
    expect(screen.getByTestId("context-term-banner")).toHaveTextContent("Subsurface Scattering");
  });

  it("LookupPopup 悬停词卡展示 Vision 棱镜壳层、可点击 US/UK 音标胶囊与 CG 领域注释", async () => {
    mockState.isTauriEnv = true;
    mockState.lookupPayload = {
      kind: "hover",
      text: "Subsurface",
      wordDetail: {
        phoneticUs: "/ˌsʌbˈsɜːrfɪs/",
        phoneticUk: "/ˌsʌbˈsɜːfɪs/",
        pos: "adj.",
        definition: "次表面的；表层以下的",
        cgDomainNote: "用于 Blender Principled BSDF 次表面散射参数",
      },
      engines: [{ engineName: "DeepL", translated: "次表层的", sourceTier: "Online" }],
      tsMs: Date.now(),
    };

    const { container } = render(<LookupPopupApp />);
    expect(await screen.findByText("Subsurface")).toBeInTheDocument();

    expect(container.querySelector(".lookup-vision-shell")).toBeInTheDocument();
    expect(screen.getByTestId("lookup-header")).toHaveClass("pin-vision-header");
    expect(screen.getByText("次表面的；表层以下的")).toBeInTheDocument();
    expect(screen.getByText(/Blender Principled BSDF/)).toBeInTheDocument();
    expect(screen.getByText("DeepL")).toBeInTheDocument();

    // 点击美式音标胶囊直接朗读
    fireEvent.click(screen.getByTitle("点击朗读美式发音"));
    expect(speakText).toHaveBeenCalledWith("Subsurface", { lang: "en-US" });
  });

  it("LookupPopup 划词句卡展示原文摘录、主译文、来源标签并支持复制与关闭", async () => {
    mockState.isTauriEnv = true;
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText, readText: vi.fn(() => Promise.resolve("")) },
    });

    mockState.lookupPayload = {
      kind: "selection",
      text: "Clamping indirect light suppresses fireflies.",
      translation: "钳制间接光照可有效抑制萤火虫噪点。",
      sourceTier: "DeepSeek-V3 · 165ms",
      tsMs: Date.now(),
    };

    const { cmdHideLookupPopup } = await import("../services/tauri");
    render(<LookupPopupApp />);

    expect(await screen.findByText("钳制间接光照可有效抑制萤火虫噪点。")).toBeInTheDocument();
    expect(screen.getByText("划词翻译")).toBeInTheDocument();
    expect(screen.getByText("DeepSeek-V3 · 165ms")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("复制"));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("钳制间接光照可有效抑制萤火虫噪点。");
    });

    fireEvent.click(screen.getByTitle("关闭 (Esc)"));
    expect(cmdHideLookupPopup).toHaveBeenCalled();
  });
});
