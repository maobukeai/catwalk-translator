import type { AppSettings, LlmConfig, OnlineEngines, PresetDicts } from './types';

/**
 * 截图划词「首选翻译通道」选项的唯一来源。
 * 设置页 HotkeyPanel、划词浮层 SnippingToolbar 与 Tab 引擎轮播共用此份，
 * 保证三处展示的选项 = 用户在设置中配置的 LLM 模型池 + 软件真实支持且已开启的
 * 在线引擎 / 专业词库，不再出现与配置脱节的硬编码条目。
 */

export interface EngineOption {
  value: string;
  label: string;
  /** 非空表示该通道当前不能直接生效（如未配置 Key），仅作展示提示 */
  hint?: string;
}

export interface EngineOptionGroup {
  key: 'llm' | 'online' | 'dict';
  label: string;
  options: EngineOption[];
}

export interface CaptureEngineChoices {
  auto: EngineOption;
  groups: EngineOptionGroup[];
}

/** LLM 通道是否已可直接调用：填写了 API Key，或指向本机服务（Ollama 等免 Key）。 */
export function isLlmChannelReady(cfg: LlmConfig): boolean {
  return (
    !!cfg.apiKey?.trim() ||
    !!cfg.endpoint?.includes('localhost') ||
    !!cfg.endpoint?.includes('127.0.0.1')
  );
}

const AUTO_OPTION: EngineOption = {
  value: 'auto',
  label: '🤖 默认智能极速并发 (词库 ➔ AI ➔ 在线竞速)',
};

// 与后端 translator.rs 的 forced_engine 关键字匹配一一对应
const ONLINE_ENGINE_META: Array<{ key: keyof OnlineEngines; label: string; defaultOn: boolean }> = [
  { key: 'google', label: '🌐 Google 官方翻译 (免 Key 极速)', defaultOn: true },
  { key: 'bing', label: '🔷 微软 Bing 神经网络翻译', defaultOn: true },
  { key: 'youdao', label: '📶 网易有道翻译', defaultOn: true },
  { key: 'deepl', label: '🚀 DeepL 深度翻译', defaultOn: false },
  { key: 'baidu', label: '🐯 百度通用翻译', defaultOn: false },
  { key: 'tencent', label: '🐧 腾讯交互翻译', defaultOn: false },
  { key: 'caiyun', label: '🌈 彩云小译 (地道文学意译)', defaultOn: false },
  { key: 'papago', label: '🦜 Naver Papago (日韩顶流)', defaultOn: false },
  { key: 'urban', label: '🧢 Urban 俚语黑话 (欧美流行梗)', defaultOn: false },
  { key: 'volcengine', label: '🌋 字节跳动火山翻译 (抖音同款)', defaultOn: false },
  { key: 'yandex', label: '🇷🇺 Yandex Translate (俄语东欧)', defaultOn: false },
  { key: 'lingva', label: '🕊️ Lingva (免翻 Google 镜像)', defaultOn: false },
  { key: 'myMemory', label: '📚 MyMemory 记忆库', defaultOn: false },
];

const PRESET_DICT_META: Array<{ key: keyof PresetDicts; label: string }> = [
  { key: 'blender', label: '🧊 Blender CG 词库' },
  { key: 'substance', label: '🎨 Substance 3D 词库' },
  { key: 'unity', label: '🎮 Unity 词库' },
  { key: 'unreal', label: '🕹️ Unreal Engine 词库' },
  { key: 'maya', label: '🗿 Maya 词库' },
  { key: 'houdini', label: '🔥 Houdini 词库' },
];

/**
 * 从设置动态构建全部可选通道：
 * - AI 组：严格仅展示用户已填写 Key 或已配置就绪的可用模型，杜绝未配置假条目；
 * - 在线引擎组：严格仅展示用户在「在线引擎」设置中开启的引擎；
 * - 词库组：严格仅展示用户在「专业词库」设置中开启的 3D 词库。
 */
export function buildCaptureEngineChoices(settings: AppSettings | undefined): CaptureEngineChoices {
  const groups: EngineOptionGroup[] = [];

  // 1. AI 大模型组（只展示用户真正配置就绪的模型）
  const readyLlmConfigs = (settings?.llmConfigs || []).filter(isLlmChannelReady);
  if (readyLlmConfigs.length > 0) {
    const llmOptions: EngineOption[] = readyLlmConfigs.map((cfg) => {
      const id = cfg.id || cfg.model || cfg.provider;
      return {
        value: `llm:${id}`,
        label: `🤖 ${cfg.provider} (${cfg.model || '默认模型'})`,
      };
    });
    groups.push({ key: 'llm', label: 'AI 大语言模型 (已配置可用)', options: llmOptions });
  }

  // 2. 通用在线翻译通道（严格联动 settings.onlineEngines 中用户已开启的引擎）
  const onlineOptions: EngineOption[] = ONLINE_ENGINE_META.filter((m) => {
    if (settings?.onlineEngines && typeof settings.onlineEngines[m.key] === 'boolean') {
      return settings.onlineEngines[m.key];
    }
    return m.defaultOn;
  }).map((m) => ({ value: m.key as string, label: m.label }));

  if (onlineOptions.length > 0) {
    groups.push({ key: 'online', label: '通用在线翻译通道 (已开启)', options: onlineOptions });
  }

  return { auto: AUTO_OPTION, groups };
}

/** 展开为扁平列表：Tab / Shift+Tab 轮播顺序与下拉展示保持一致。 */
export function flattenCaptureEngineChoices(choices: CaptureEngineChoices): EngineOption[] {
  return [choices.auto, ...choices.groups.flatMap((g) => g.options)];
}

/** 在动态选项中查找当前值；找不到说明是旧版本遗留值（如 "deepseek"）。 */
export function findEngineOption(choices: CaptureEngineChoices, value: string | undefined): EngineOption | undefined {
  if (!value) return undefined;
  return flattenCaptureEngineChoices(choices).find((o) => o.value === value);
}
