import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  RotateCcw,
  Save,
  CheckCircle2,
  Camera,
  Zap,
  Bot,
  BookOpen,
  Sliders,
  Sparkles,
  ShieldCheck,
  Globe,
  Palette,
  Sun,
  Moon,
  Monitor,
  Plus,
  Trash2,
  Edit3,
  Search,
  Download,
  Upload,
  X,
  FileSpreadsheet,
  Copy,
  Check,
  Type,
  Languages,
  Tag,
  FileText,
  WifiOff,
  HardDriveDownload,
} from 'lucide-react';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useAppTheme } from '../../hooks/useAppTheme';
import { OcrModelsCard } from './OcrModelsCard';
import { cmdGetOcrEngineStatus, cmdFetchLlmModels, cmdOfflineStatus, cmdOfflineInstall, cmdOfflineUninstall } from '../../services/tauri';
import type { OfflineEngineStatus } from '../../services/tauri';
import type {
  LlmConfig,
  OcrEngineStatus,
  ThemeMode,
  FontFamilyOption,
  FontSizeOption,
  CustomDictItem,
} from '../../services/types';

const isTestEnv = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);

const PROVIDER_DEFAULT_ENDPOINTS: Record<string, { endpoint: string; model: string }> = {
  DeepSeek: {
    endpoint: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  OpenAI: {
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  Ollama: {
    endpoint: 'http://localhost:11434/v1',
    model: 'llama3',
  },
  '智谱 GLM': {
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
  },
  Custom: {
    endpoint: 'https://api.custom-llm.com/v1',
    model: 'custom-model',
  },
};

const ONLINE_ENGINE_DEFS = [
  {
    id: 'google',
    name: 'Google 翻译 (官方通道)',
    tag: '快速稳定',
    tagColor: 'text-blue-300 bg-blue-500/15 border-blue-400/30',
    desc: '谷歌高质量公共多语言通道，响应迅速，支持全语种',
    icon: '🌐',
  },
  {
    id: 'bing',
    name: '微软 Bing 必应翻译',
    tag: '神经翻译',
    tagColor: 'text-sky-300 bg-sky-500/15 border-sky-400/30',
    desc: '微软神经网络智能翻译引擎，长短句自然流畅',
    icon: '🔷',
  },
  {
    id: 'youdao',
    name: '网易有道翻译',
    tag: '地道中英',
    tagColor: 'text-rose-300 bg-rose-500/15 border-rose-400/30',
    desc: '网易专业词典与智能翻译通道，中文与中英互译极度地道',
    icon: '🔴',
  },
  {
    id: 'deepl',
    name: 'DeepL 极速翻译通道',
    tag: '德系精准',
    tagColor: 'text-teal-300 bg-teal-500/15 border-teal-400/30',
    desc: '欧洲顶级高语境翻译引擎，长难句与学术语境翻译首选',
    icon: '⚡',
  },
  {
    id: 'myMemory',
    name: 'MyMemory 翻译记忆库',
    tag: '语料记忆库',
    tagColor: 'text-indigo-300 bg-indigo-500/15 border-indigo-400/30',
    desc: '全球大型翻译记忆库，汇聚数亿条人工翻译真实语料',
    icon: '🧠',
  },
  {
    id: 'baidu',
    name: '百度通用翻译',
    tag: '中文优化',
    tagColor: 'text-blue-300 bg-blue-500/15 border-blue-400/30',
    desc: '百度中文语义增强翻译引擎，多语种覆盖全面',
    icon: '🐾',
  },
  {
    id: 'tencent',
    name: '腾讯交互翻译',
    tag: 'AI实验室',
    tagColor: 'text-cyan-300 bg-cyan-500/15 border-cyan-400/30',
    desc: '腾讯 AI 翻译实验室神经机器翻译，专业流畅',
    icon: '🐧',
  },
] as const;

type SettingCategory = 'appearance' | 'hotkey' | 'online' | 'dicts' | 'preference';

const PRESET_DICTS_DATA: Record<string, { title: string; desc: string; terms: Record<string, string> }> = {
  blender: {
    title: 'Blender 材质与节点词库',
    desc: '3D/CG 节点、Shader 着色器与材质术语',
    terms: {
      "Principled BSDF": "原理化 BSDF",
      "Subsurface": "次表面",
      "Subsurface Scattering": "次表面散射",
      "Subsurface Radius": "次表面半径",
      "Roughness": "粗糙度",
      "Metallic": "金属度",
      "Anisotropic Tangent": "各向异性切线",
      "Sheen Tint": "光泽染色",
      "Clearcoat Roughness": "清漆粗糙度",
      "IOR": "折射率",
      "Transmission": "透射",
      "Emission": "自发光",
      "Normal Map": "法线贴图",
      "Bump Map": "凹凸贴图",
      "Displacement": "置换",
      "Environment Texture": "环境纹理",
      "Base Color": "基础色",
      "Subdivision Surface": "细分曲面",
      "Bevel": "倒角",
      "Boolean": "布尔",
      "Solidify": "实体化",
      "Array": "阵列",
      "Mirror": "镜像",
      "Remesh": "重构网格",
      "Shrinkwrap": "缩裹",
      "EEVEE Next": "EEVEE Next 渲染引擎",
      "Cycles": "Cycles 渲染器",
      "Denoising": "降噪",
      "Ray Tracing": "光线追踪",
      "Bloom": "泛光",
      "AgX": "AgX 色彩空间"
    }
  },
  substance: {
    title: 'Substance Painter 词库',
    desc: 'Height Range、AO 混合模式、Curvature 等贴图绘制面板术语',
    terms: {
      "Height Range": "高度范围",
      "AO Mixing Mode": "AO混合模式",
      "Curvature Blur Radius": "曲率模糊半径",
      "Subsurface": "次表面",
      "Roughness": "粗糙度",
      "Base Color": "基础色",
      "Metallic": "金属度",
      "Normal Space": "法线空间",
      "Opacity": "不透明度",
      "Curvature": "曲率",
      "World Space Normal": "世界空间法线",
      "Position": "位置图",
      "Thickness": "厚度图",
      "Smart Material": "智能材质",
      "Smart Mask": "智能遮罩",
      "Anchor Point": "锚点",
      "Tri-planar Projection": "三平面投影",
      "Metal Edge Wear": "金属边缘磨损"
    }
  },
  unity: {
    title: 'Unity 引擎词库',
    desc: 'NavMesh Surface、Rigidbody、Skinned Mesh Renderer 等组件属性',
    terms: {
      "NavMesh Surface": "NavMesh 表面",
      "NavMesh Agent": "NavMesh 寻路代理",
      "RigidBody Interpolate": "刚体插值",
      "Skinned Mesh Renderer Bounds": "蒙皮网格渲染器包围盒",
      "Base Color": "基础颜色",
      "Universal Render Pipeline": "通用渲染管线",
      "High Definition Render Pipeline": "高清晰度渲染管线",
      "Shader Graph": "着色器图表",
      "Mesh Renderer": "网格渲染器",
      "Global Illumination": "全局光照",
      "Lightmap": "光照贴图",
      "Screen Space Reflection": "屏幕空间反射",
      "Collision Detection": "碰撞检测",
      "Character Controller": "角色控制器",
      "Box Collider": "盒状碰撞体"
    }
  },
  unreal: {
    title: 'Unreal Engine 5 词库',
    desc: 'Nanite、Lumen、Virtual Shadow Map 等次时代渲染管线术语',
    terms: {
      "Nanite": "Nanite 虚拟化微多边形几何体",
      "Lumen": "Lumen 全局光照与反射",
      "World Partition": "世界分区系统",
      "Chaos Physics": "Chaos 物理与毁灭系统",
      "MetaHuman": "MetaHuman 高精度写实角色系统",
      "Blueprint": "蓝图可视化脚本",
      "Control Rig": "绑定控制动画绑定",
      "Sequencer": "Sequencer 过场动画编辑器",
      "Niagara": "Niagara 粒子特效系统",
      "Substrate": "Substrate 模块化材质系统",
      "Virtual Shadow Maps": "虚拟阴影贴图 (VSM)",
      "PCG": "程序化内容生成框架 (PCG)",
      "Metasound": "MetaSound 高性能音频图表",
      "Landscape": "地形系统",
      "Foliage": "植被刷工具",
      "Material Editor": "材质编辑器",
      "Post Process Volume": "后期处理体积",
      "Level Instance": "关卡实例",
      "Static Mesh": "静态网格体",
      "Skeletal Mesh": "骨骼网格体",
      "Actor": "Actor 场景物件",
      "Component": "组件",
      "Event Graph": "事件图表",
      "Construction Script": "构造脚本"
    }
  },
  maya: {
    title: 'Autodesk Maya 词库',
    desc: 'Bifrost、XGen、Arnold 渲染与程序化建模术语',
    terms: {
      "Bifrost": "Bifrost 流体与粒子程序化图表",
      "XGen": "XGen 毛发与植被生成系统",
      "Arnold Render": "Arnold 阿诺德渲染器",
      "MASH": "MASH 程序化运动图形工具集",
      "Skin Cluster": "皮肤蒙皮簇 (Skin Cluster)",
      "BlendShape": "融合变形 (BlendShape / 形变键)",
      "IK Handle": "IK 反向动力学句柄",
      "Constraint": "约束",
      "Outliner": "大纲视图 (Outliner)",
      "Node Editor": "节点编辑器",
      "Hypershade": "Hypershade 材质与着色器图表",
      "Graph Editor": "曲线编辑器",
      "Channel Box": "通道盒",
      "Attribute Editor": "属性编辑器",
      "UV Editor": "UV 编辑器",
      "Retopology": "重拓扑工具",
      "Quad Draw": "四边形绘制拓扑工具"
    }
  },
  houdini: {
    title: 'Houdini 程序化词库',
    desc: 'SOP/DOP 层级、VEX 表达式、FLIP 解算等节点术语',
    terms: {
      "SOP": "SOP 几何体节点层级 (Surface Operator)",
      "DOP": "DOP 动态动力学解算层级 (Dynamic Operator)",
      "VOP": "VOP 向量着色器/程序化节点 (VEX Operator)",
      "ROP": "ROP 渲染输出层级 (Render Operator)",
      "COP": "COP 合成节点层级 (Composite Operator)",
      "TOP": "TOP 任务与工作流节点 (Task Operator / PDG)",
      "Vellum": "Vellum 软体/布料/流体解算器",
      "Pyro FX": "Pyro 烟火与火焰烟雾解算器",
      "RBD Material Fracture": "RBD 刚体破碎材质破碎节点",
      "FLIP Fluid": "FLIP 粒子流体解算",
      "Solaris": "Solaris USD 组装与渲染环境",
      "Karma Render": "Karma USD 原生渲染引擎",
      "VEX": "VEX 高性能节点表达式语言",
      "Wrangler": "Attribute Wrangle 属性表达节点",
      "Packed Primitive": "打包基元 (Packed Primitive)",
      "Point Velocity": "点速度属性"
    }
  }
};

const OCR_STATUS_STYLE: Record<string, string> = {
  idle: 'text-zinc-300 bg-zinc-500/15 border-zinc-400/30',
  warming: 'text-amber-300 bg-amber-500/15 border-amber-400/30 animate-pulse',
  ready: 'text-emerald-300 bg-emerald-500/15 border-emerald-400/30',
  failed: 'text-rose-300 bg-rose-500/15 border-rose-400/30',
  unknown: 'text-zinc-400 bg-zinc-500/15 border-zinc-400/20',
};

interface SettingsDashboardProps {
  onStartCapture?: () => void;
  onTriggerSpotlight?: () => void;
  onTriggerClipboard?: () => void;
  onToggleWindow?: () => void;
  onOpenAbout?: () => void;
}

export const SettingsDashboard: React.FC<SettingsDashboardProps> = ({
  onStartCapture,
  onTriggerSpotlight,
  onTriggerClipboard,
  onToggleWindow,
  onOpenAbout,
}) => {
  const {
    settings,
    isDirty,
    isLoading,
    isSaving,
    toastMessage,
    fetchSettings,
    saveSettings,
    setHotkey,
    setSpotlightHotkey,
    setClipboardHotkey,
    setToggleWindowHotkey,
    setCaptureHotkeyEnabled,
    setSpotlightHotkeyEnabled,
    setClipboardHotkeyEnabled,
    setToggleWindowHotkeyEnabled,
    setDefaultPreset,
    setCaptureEngine,
    setLlmConfig,
    addLlmConfig,
    updateLlmConfig,
    deleteLlmConfig,
    setActiveLlmConfig,
    setPresetDictToggle,
    setOnlineEngineToggle,
    setAllOnlineEngines,
    moveTier,
    setAppearance,
    setThemeMode,
    setEnableBlur,
    setBlurAmount,
    setFontFamilyOption,
    setFontSizeOption,
    addCustomDictItem,
    updateCustomDictItem,
    deleteCustomDictItem,
    importCustomDictItems,
    setOfflineModelInstalled,
    setOfflineModelEnabled,
    installOfflineModel,
    uninstallOfflineModel,
    setActiveOfflineModel,
    setCaptureReleaseAction,
    setWatchIntervalMs,
    setClipboardWatchEnabled,
    setOcrEngine,
    setPrimaryTranslationEngine,
    setBaiduConfig,
    setDeeplConfig,
    setCloseAction,
    setMiniWindowCloseAction,
    resetSettings,
    clearToast,
  } = useSettingsStore();

  const appearance = settings.appearance || {
    theme: 'system',
    enableBlur: true,
    blurAmount: 24,
    enableTransparency: true,
    windowOpacity: 85,
    fontFamily: 'system',
    fontSize: 'medium',
  };
  void setAppearance;

  const activeTheme = appearance.theme || 'system';
  const { isLight } = useAppTheme();

  const [activeCategory, setActiveCategory] = useState<SettingCategory>('appearance');
  const [showApiKey, setShowApiKey] = useState(false);
  const [recordingTarget, setRecordingTarget] = useState<'capture' | 'spotlight' | 'clipboard' | 'toggleWindow' | null>(null);
  const [testLatency, setTestLatency] = useState<number | null>(null);
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [testSuccess, setTestSuccess] = useState<boolean | null>(null);
  const [isTestingLlm, setIsTestingLlm] = useState(false);
  const [ocrStatus, setOcrStatus] = useState<OcrEngineStatus | null>(null);

  // 词库浏览与自定义词条 CRUD 状态
  const [presetViewerDictKey, setPresetViewerDictKey] = useState<string | null>(null);
  const [presetSearchQuery, setPresetSearchQuery] = useState('');
  
  const [customSearchQuery, setCustomSearchQuery] = useState('');
  const [showAddEditModal, setShowAddEditModal] = useState(false);
  const [editingCustomItem, setEditingCustomItem] = useState<CustomDictItem | null>(null);

  // Modal 表单状态
  const [formOriginal, setFormOriginal] = useState('');
  const [formTranslated, setFormTranslated] = useState('');
  const [formCategory, setFormCategory] = useState('通用CG');
  const [formNote, setFormNote] = useState('');
  const [copiedTerm, setCopiedTerm] = useState<string | null>(null);

  // 离线词库引擎：真实文件系统安装状态（Rust 端 offline.rs，无模拟下载）
  const [offlineEngineStatus, setOfflineEngineStatus] = useState<OfflineEngineStatus | null>(null);
  const [offlineBusy, setOfflineBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    cmdOfflineStatus()
      .then((st) => { if (!cancelled) setOfflineEngineStatus(st); })
      .catch(() => { if (!cancelled) setOfflineEngineStatus(null); });
    return () => { cancelled = true; };
  }, []);

  const handleOfflineInstall = async () => {
    setOfflineBusy(true);
    try {
      const st = await cmdOfflineInstall();
      setOfflineEngineStatus(st);
      if (st.installed) {
        installOfflineModel(st.modelId, st.modelName, Math.max(1, Math.round(st.storageBytes / (1024 * 1024))));
      }
    } catch (err) {
      console.warn('离线引擎安装失败:', err);
    } finally {
      setOfflineBusy(false);
    }
  };

  const handleOfflineUninstall = async () => {
    setOfflineBusy(true);
    try {
      const st = await cmdOfflineUninstall();
      setOfflineEngineStatus(st);
      if (!st.installed) {
        uninstallOfflineModel(offlineEngineStatus?.modelId || 'offline-phrase-dict-v1');
      }
    } catch (err) {
      console.warn('离线引擎卸载失败:', err);
    } finally {
      setOfflineBusy(false);
    }
  };

  const openAddModal = () => {
    setEditingCustomItem(null);
    setFormOriginal('');
    setFormTranslated('');
    setFormCategory('通用CG');
    setFormNote('');
    setShowAddEditModal(true);
  };

  const openEditModal = (item: CustomDictItem) => {
    setEditingCustomItem(item);
    setFormOriginal(item.original);
    setFormTranslated(item.translated);
    setFormCategory(item.category || '通用CG');
    setFormNote(item.note || '');
    setShowAddEditModal(true);
  };

  const handleSaveCustomTerm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formOriginal.trim() || !formTranslated.trim()) return;

    if (editingCustomItem) {
      updateCustomDictItem({
        ...editingCustomItem,
        original: formOriginal.trim(),
        translated: formTranslated.trim(),
        category: formCategory,
        note: formNote.trim(),
      });
    } else {
      addCustomDictItem({
        original: formOriginal.trim(),
        translated: formTranslated.trim(),
        category: formCategory,
        note: formNote.trim(),
      });
    }
    setShowAddEditModal(false);
  };

  const handleExportCsv = () => {
    const items = settings.customDictItems || [];
    if (items.length === 0) return;
    const csvLines = [
      '原词,译文,分类,备注',
      ...items.map(i => `"${i.original}","${i.translated}","${i.category || '通用CG'}","${i.note || ''}"`)
    ];
    const blob = new Blob(['\uFEFF' + csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `custom_cg_dictionary_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      if (!text) return;
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      const parsed: { original: string; translated: string; category?: string; note?: string }[] = [];
      lines.forEach((line, idx) => {
        if (idx === 0 && (line.includes('原词') || line.includes('original'))) return;
        const parts = line.split(',').map(p => p.replace(/^"|"$/g, '').trim());
        if (parts.length >= 2 && parts[0] && parts[1]) {
          parsed.push({
            original: parts[0],
            translated: parts[1],
            category: parts[2] || '通用CG',
            note: parts[3] || '',
          });
        }
      });
      if (parsed.length > 0) {
        importCustomDictItems(parsed);
      }
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    let cancelled = false;
    cmdGetOcrEngineStatus()
      .then((s) => { if (!cancelled) setOcrStatus(s); })
      .catch(() => { if (!cancelled) setOcrStatus({ status: 'unknown', detail: 'OCR 引擎状态查询失败（演示环境）' }); });
    return () => { cancelled = true; };
  }, [settings.ocrVersion]);

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        clearToast();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage, clearToast]);

  const llm = (settings.llmConfig as (LlmConfig & { availableModels?: string[] })) || {
    provider: 'DeepSeek',
    apiKey: '',
    model: 'deepseek-chat',
    endpoint: 'https://api.deepseek.com/v1',
  };

  const llmPool: LlmConfig[] = settings.llmConfigs && settings.llmConfigs.length > 0
    ? settings.llmConfigs
    : (llm ? [llm] : []);

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newProvider = e.target.value;
    const defaults = PROVIDER_DEFAULT_ENDPOINTS[newProvider] || PROVIDER_DEFAULT_ENDPOINTS.Custom;
    setLlmConfig({
      provider: newProvider,
      endpoint: defaults.endpoint,
      model: defaults.model,
    });
  };

  const handleAddModel = (provider: string) => {
    const defaults = PROVIDER_DEFAULT_ENDPOINTS[provider] || PROVIDER_DEFAULT_ENDPOINTS.Custom;
    addLlmConfig({
      provider,
      model: defaults.model,
      endpoint: defaults.endpoint,
    });
    setShowModelPicker(false);
  };

  const [showModelPicker, setShowModelPicker] = useState(false);

  const handleTestLlmConnection = async () => {
    setIsTestingLlm(true);
    setTestLatency(null);
    setTestStatus(null);
    setTestSuccess(null);
    const start = performance.now();

    if (!llm.endpoint) {
      setTestStatus('未配置 API 接口地址');
      setTestSuccess(false);
      setIsTestingLlm(false);
      return;
    }

    if (isTestEnv) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      setTestLatency(Math.round(performance.now() - start));
      setTestSuccess(true);
      setTestStatus('模拟环境：测试通过');
      setIsTestingLlm(false);
      return;
    }

    try {
      const modelList = await cmdFetchLlmModels(llm.endpoint, llm.apiKey);
      const elapsed = Math.max(12, Math.round(performance.now() - start));
      setTestLatency(elapsed);
      setTestSuccess(true);
      setTestStatus(`连接成功 (延迟 ${elapsed}ms，识别到 ${modelList.length} 个可用模型)`);
    } catch (err) {
      setTestSuccess(false);
      setTestLatency(null);
      const rawMsg = typeof err === 'string' ? err : (err as Error)?.message || '网络连接失败';
      setTestStatus(`连接失败：${rawMsg}`);
    } finally {
      setIsTestingLlm(false);
    }
  };

  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>(llm.availableModels || []);
  const [fetchModelNotice, setFetchModelNotice] = useState<string | null>(null);

  const handleFetchModels = async () => {
    if (!llm.endpoint) return;
    setIsFetchingModels(true);
    setFetchModelNotice(null);

    // Pre-flight check for API Key
    const isLocal = llm.endpoint.includes('localhost') || llm.endpoint.includes('127.0.0.1');
    if (!llm.apiKey && !isLocal) {
      setFetchModelNotice('⚠️ 未配置 API Key，请先在下方填入 API 密钥后再试。');
      setIsFetchingModels(false);
      return;
    }

    try {
      // Call native Rust HTTP client (bypasses browser CORS & supports custom gateway endpoints)
      const modelList = await cmdFetchLlmModels(llm.endpoint, llm.apiKey);

      if (modelList && modelList.length > 0) {
        setFetchedModels(modelList);
        setLlmConfig({ availableModels: modelList });
        if (!modelList.includes(llm.model)) {
          setLlmConfig({ model: modelList[0] });
        }
        setFetchModelNotice(`已成功拉取 ${modelList.length} 个可用模型！`);
      } else {
        setFetchModelNotice('获取成功，但未解析到模型列表');
      }
    } catch (err) {
      console.warn('Fetch models failed:', err);
      const rawMsg = typeof err === 'string' ? err : (err as Error)?.message || '';
      let friendly = '网络连接异常';
      if (rawMsg.includes('Failed to fetch') || rawMsg.includes('fetch failed')) {
        friendly = `无法连接到 ${llm.provider} 接口 (Failed to fetch)。请检查网络代理或 Base URL 地址。`;
      } else if (rawMsg.includes('401') || rawMsg.includes('Unauthorized')) {
        friendly = `API Key 验证失败 (401 Unauthorized)。请核对密钥。`;
      } else if (rawMsg.includes('404')) {
        friendly = `接口路径 404 (Not Found)。请确认 Base URL。`;
      } else {
        friendly = rawMsg;
      }
      setFetchModelNotice(`⚠️ 拉取失败: ${friendly}`);
    } finally {
      setIsFetchingModels(false);
    }
  };

  useEffect(() => {
    if (!recordingTarget) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setRecordingTarget(null);
        return;
      }

      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
        return;
      }

      const keys: string[] = [];
      if (e.ctrlKey) keys.push('Ctrl');
      if (e.altKey) keys.push('Alt');
      if (e.shiftKey) keys.push('Shift');
      if (e.metaKey) keys.push('Win');

      let mainKey = e.key.toUpperCase();
      if (e.code.startsWith('Key')) {
        mainKey = e.code.replace('Key', '');
      } else if (e.code.startsWith('Digit')) {
        mainKey = e.code.replace('Digit', '');
      } else if (e.code.startsWith('F') && e.code.length <= 4) {
        mainKey = e.code;
      }

      if (mainKey && !['CONTROL', 'ALT', 'SHIFT', 'META'].includes(mainKey)) {
        if (!keys.includes(mainKey)) {
          keys.push(mainKey);
        }
      }

      if (keys.length > 0) {
        const combo = keys.join('+');
        if (recordingTarget === 'capture') setHotkey(combo);
        else if (recordingTarget === 'spotlight') setSpotlightHotkey(combo);
        else if (recordingTarget === 'clipboard') setClipboardHotkey(combo);
        else if (recordingTarget === 'toggleWindow') setToggleWindowHotkey(combo);

        setRecordingTarget(null);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown, true);
    };
  }, [recordingTarget, setHotkey, setSpotlightHotkey, setClipboardHotkey, setToggleWindowHotkey]);

  if (isLoading) {
    return (
      <div className="flex h-full min-h-[400px] items-center justify-center text-zinc-400">
        <div className="flex items-center space-x-2.5 text-xs text-zinc-400">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"></div>
          <span>正在加载设置项...</span>
        </div>
      </div>
    );
  }

  const online = settings.onlineEngines || {
    google: true,
    bing: true,
    youdao: true,
    deepl: false,
    myMemory: false,
    baidu: false,
    tencent: false,
  };

  const activeOnlineCount = ONLINE_ENGINE_DEFS.filter(
    (e) => (online as Record<string, boolean | undefined>)[e.id] ?? false
  ).length;

  const categories = [
    { id: 'appearance', label: '外观与个性化', icon: Palette },
    { id: 'hotkey', label: '快捷键与 AI 模型', icon: Zap },
    { id: 'online', label: '在线引擎', badge: activeOnlineCount, icon: Globe },
    { id: 'dicts', label: '专业词库', icon: BookOpen },
    { id: 'preference', label: '优先级', icon: Sliders },
  ] as const;

  return (
    <div className="mx-auto max-w-4xl space-y-5 text-zinc-200 font-sans pb-10">
      {/* Toast 操作通知 */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center space-x-2.5 rounded-xl bg-zinc-900/90 border border-emerald-500/40 px-4 py-3 text-xs text-zinc-100 shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-3 duration-200">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <span className="font-medium">{toastMessage}</span>
        </div>
      )}

      {/* 顶部 Header：标题 + 始终常驻的全局保存/重置按钮 */}
      <div className="flex flex-col gap-3.5 sm:flex-row sm:items-center sm:justify-between border-b border-white/[0.08] pb-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className={`text-lg font-bold tracking-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>系统设置</h1>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-mono font-medium shadow-xs ${
              isLight ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-blue-500/15 border-blue-400/30 text-blue-300'
            }`}>
              v2.0.1
            </span>
          </div>
          <p className={`mt-0.5 text-xs ${isLight ? 'text-slate-500 font-medium' : 'text-zinc-400'}`}>
            配置快捷键、翻译引擎、AI 模型与界面外观
          </p>
        </div>

        <div className="flex items-center space-x-2 shrink-0 whitespace-nowrap self-start sm:self-auto">
          {isDirty && (
            <span className="flex items-center space-x-1 text-xs font-medium text-amber-300 bg-amber-500/15 border border-amber-400/30 px-2.5 py-1 rounded-lg animate-pulse whitespace-nowrap shrink-0">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>未保存</span>
            </span>
          )}

          <button
            type="button"
            onClick={resetSettings}
            disabled={!isDirty}
            className={`flex items-center space-x-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition cursor-pointer whitespace-nowrap shrink-0 ${
              isLight
                ? 'border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-40'
                : 'border-white/15 bg-white/10 text-zinc-200 hover:bg-white/20 hover:text-white disabled:opacity-30'
            }`}
          >
            <RotateCcw className="h-3.5 w-3.5 shrink-0" />
            <span className="whitespace-nowrap">重置</span>
          </button>

          <button
            type="button"
            onClick={saveSettings}
            disabled={!isDirty || isSaving}
            className="flex items-center space-x-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-3.5 py-1.5 text-xs font-medium text-white shadow-sm disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer border border-blue-400/40 whitespace-nowrap shrink-0"
          >
            <Save className="h-3.5 w-3.5 shrink-0" />
            <span className="whitespace-nowrap">{isSaving ? '保存中...' : '保存更改'}</span>
          </button>
        </div>
      </div>

      {/* 顶部二级分类分段选择器 */}
      <nav
        className={`flex items-center gap-1 p-1 rounded-xl border shadow-2xs backdrop-blur-md transition-colors ${
          isLight
            ? 'bg-black/[0.04] border-black/[0.06]'
            : 'bg-white/[0.06] border-white/[0.08]'
        }`}
        aria-label="设置分类"
      >
        {categories.map((cat) => {
          const Icon = cat.icon;
          const isActive = activeCategory === cat.id;
          const badgeCount = 'badge' in cat ? cat.badge : undefined;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveCategory(cat.id as SettingCategory)}
              className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer select-none whitespace-nowrap ${
                isActive
                  ? isLight
                    ? 'bg-white text-blue-600 shadow-sm border border-black/[0.06] font-bold'
                    : 'bg-white/15 text-white shadow-sm border border-white/15 font-bold'
                  : isLight
                  ? 'text-slate-600 hover:text-slate-900 hover:bg-black/[0.03]'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.05]'
              }`}
            >
              <Icon
                className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                  isActive
                    ? isLight
                      ? 'text-blue-600'
                      : 'text-blue-400'
                    : isLight
                    ? 'text-slate-500'
                    : 'text-zinc-400'
                }`}
              />
              <span className="truncate">{cat.label}</span>
              {badgeCount !== undefined && (
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold leading-none shrink-0 transition-colors ${
                    isActive
                      ? isLight
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-blue-500/25 text-blue-300'
                      : isLight
                      ? 'bg-black/[0.06] text-slate-600'
                      : 'bg-white/10 text-zinc-400'
                  }`}
                >
                  {badgeCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* 分类: 外观与个性化 */}
      {activeCategory === 'appearance' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          <div className={`p-5 space-y-5 rounded-2xl border transition-colors ${
            isLight ? 'bg-white/45 backdrop-blur-md border-slate-200/80 shadow-sm text-slate-800' : 'bg-zinc-900/50 border-white/[0.08] text-zinc-100'
          }`}>
            <div>
              <div className={`flex items-center space-x-2 text-sm font-bold ${isLight ? 'text-slate-800' : 'text-white'}`}>
                <Palette className="h-4 w-4 text-purple-400" />
                <span>外观与个性化</span>
              </div>
              <p className={`mt-1 text-xs ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                自定义界面视觉主题、高斯模糊透明度、全局字体及字号缩放
              </p>
            </div>

            {/* 1. Live Preview Card 实时效果预览 (紧凑型设计，减少垂直占用) */}
            <div className={`relative overflow-hidden rounded-xl border p-3 space-y-2.5 shadow-xs transition-all ${
              isLight ? 'border-slate-300/80 bg-white/45 backdrop-blur-md' : 'border-white/10 bg-zinc-950/80'
            }`}>
              <div className={`flex flex-wrap items-center justify-between gap-1.5 border-b pb-2 relative z-10 ${
                isLight ? 'border-slate-200' : 'border-white/[0.08]'
              }`}>
                <div className={`flex items-center space-x-1.5 text-xs font-bold ${
                  isLight ? 'text-slate-800' : 'text-zinc-200'
                }`}>
                  <Sparkles className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                  <span>效果预览</span>
                </div>
                
                {/* 状态徽章 (紧凑高对比度) */}
                <div className="flex flex-wrap items-center gap-1 text-[10px] font-mono">
                  <span className={`px-2 py-0.5 rounded-full font-semibold border shadow-xs ${
                    isLight ? 'bg-blue-100 text-blue-800 border-blue-300' : 'bg-blue-500/20 text-blue-300 border-blue-400/30'
                  }`}>
                    主题: {appearance.theme === 'dark' || appearance.theme === ('fluent-dark' as any) ? '深色' : appearance.theme === 'light' ? '浅色' : '跟随系统'}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full font-semibold border shadow-xs ${
                    isLight ? 'bg-purple-100 text-purple-800 border-purple-300' : 'bg-purple-500/20 text-purple-300 border-purple-400/30'
                  }`}>
                    字体: {appearance.fontFamily === 'yahei' ? '微软雅黑' : appearance.fontFamily === 'segoe' ? 'Segoe UI' : appearance.fontFamily === 'inter' ? 'Inter' : appearance.fontFamily === 'mono' ? 'JetBrains Mono' : '系统默认'}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full font-semibold border shadow-xs ${
                    isLight ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30'
                  }`}>
                    字号: {appearance.fontSize === 'small' ? '13px' : appearance.fontSize === 'medium' ? '14px' : appearance.fontSize === 'large' ? '16px' : '18px'}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full font-semibold border shadow-xs ${
                    isLight ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-amber-500/20 text-amber-300 border-amber-400/30'
                  }`}>
                    磨砂: {(appearance.enableBlur ?? true) ? `${appearance.blurAmount ?? 24}px` : '禁用'}
                  </span>
                </div>
              </div>

              {/* 紧凑模拟舞台 */}
              <div className="relative rounded-lg overflow-hidden h-16 sm:h-20 min-h-0 flex items-center justify-center p-2 border border-slate-300/60 dark:border-white/10">
                {/* 底层：高对比度生动测试极光图谱 */}
                <div
                  aria-hidden
                  className="absolute inset-0 pointer-events-none overflow-hidden select-none"
                  style={{
                    filter: (appearance.enableBlur ?? true) ? `blur(${((appearance.blurAmount ?? 24) * 0.85).toFixed(1)}px)` : 'none',
                  }}
                >
                  <div
                    className="absolute inset-0 opacity-40"
                    style={{
                      backgroundImage: isLight
                        ? 'radial-gradient(#3b82f6 1.5px, transparent 1.5px), radial-gradient(#ec4899 1px, transparent 1px)'
                        : 'radial-gradient(#60a5fa 1.5px, transparent 1.5px), radial-gradient(#f43f5e 1px, transparent 1px)',
                      backgroundSize: '16px 16px',
                    }}
                  />
                  <div
                    className="absolute -top-8 -left-6 w-48 h-32 rounded-3xl opacity-85 transform -rotate-12"
                    style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 50%, #8b5cf6 100%)' }}
                  />
                  <div
                    className="absolute top-0 left-1/3 w-40 h-24 rounded-full opacity-80 transform rotate-45"
                    style={{ background: 'linear-gradient(120deg, #ec4899 0%, #f43f5e 50%, #fb923c 100%)' }}
                  />
                  <div
                    className="absolute -bottom-6 -right-6 w-48 h-32 rounded-3xl opacity-80 transform rotate-12"
                    style={{ background: 'linear-gradient(145deg, #10b981 0%, #06b6d4 50%, #3b82f6 100%)' }}
                  />
                </div>

                {/* 顶层：划词与对译磨砂玻璃悬浮卡片 (紧凑单行/双行横向) */}
                <div
                  className={`relative z-10 w-full max-w-xl overflow-hidden rounded-lg px-3 py-1.5 sm:py-2 border flex items-center justify-between gap-3 shadow-md ${
                    isLight
                      ? 'text-slate-900 border-white/80 shadow-slate-900/10'
                      : 'text-zinc-100 border-white/20 shadow-black/40'
                  }`}
                  style={{
                    backgroundColor: isLight
                      ? (appearance.enableBlur ?? true)
                        ? `rgba(255, 255, 255, ${(0.28 + ((appearance.blurAmount ?? 24) / 40) * 0.36).toFixed(3)})`
                        : 'rgba(255, 255, 255, 0.92)'
                      : (appearance.enableBlur ?? true)
                        ? `rgba(15, 18, 26, ${(0.30 + ((appearance.blurAmount ?? 24) / 40) * 0.36).toFixed(3)})`
                        : 'rgba(15, 18, 26, 0.94)',
                    backdropFilter: (appearance.enableBlur ?? true) ? `blur(${appearance.blurAmount ?? 24}px) saturate(160%)` : 'none',
                    WebkitBackdropFilter: (appearance.enableBlur ?? true) ? `blur(${appearance.blurAmount ?? 24}px) saturate(160%)` : 'none',
                    fontFamily:
                      appearance.fontFamily === 'yahei'
                        ? '"Microsoft YaHei", sans-serif'
                        : appearance.fontFamily === 'segoe'
                        ? '"Segoe UI", sans-serif'
                        : appearance.fontFamily === 'inter'
                        ? '"Inter", sans-serif'
                        : appearance.fontFamily === 'mono'
                        ? '"JetBrains Mono", monospace'
                        : 'system-ui, sans-serif',
                  }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm shrink-0">🐱</span>
                    <div className="min-w-0">
                      <div className={`font-mono text-[11px] opacity-75 truncate leading-tight ${isLight ? 'text-slate-700' : 'text-zinc-300'}`}>
                        Principled BSDF
                      </div>
                      <div className={`font-bold tracking-tight truncate leading-snug ${
                        isLight ? 'text-slate-950' : 'text-white'
                      } ${
                        appearance.fontSize === 'small' ? 'text-xs' : appearance.fontSize === 'medium' ? 'text-sm' : appearance.fontSize === 'large' ? 'text-base' : 'text-base font-extrabold'
                      }`}>
                        原理化 BSDF 材质节点
                      </div>
                    </div>
                  </div>

                  <span className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded-full border shadow-xs shrink-0 whitespace-nowrap hidden sm:inline-flex ${
                    isLight ? 'bg-blue-50/90 text-blue-700 border-blue-200' : 'bg-blue-500/20 text-blue-300 border-blue-400/30'
                  }`}>
                    🧊 Blender CG 专属词库
                  </span>
                </div>
              </div>
            </div>

            {/* 2. Theme Selector (3 Tiles) */}
            <div className="space-y-2">
              <label className={`block text-xs font-bold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>视觉主题模式</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {[
                  { id: 'system', name: '跟随系统', sub: 'System', icon: Monitor, desc: '自动同步 OS 模式' },
                  { id: 'light', name: '明亮浅色', sub: 'Light', icon: Sun, desc: '清爽通透苹果浅色' },
                  { id: 'dark', name: '经典深色', sub: 'Dark', icon: Moon, desc: '高级深邃苹果暗黑' },
                ].map((item) => {
                  const isSelected = (appearance.theme === item.id) || (item.id === 'dark' && appearance.theme === ('fluent-dark' as any));
                  const ItemIcon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setThemeMode(item.id as ThemeMode)}
                      className={`flex flex-col items-start p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                        isSelected
                          ? (isLight
                              ? 'bg-blue-50/90 border-2 border-blue-600 shadow-md shadow-blue-500/10'
                              : 'bg-blue-600/20 border-blue-500 text-white shadow-md ring-1 ring-blue-500/50')
                          : (isLight
                              ? 'bg-white/70 border border-slate-200/90 text-slate-800 hover:bg-white/90 hover:border-slate-300'
                              : 'bg-white/[0.04] border-white/[0.08] text-zinc-300 hover:bg-white/[0.08] hover:border-zinc-700')
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <ItemIcon className={`h-4 w-4 ${isSelected ? (isLight ? 'text-blue-600' : 'text-blue-400') : (isLight ? 'text-slate-500' : 'text-zinc-400')}`} />
                        {isSelected && <CheckCircle2 className={`h-3.5 w-3.5 ${isLight ? 'text-blue-600' : 'text-blue-400'}`} />}
                      </div>
                      <div className={`mt-2 text-xs font-bold ${isLight ? (isSelected ? 'text-blue-950 font-extrabold' : 'text-slate-900') : 'text-white'}`}>{item.name}</div>
                      <div className={`text-[10px] mt-0.5 ${isLight ? (isSelected ? 'text-blue-900/90 font-semibold' : 'text-slate-600 font-medium') : 'text-zinc-400'}`}>{item.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. Frosted Glass Blur Intensity Control */}
            <div className={`space-y-3 pt-3 border-t ${isLight ? 'border-slate-200' : 'border-white/10'}`}>
              {/* 临时诊断徽标：实时显示 store 数值与保存链路状态，用于定位“滑条无反应”断点 */}
              <div className={`flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-[10px] font-mono ${
                isLight ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-amber-500/50 bg-amber-500/10 text-amber-300'
              }`}>
                <span className="font-bold">诊断</span>
                <span>store: blur={String(appearance.enableBlur)} / {appearance.blurAmount ?? 24}px</span>
                <span>主题: {appearance.theme}</span>
                <span className={isSaving ? 'text-blue-500 font-bold animate-pulse' : ''}>
                  保存: {isSaving ? '进行中…' : toastMessage || '待操作'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className={`text-xs font-bold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>开启背景磨砂玻璃材质</div>
                  <div className={`text-[11px] mt-0.5 ${isLight ? 'text-slate-600 font-medium' : 'text-zinc-400'}`}>
                    启用或禁用软件主界面与控制面板的高斯模糊磨砂效果
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={appearance.enableBlur ?? true}
                    onChange={(e) => setEnableBlur(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {(appearance.enableBlur ?? true) && (
                <div className={`space-y-2 p-3.5 rounded-xl border ${
                  isLight ? 'bg-slate-100/90 border-slate-200 text-slate-900' : 'bg-zinc-950/60 border-white/[0.06] text-zinc-300'
                }`}>
                  <div className="flex justify-between text-xs">
                    <span className="font-semibold">磨砂模糊程度调节 (Frosted Glass Blur)</span>
                    <span className="font-mono text-blue-600 font-bold">
                      {appearance.blurAmount ?? 24}px ({appearance.blurAmount === 0 ? '无模糊' : appearance.blurAmount! > 30 ? '重度磨砂' : '标准磨砂'})
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="40"
                    value={appearance.blurAmount ?? 24}
                    onChange={(e) => setBlurAmount(Number(e.target.value))}
                    onInput={(e) => setBlurAmount(Number((e.target as HTMLInputElement).value))}
                    className="w-full h-1.5 bg-zinc-300 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <div className={`flex justify-between text-[10px] pt-0.5 ${isLight ? 'text-slate-600 font-medium' : 'text-zinc-400'}`}>
                    <span>0px (清晰透视)</span>
                    <span>24px (默认磨砂)</span>
                    <span>40px (重度模糊)</span>
                  </div>
                </div>
              )}
            </div>

            {/* 4. Font Family Selector */}
            <div className={`space-y-2 pt-3 border-t ${isLight ? 'border-slate-200' : 'border-white/10'}`}>
              <label className={`block text-xs font-bold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>字体样式 (Font Family)</label>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {[
                  { id: 'system', name: '系统默认', sub: 'System UI', fontStyle: "'Segoe UI Variable Text', system-ui, -apple-system, Segoe UI, Roboto, 'Microsoft YaHei UI', 'PingFang SC', sans-serif" },
                  { id: 'yahei', name: '微软雅黑', sub: 'Microsoft YaHei', fontStyle: "'Microsoft YaHei UI', 'Microsoft YaHei', '微软雅黑', 'PingFang SC', sans-serif" },
                  { id: 'segoe', name: 'Segoe UI', sub: 'Segoe UI', fontStyle: "'Segoe UI Variable Text', 'Segoe UI', -apple-system, sans-serif" },
                  { id: 'inter', name: 'Inter', sub: '现代无衬线', fontStyle: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
                  { id: 'mono', name: '等宽字体', sub: 'JetBrains Mono', fontStyle: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', ui-monospace, Consolas, Monaco, monospace" },
                ].map((f) => {
                  const isSelected = appearance.fontFamily === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFontFamilyOption(f.id as FontFamilyOption)}
                      className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                        isSelected
                          ? (isLight
                              ? 'bg-blue-50/90 border-2 border-blue-600 text-blue-950 shadow-md shadow-blue-500/10'
                              : 'bg-blue-600/20 border-blue-500 text-white ring-1 ring-blue-500/40 shadow-sm')
                          : (isLight
                              ? 'bg-slate-100/90 border border-slate-200 text-slate-800 hover:bg-slate-200/80 hover:border-slate-300'
                              : 'bg-zinc-950/50 border-white/[0.06] text-zinc-300 hover:bg-zinc-900 hover:border-zinc-700')
                      }`}
                    >
                      <div className={`text-xs font-bold truncate ${isLight ? (isSelected ? 'text-blue-950 font-extrabold' : 'text-slate-900') : 'text-white'}`} style={{ fontFamily: f.fontStyle }}>
                        {f.name}
                      </div>
                      <div className={`text-[10px] mt-0.5 truncate ${isLight ? (isSelected ? 'text-blue-900/90 font-semibold' : 'text-slate-600 font-medium') : 'text-zinc-400'}`}>{f.sub}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 5. Font Size Selector */}
            <div className={`space-y-2 pt-3 border-t ${isLight ? 'border-slate-200' : 'border-white/10'}`}>
              <label className={`block text-xs font-bold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>字号大小 (Font Size)</label>
              <div className={`flex items-center space-x-1.5 p-1.5 rounded-xl border ${
                isLight ? 'bg-slate-200/80 border-slate-300/80' : 'bg-zinc-950/80 border-white/[0.08]'
              }`}>
                {[
                  { id: 'small', label: '小 (13px)' },
                  { id: 'medium', label: '标准 (14px)' },
                  { id: 'large', label: '大 (16px)' },
                  { id: 'xlarge', label: '超大 (18px)' },
                ].map((s) => {
                  const isSelected = appearance.fontSize === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setFontSizeOption(s.id as FontSizeOption)}
                      className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm border border-blue-400/40 font-bold'
                          : (isLight ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-300/60' : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]')
                      }`}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 分类 1: 快捷键与触发 */}
      {activeCategory === 'hotkey' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          <div className={`p-5 space-y-5 rounded-2xl border transition-colors ${
            isLight ? 'bg-white/45 backdrop-blur-md border-slate-200/80 shadow-sm text-slate-800' : 'bg-zinc-900/50 border-white/[0.08] text-zinc-100'
          }`}>
            <div>
              <div className={`flex items-center space-x-2 text-sm font-bold ${isLight ? 'text-slate-800' : 'text-white'}`}>
                <Zap className="h-4 w-4 text-blue-500" />
                <span>全局划词快捷键</span>
              </div>
              <p className={`mt-1 text-xs ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                按下快捷键后将控制软件瞬间截取桌面背景并调出高精度划词选区蒙版。
              </p>
            </div>

            {/* 全局快捷键控制中心 - 紧凑型极简列表 */}
            <div className={`rounded-xl border divide-y overflow-hidden shadow-xs ${
              isLight ? 'bg-white/70 border-slate-200 divide-slate-100' : 'bg-zinc-950/60 border-white/[0.08] divide-white/[0.05]'
            }`}>
              {/* 1. 全局划词选区 */}
              <div className="flex items-center justify-between p-2.5 sm:px-3.5 gap-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition">
                <div className="flex items-center space-x-2.5 min-w-0">
                  <span className="text-sm p-1 rounded-lg bg-blue-500/10 border border-blue-500/20 shrink-0 select-none">📸</span>
                  <div className="min-w-0">
                    <div className={`text-xs font-bold ${isLight ? 'text-slate-800' : 'text-zinc-100'}`}>全局划词选区</div>
                    <div className={`text-[10.5px] ${isLight ? 'text-slate-500' : 'text-zinc-400'} truncate`}>桌面全屏鼠标划词与擦除翻译</div>
                  </div>
                </div>

                <div className="flex items-center space-x-1.5 shrink-0">
                  <kbd
                    onClick={() => setRecordingTarget(recordingTarget === 'capture' ? null : 'capture')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold tracking-wider transition-all shadow-xs cursor-pointer border ${
                      recordingTarget === 'capture'
                        ? 'bg-blue-600/30 text-blue-600 border-blue-500 animate-pulse'
                        : (isLight ? 'bg-white text-blue-600 border-blue-300 hover:bg-blue-50' : 'bg-zinc-900 text-blue-400 border-blue-500/40 hover:bg-zinc-800')
                    } ${!(settings.captureHotkeyEnabled ?? true) ? 'opacity-40 line-through' : ''}`}
                    title="点击开始录制按键"
                  >
                    {recordingTarget === 'capture' ? '⌨️ 请按下按键...' : settings.hotkey || 'F4'}
                  </kbd>

                  <button
                    type="button"
                    onClick={() => setRecordingTarget(recordingTarget === 'capture' ? null : 'capture')}
                    className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition cursor-pointer ${
                      recordingTarget === 'capture'
                        ? 'bg-rose-500/20 text-rose-600 border-rose-300'
                        : (isLight ? 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50' : 'bg-zinc-800 text-zinc-200 border-white/10 hover:bg-zinc-700')
                    }`}
                  >
                    {recordingTarget === 'capture' ? '取消' : '重新录制'}
                  </button>

                  {onStartCapture && (
                    <button
                      type="button"
                      onClick={onStartCapture}
                      className="px-2 py-1 rounded-lg bg-blue-600/10 hover:bg-blue-600/20 text-blue-600 dark:text-sky-400 text-[11px] font-semibold border border-blue-500/30 transition cursor-pointer"
                    >
                      🚀 测试
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setCaptureHotkeyEnabled(!(settings.captureHotkeyEnabled ?? true))}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer shrink-0 ml-1 ${
                      (settings.captureHotkeyEnabled ?? true) ? 'bg-blue-600' : (isLight ? 'bg-slate-300' : 'bg-zinc-700')
                    }`}
                    title="开启或关闭该快捷键"
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      (settings.captureHotkeyEnabled ?? true) ? 'translate-x-4.5' : 'translate-x-1'
                    }`} />
                  </button>
                </div>
              </div>

              {/* 2. Spotlight 居中查词 */}
              <div className="flex items-center justify-between p-2.5 sm:px-3.5 gap-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition">
                <div className="flex items-center space-x-2.5 min-w-0">
                  <span className="text-sm p-1 rounded-lg bg-purple-500/10 border border-purple-500/20 shrink-0 select-none">🔍</span>
                  <div className="min-w-0">
                    <div className={`text-xs font-bold ${isLight ? 'text-slate-800' : 'text-zinc-100'}`}>Spotlight 居中查词</div>
                    <div className={`text-[10.5px] ${isLight ? 'text-slate-500' : 'text-zinc-400'} truncate`}>屏幕中央弹框，极速打字查词</div>
                  </div>
                </div>

                <div className="flex items-center space-x-1.5 shrink-0">
                  <kbd
                    onClick={() => setRecordingTarget(recordingTarget === 'spotlight' ? null : 'spotlight')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold tracking-wider transition-all shadow-xs cursor-pointer border ${
                      recordingTarget === 'spotlight'
                        ? 'bg-purple-600/30 text-purple-600 border-purple-500 animate-pulse'
                        : (isLight ? 'bg-white text-purple-600 border-purple-300 hover:bg-purple-50' : 'bg-zinc-900 text-purple-400 border-purple-500/40 hover:bg-zinc-800')
                    } ${!(settings.spotlightHotkeyEnabled ?? true) ? 'opacity-40 line-through' : ''}`}
                    title="点击开始录制按键"
                  >
                    {recordingTarget === 'spotlight' ? '⌨️ 请按下按键...' : settings.spotlightHotkey || 'Alt+Space'}
                  </kbd>

                  <button
                    type="button"
                    onClick={() => setRecordingTarget(recordingTarget === 'spotlight' ? null : 'spotlight')}
                    className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition cursor-pointer ${
                      recordingTarget === 'spotlight'
                        ? 'bg-rose-500/20 text-rose-600 border-rose-300'
                        : (isLight ? 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50' : 'bg-zinc-800 text-zinc-200 border-white/10 hover:bg-zinc-700')
                    }`}
                  >
                    {recordingTarget === 'spotlight' ? '取消' : '重新录制'}
                  </button>

                  {onTriggerSpotlight && (
                    <button
                      type="button"
                      onClick={onTriggerSpotlight}
                      className="px-2 py-1 rounded-lg bg-purple-600/10 hover:bg-purple-600/20 text-purple-600 dark:text-purple-400 text-[11px] font-semibold border border-purple-500/30 transition cursor-pointer"
                    >
                      🚀 测试
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setSpotlightHotkeyEnabled(!(settings.spotlightHotkeyEnabled ?? true))}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer shrink-0 ml-1 ${
                      (settings.spotlightHotkeyEnabled ?? true) ? 'bg-purple-600' : (isLight ? 'bg-slate-300' : 'bg-zinc-700')
                    }`}
                    title="开启或关闭该快捷键"
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      (settings.spotlightHotkeyEnabled ?? true) ? 'translate-x-4.5' : 'translate-x-1'
                    }`} />
                  </button>
                </div>
              </div>

              {/* 3. 剪贴板静默翻译 */}
              <div className="flex items-center justify-between p-2.5 sm:px-3.5 gap-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition">
                <div className="flex items-center space-x-2.5 min-w-0">
                  <span className="text-sm p-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 shrink-0 select-none">📋</span>
                  <div className="min-w-0">
                    <div className={`text-xs font-bold ${isLight ? 'text-slate-800' : 'text-zinc-100'}`}>剪贴板静默翻译</div>
                    <div className={`text-[10.5px] ${isLight ? 'text-slate-500' : 'text-zinc-400'} truncate`}>读取剪贴板文本并右下角弹出</div>
                  </div>
                </div>

                <div className="flex items-center space-x-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setClipboardHotkeyEnabled(!(settings.clipboardHotkeyEnabled ?? true))}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer shrink-0 ml-1 ${
                      (settings.clipboardHotkeyEnabled ?? true) ? 'bg-emerald-600' : (isLight ? 'bg-slate-300' : 'bg-zinc-700')
                    }`}
                    title="开启或关闭该快捷键"
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      (settings.clipboardHotkeyEnabled ?? true) ? 'translate-x-4.5' : 'translate-x-1'
                    }`} />
                  </button>
                </div>
              </div>

              {/* 4. 唤醒 / 隐藏主程序 */}
              <div className="flex items-center justify-between p-2.5 sm:px-3.5 gap-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition">
                <div className="flex items-center space-x-2.5 min-w-0">
                  <span className="text-sm p-1 rounded-lg bg-amber-500/10 border border-amber-500/20 shrink-0 select-none">⚡</span>
                  <div className="min-w-0">
                    <div className={`text-xs font-bold ${isLight ? 'text-slate-800' : 'text-zinc-100'}`}>唤醒 / 隐藏主程序</div>
                    <div className={`text-[10.5px] ${isLight ? 'text-slate-500' : 'text-zinc-400'} truncate`}>托盘后台与前台窗口秒切</div>
                  </div>
                </div>

                <div className="flex items-center space-x-1.5 shrink-0">
                  <kbd
                    onClick={() => setRecordingTarget(recordingTarget === 'toggleWindow' ? null : 'toggleWindow')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold tracking-wider transition-all shadow-xs cursor-pointer border ${
                      recordingTarget === 'toggleWindow'
                        ? 'bg-amber-600/30 text-amber-600 border-amber-500 animate-pulse'
                        : (isLight ? 'bg-white text-amber-600 border-amber-300 hover:bg-amber-50' : 'bg-zinc-900 text-amber-400 border-amber-500/40 hover:bg-zinc-800')
                    } ${!(settings.toggleWindowHotkeyEnabled ?? true) ? 'opacity-40 line-through' : ''}`}
                    title="点击开始录制按键"
                  >
                    {recordingTarget === 'toggleWindow' ? '⌨️ 请按下按键...' : settings.toggleWindowHotkey || 'Alt+Q'}
                  </kbd>

                  <button
                    type="button"
                    onClick={() => setRecordingTarget(recordingTarget === 'toggleWindow' ? null : 'toggleWindow')}
                    className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition cursor-pointer ${
                      recordingTarget === 'toggleWindow'
                        ? 'bg-rose-500/20 text-rose-600 border-rose-300'
                        : (isLight ? 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50' : 'bg-zinc-800 text-zinc-200 border-white/10 hover:bg-zinc-700')
                    }`}
                  >
                    {recordingTarget === 'toggleWindow' ? '取消' : '重新录制'}
                  </button>

                  {onToggleWindow && (
                    <button
                      type="button"
                      onClick={onToggleWindow}
                      className="px-2 py-1 rounded-lg bg-amber-600/10 hover:bg-amber-600/20 text-amber-600 dark:text-amber-400 text-[11px] font-semibold border border-amber-500/30 transition cursor-pointer"
                    >
                      🚀 测试
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setToggleWindowHotkeyEnabled(!(settings.toggleWindowHotkeyEnabled ?? true))}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer shrink-0 ml-1 ${
                      (settings.toggleWindowHotkeyEnabled ?? true) ? 'bg-amber-600' : (isLight ? 'bg-slate-300' : 'bg-zinc-700')
                    }`}
                    title="开启或关闭该快捷键"
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      (settings.toggleWindowHotkeyEnabled ?? true) ? 'translate-x-4.5' : 'translate-x-1'
                    }`} />
                  </button>
                </div>
              </div>
            </div>

            {/* 截图划词首选翻译引擎 / AI大模型选择器 */}
            <div className={`pt-2 border-t space-y-1.5 ${isLight ? 'border-slate-200' : 'border-white/10'}`}>
              <label className={`block text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>
                截图划词首选 AI 模型 / 翻译通道
              </label>
              <select
                value={settings.captureEngine || 'auto'}
                onChange={(e) => setCaptureEngine(e.target.value)}
                className={`w-full rounded-xl border px-3.5 py-2 text-xs focus:border-blue-500 focus:outline-none cursor-pointer font-medium ${
                  isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-zinc-950/80 border-white/15 text-zinc-100'
                }`}
              >
                <optgroup label="── 智能自动降级 ──">
                  <option value="auto">🤖 默认多级智能优先级队列 (词库 ➔ AI ➔ 在线)</option>
                </optgroup>
                <optgroup label="── 强行指定 AI 大语言模型 ──">
                  <option value="deepseek">🧠 DeepSeek (Chat / V3 极速高准确率)</option>
                  <option value="openai">🧠 OpenAI (GPT-4o / GPT-4o-mini)</option>
                  <option value="ollama">🦙 Local Ollama (本地私有化大模型)</option>
                  <option value="custom">⚡ Custom API (自定义 Base URL & Key)</option>
                </optgroup>
                <optgroup label="── 强行指定免 Key 公共通道 ──">
                  <option value="google">🌐 Google 官方翻译 (免 Key 极速)</option>
                  <option value="bing">🔷 Bing 必应神经网络翻译</option>
                </optgroup>
                <optgroup label="── 强行指定 3D 离线词库 ──">
                  <option value="blender">🧊 Blender CG 专属词库优先</option>
                </optgroup>
              </select>
              <p className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                框选截图后将直接调用所选 AI 模型进行识别翻译，也可在划词浮层顶部随时秒切。
              </p>
            </div>

            {/* 截图翻译体验：松手行为 + 区域监控间隔 */}
            <div className={`pt-2 border-t space-y-3 ${isLight ? 'border-slate-200' : 'border-white/10'}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <label className={`block text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>
                    划框松手后的行为
                  </label>
                  <p className={`text-[11px] mt-0.5 ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                    「先调整」松手后选区保留 8 个控制点，可缩放/移动/方向键微调，按 Enter 再识别；「立即识别」保留旧版松手即译。
                  </p>
                </div>
                <div className="flex items-center p-0.5 rounded-xl border shrink-0">
                  {([
                    { value: 'adjust', label: '⏸ 先调整' },
                    { value: 'auto', label: '⚡ 立即识别' },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      data-testid={`release-action-${opt.value}`}
                      onClick={() => setCaptureReleaseAction(opt.value)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        (settings.captureReleaseAction ?? 'auto') === opt.value
                          ? 'bg-sky-500 text-white shadow'
                          : (isLight ? 'text-slate-600 hover:bg-slate-100' : 'text-zinc-300 hover:bg-white/10')
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <label className={`block text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>
                    剪贴板被动监听（复制即翻译）
                  </label>
                  <p className={`text-[11px] mt-0.5 ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                    后台监听剪贴板变化，复制外文文本自动弹出译文 Toast。数字/重复内容自动忽略，划词期间静默。
                  </p>
                </div>
                <button
                  type="button"
                  data-testid="clipboard-watch-toggle"
                  role="switch"
                  aria-checked={settings.clipboardWatchEnabled ?? false}
                  onClick={() => setClipboardWatchEnabled(!(settings.clipboardWatchEnabled ?? false))}
                  className={`relative w-11 h-6 rounded-full transition shrink-0 cursor-pointer ${
                    (settings.clipboardWatchEnabled ?? false) ? 'bg-emerald-600' : (isLight ? 'bg-slate-300' : 'bg-zinc-700')
                  }`}
                  title="开启后：在任意软件中复制外文文本即自动翻译"
                >
                  <span className={`absolute top-1 inline-block h-4 w-4 rounded-full bg-white transition-all cursor-pointer ${
                    (settings.clipboardWatchEnabled ?? false) ? 'left-6' : 'left-1'
                  }`} />
                </button>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <label className={`block text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>
                    区域监控刷新间隔 (W 键)
                  </label>
                  <p className={`text-[11px] mt-0.5 ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                    盯游戏数值 / 直播弹幕时每隔几秒自动重新识别翻译。
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <input
                    type="range"
                    min={1000}
                    max={10000}
                    step={500}
                    value={settings.watchIntervalMs ?? 3000}
                    onChange={(e) => setWatchIntervalMs(Number(e.target.value))}
                    onInput={(e) => setWatchIntervalMs(Number((e.target as HTMLInputElement).value))}
                    className="w-32 accent-sky-500 cursor-pointer"
                    data-testid="watch-interval-slider"
                  />
                  <span className={`text-xs font-mono font-bold w-12 text-right ${isLight ? 'text-slate-700' : 'text-zinc-200'}`} data-testid="watch-interval-label">
                    {((settings.watchIntervalMs ?? 3000) / 1000).toFixed(1)}s
                  </span>
                </div>
              </div>
            </div>

            <div className={`rounded-xl border p-3.5 text-xs space-y-2 ${
              isLight ? 'bg-blue-50/80 border-blue-200 text-blue-900' : 'bg-gradient-to-br from-blue-950/30 to-indigo-950/20 border-blue-500/20 text-zinc-300'
            }`}>
              <div className="flex items-center space-x-2 font-semibold text-blue-600">
                <Sparkles className="h-4 w-4 text-blue-500" />
                <span>快捷键与划词提示：</span>
              </div>
              <ul className={`space-y-1 leading-relaxed ${isLight ? 'text-blue-800' : 'text-zinc-400'}`}>
                <li className="flex items-center space-x-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0"></span>
                  <span>推荐使用如 <kbd className="text-blue-700 bg-blue-100 border border-blue-300 px-1.5 py-0.5 rounded font-mono text-[11px]">F8</kbd> 或 <kbd className="text-blue-700 bg-blue-100 border border-blue-300 px-1.5 py-0.5 rounded font-mono text-[11px]">Ctrl+Shift+D</kbd> 等不与主程序冲突的组合键。</span>
                </li>
                <li className="flex items-center space-x-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0"></span>
                  <span>划词模式开启后，可在全屏选区顶部气泡工具栏直接下拉秒切 AI 模型与通道。</span>
                </li>
              </ul>
            </div>
          </div>

          {/* AI 大语言模型服务配置 (LLM) */}
          <div className={`p-5 space-y-5 rounded-2xl border transition-colors ${
            isLight ? 'bg-white/45 backdrop-blur-md border-slate-200/80 shadow-sm text-slate-800' : 'bg-zinc-900/50 border-white/[0.08] text-zinc-100'
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className={`flex items-center space-x-2 text-sm font-bold ${isLight ? 'text-slate-800' : 'text-white'}`}>
                  <Bot className="h-4 w-4 text-indigo-500" />
                  <span>AI 大语言模型服务配置 (LLM)</span>
                </div>
                <p className={`mt-1 text-xs ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                  支持 DeepSeek / OpenAI / 本地私有化 Ollama / 智谱 GLM / 自定义兼容接口
                </p>
              </div>

              <div className="flex items-center gap-2 flex-nowrap shrink-0 whitespace-nowrap">
                <button
                  type="button"
                  onClick={handleFetchModels}
                  disabled={isFetchingModels || !llm.endpoint}
                  className={`rounded-xl border px-3.5 py-1.5 text-xs font-medium disabled:opacity-40 transition flex items-center gap-1.5 cursor-pointer ${
                    isLight
                      ? 'bg-slate-100 border-slate-300 text-blue-700 hover:bg-slate-200'
                      : 'bg-zinc-800/90 border-white/10 text-blue-300 hover:bg-zinc-700 hover:text-white'
                  }`}
                  title="自动向 endpoint/models 发起 GET 请求拉取所有可用模型"
                >
                  <RotateCcw className={`h-3.5 w-3.5 ${isFetchingModels ? 'animate-spin' : ''}`} />
                  <span>{isFetchingModels ? '拉取模型中...' : '拉取所有可用模型'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleTestLlmConnection}
                  disabled={isTestingLlm}
                  className={`rounded-xl border px-3.5 py-1.5 text-xs font-medium disabled:opacity-40 transition flex items-center gap-1.5 cursor-pointer ${
                    isLight
                      ? 'bg-slate-100 border-slate-300 text-slate-800 hover:bg-slate-200'
                      : 'bg-zinc-800/90 border-white/[0.08] text-zinc-200 hover:bg-zinc-700 hover:text-white'
                  }`}
                >
                  <span>{isTestingLlm ? '测试中...' : '测试连通性'}</span>
                  {testLatency !== null && testSuccess && (
                    <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/20 border border-emerald-400/30 px-1.5 py-0.2 rounded-full">
                      {testLatency}ms
                    </span>
                  )}
                  {testSuccess === false && (
                    <span className="text-[10px] font-mono font-bold text-rose-400 bg-rose-500/20 border border-rose-400/30 px-1.5 py-0.2 rounded-full">
                      失败
                    </span>
                  )}
                </button>
              </div>

              {(testStatus || fetchModelNotice) && (
                <span className={`self-start sm:self-center max-w-[340px] truncate text-[10px] font-mono font-semibold ${
                  testSuccess === false || (fetchModelNotice && fetchModelNotice.includes('失败'))
                    ? 'text-rose-400'
                    : 'text-emerald-400'
                }`}>
                  {fetchModelNotice || testStatus}
                </span>
              )}
            </div>

            {/* 多模型配置池 */}
            <div className={`rounded-2xl border p-4 space-y-3 ${
              isLight ? 'bg-slate-50/80 border-slate-200' : 'bg-zinc-950/60 border-white/[0.08]'
            }`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center space-x-2">
                  <span className={`text-xs font-bold ${isLight ? 'text-slate-800' : 'text-zinc-100'}`}>
                    模型配置池
                  </span>
                  <span className={`text-[10px] font-mono font-semibold px-2 py-0.2 rounded-full border ${
                    isLight ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-blue-500/15 border-blue-400/30 text-blue-300'
                  }`}>
                    {llmPool.length} 个已保存
                  </span>
                  {llm.id && (
                    <span className={`text-[10px] font-mono px-2 py-0.2 rounded-full border ${
                      isLight ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300'
                    }`}>
                      ★ 当前激活
                    </span>
                  )}
                </div>

                <div className="flex items-center space-x-1.5">
                  {showModelPicker && (
                    <div className={`flex items-center space-x-1 p-1 rounded-xl border ${
                      isLight ? 'bg-white border-slate-300 shadow-xs' : 'bg-zinc-900 border-white/15 shadow-xs'
                    }`}>
                      {Object.keys(PROVIDER_DEFAULT_ENDPOINTS).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => handleAddModel(p)}
                          className={`px-2 py-1 rounded-lg text-[10px] font-semibold transition cursor-pointer whitespace-nowrap ${
                            isLight
                              ? 'text-slate-600 hover:bg-blue-50 hover:text-blue-700'
                              : 'text-zinc-300 hover:bg-blue-500/20 hover:text-blue-300'
                          }`}
                        >
                          + {p}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowModelPicker(!showModelPicker)}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-xl border text-xs font-medium transition cursor-pointer ${
                      showModelPicker
                        ? 'bg-blue-600 text-white border-blue-400 shadow-md'
                        : (isLight
                            ? 'bg-white border-slate-300 text-blue-700 hover:bg-blue-50'
                            : 'bg-zinc-800 border-white/15 text-blue-300 hover:bg-zinc-700')
                    }`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    添加模型
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {llmPool.map((m) => {
                  const isActive = llm.id ? m.id === llm.id : m.provider === llm.provider && m.model === llm.model;
                  return (
                    <div
                      key={m.id || `${m.provider}-${m.model}-${m.endpoint}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => m.id && setActiveLlmConfig(m.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && m.id) setActiveLlmConfig(m.id); }}
                      className={`group flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-xl border text-[11px] font-medium transition-all cursor-pointer select-none ${
                        isActive
                          ? (isLight
                              ? 'bg-blue-600 text-white border-blue-400 shadow-md ring-2 ring-blue-500/25'
                              : 'bg-blue-600 text-white border-blue-400/60 shadow-md ring-2 ring-blue-500/30')
                          : (isLight
                              ? 'bg-white text-slate-700 border-slate-200 hover:border-blue-300 hover:bg-blue-50/60'
                              : 'bg-zinc-900/80 text-zinc-300 border-white/10 hover:border-blue-400/40 hover:bg-zinc-800')
                      }`}
                      title="点击切换为激活模型"
                    >
                      <span className={`font-bold ${isActive ? 'text-white' : (isLight ? 'text-slate-500' : 'text-zinc-400')}`}>{m.provider}</span>
                      <span className={`font-mono max-w-[180px] truncate ${isActive ? 'text-white/95' : 'text-blue-600'}`}>{m.model || '(未指定模型)'}</span>
                      {!!m.apiKey && (
                        <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-300' : 'bg-emerald-500'}`} title="已配置 API Key" />
                      )}
                      {llmPool.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); if (m.id) deleteLlmConfig(m.id); }}
                          className={`p-1 rounded-lg transition cursor-pointer opacity-60 hover:opacity-100 ${
                            isActive ? 'hover:bg-white/20 text-white' : (isLight ? 'hover:bg-rose-50 text-rose-500' : 'hover:bg-rose-500/20 text-rose-400')
                          }`}
                          title={isActive ? '删除当前激活模型（自动切换）' : '删除该模型'}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
                {llmPool.length === 0 && (
                  <span className={`text-[11px] py-2 ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>
                    暂无已保存模型，点击右上角「添加模型」创建第一个配置。
                  </span>
                )}
              </div>

              <p className={`text-[10px] leading-relaxed ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>
                支持 DeepSeek / OpenAI / 本地私有化 Ollama / 智谱 GLM / 自定义兼容接口。多模型一键保存切换，下方表单实时编辑当前「激活模型」，测试与拉取模型操作均针对激活模型执行。
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={`mb-1.5 block text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>服务提供商</label>
                <select
                  value={llm.provider}
                  onChange={handleProviderChange}
                  className={`w-full rounded-xl border px-3.5 py-2 text-xs focus:border-blue-500 focus:outline-none cursor-pointer ${
                    isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-zinc-950/80 border-white/[0.09] text-zinc-100'
                  }`}
                >
                  <option value="DeepSeek">DeepSeek (推荐·高性价比)</option>
                  <option value="OpenAI">OpenAI (GPT-4o / GPT-4o-mini)</option>
                  <option value="Ollama">Ollama (本地私有化大模型)</option>
                  <option value="智谱 GLM">智谱 GLM (GLM-4-Flash)</option>
                  <option value="Custom">自定义兼容接口 (Custom Endpoint)</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className={`block text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>
                    模型名称 (Model Identifier)
                  </label>
                  {fetchedModels.length > 0 && (
                    <span className="text-[10px] text-emerald-600 font-mono font-semibold">
                      ✓ 已拉取 {fetchedModels.length} 个模型
                    </span>
                  )}
                </div>

                {fetchedModels.length > 0 ? (
                  <div className="space-y-1.5">
                    <select
                      value={llm.model}
                      onChange={(e) => setLlmConfig({ model: e.target.value })}
                      className={`w-full rounded-xl border px-3.5 py-2 text-xs font-mono focus:border-blue-500 focus:outline-none cursor-pointer ${
                        isLight ? 'bg-white border-blue-300 text-blue-800 font-bold' : 'bg-zinc-950/90 border-blue-500/40 text-blue-300'
                      }`}
                    >
                      {fetchedModels.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={llm.model}
                      onChange={(e) => setLlmConfig({ model: e.target.value })}
                      placeholder="或手动输入 Model ID"
                      className={`w-full rounded-lg border px-3 py-1 text-[11px] focus:border-blue-500 focus:outline-none font-mono ${
                        isLight ? 'bg-slate-50 border-slate-300 text-slate-800' : 'bg-zinc-950/60 border-white/10 text-zinc-300'
                      }`}
                    />
                  </div>
                ) : (
                  <input
                    type="text"
                    value={llm.model}
                    onChange={(e) => setLlmConfig({ model: e.target.value })}
                    placeholder="如 deepseek-chat, gpt-4o-mini"
                    className={`w-full rounded-xl border px-3.5 py-2 text-xs focus:border-blue-500 focus:outline-none font-mono ${
                      isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-zinc-950/80 border-white/[0.09] text-zinc-100'
                    }`}
                  />
                )}
              </div>

              <div className="md:col-span-2">
                <label className={`mb-1.5 block text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>API 接口地址 (Base URL)</label>
                <input
                  type="text"
                  value={llm.endpoint}
                  onChange={(e) => setLlmConfig({ endpoint: e.target.value })}
                  placeholder="https://api.deepseek.com/v1"
                  className={`w-full rounded-xl border px-3.5 py-2 text-xs focus:border-blue-500 focus:outline-none font-mono ${
                    isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-zinc-950/80 border-white/[0.09] text-zinc-100'
                  }`}
                />
              </div>

              <div className="md:col-span-2">
                <label className={`mb-1.5 block text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>API 密钥 (API Key)</label>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={llm.apiKey}
                    onChange={(e) => setLlmConfig({ apiKey: e.target.value })}
                    placeholder="sk-..."
                    className={`w-full rounded-xl border px-3.5 py-2 pr-10 text-xs focus:border-blue-500 focus:outline-none font-mono ${
                      isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-zinc-950/80 border-white/[0.09] text-zinc-100'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className={`absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer ${
                      isLight ? 'text-slate-400 hover:text-slate-700' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* 分类 2: 联网与在线引擎 */}
      {activeCategory === 'online' && (
        <div className="space-y-5 animate-in fade-in duration-150">
          {/* 在线公共翻译服务通道网格矩阵 */}
          <div className={`p-5 space-y-4 rounded-2xl border transition-colors ${
            isLight ? 'bg-white/45 backdrop-blur-md border-slate-200/80 shadow-sm text-slate-800' : 'bg-zinc-900/50 border-white/[0.08] text-zinc-100'
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className={`flex items-center space-x-2 text-sm font-bold ${isLight ? 'text-slate-800' : 'text-white'}`}>
                  <Globe className="h-4 w-4 text-blue-500" />
                  <span>在线公共翻译服务通道 (7 大主流引擎)</span>
                </div>
                <p className={`mt-1 text-xs ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                  支持多引擎免 Key 并发极速查询，开启的引擎将在双栏翻译与多源对照面板中实时呈现
                </p>
              </div>

              {/* 快捷批量操作按钮组 */}
              <div className={`flex items-center space-x-1.5 self-start sm:self-auto p-1 rounded-xl border text-xs ${
                isLight ? 'bg-slate-100 border-slate-200' : 'bg-zinc-950/80 border-white/[0.06]'
              }`}>
                <button
                  type="button"
                  onClick={() => setAllOnlineEngines('recommended')}
                  className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                    isLight ? 'text-slate-700 hover:text-slate-900 hover:bg-slate-200' : 'text-zinc-300 hover:text-white hover:bg-white/[0.06]'
                  }`}
                  title="仅启用 Google + Bing + 有道"
                >
                  推荐配置
                </button>
                <button
                  type="button"
                  onClick={() => setAllOnlineEngines('all')}
                  className="px-2.5 py-1 rounded-lg text-blue-600 hover:text-blue-700 hover:bg-blue-50 transition cursor-pointer font-semibold"
                  title="启用全部 7 大在线引擎"
                >
                  开启全部
                </button>
                <button
                  type="button"
                  onClick={() => setAllOnlineEngines('none')}
                  className="px-2.5 py-1 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                  title="关闭所有在线公共引擎"
                >
                  全部关闭
                </button>
              </div>
            </div>

            {/* 7 大在线引擎精简卡片网格 (高密度 Apple/Fluent 精致胶囊矩阵) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {ONLINE_ENGINE_DEFS.map((eng) => {
                const isEnabled = (online as Record<string, boolean | undefined>)[eng.id] ?? false;
                return (
                  <div
                    key={eng.id}
                    title={eng.desc}
                    className={`flex items-center justify-between rounded-xl px-3 py-2 border transition-all duration-200 cursor-pointer select-none ${
                      isEnabled
                        ? (isLight ? 'bg-blue-50/80 border-blue-300 shadow-2xs ring-1 ring-blue-400/20' : 'bg-blue-950/30 border-blue-500/40 shadow-xs ring-1 ring-blue-500/20')
                        : (isLight ? 'bg-slate-50/80 border-slate-200 opacity-70 hover:opacity-100 hover:bg-slate-100' : 'bg-zinc-950/40 border-white/[0.06] opacity-60 hover:opacity-100 hover:bg-zinc-900/60')
                    }`}
                    onClick={() => setOnlineEngineToggle(eng.id as keyof typeof online, !isEnabled)}
                  >
                    <div className="flex items-center space-x-2 min-w-0 pr-2">
                      <span className="text-sm shrink-0">{eng.icon}</span>
                      <span className={`text-xs font-bold truncate ${isLight ? 'text-slate-800' : 'text-zinc-100'}`}>
                        {eng.name.replace(/（.*?）|\(.*?\)/g, '')}
                      </span>
                      <span className={`text-[9px] font-mono font-medium px-1.5 py-0.2 rounded border shrink-0 ${eng.tagColor}`}>
                        {eng.tag}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOnlineEngineToggle(eng.id as keyof typeof online, !isEnabled);
                      }}
                      className={`relative inline-flex h-4.5 w-9 items-center rounded-full transition-colors cursor-pointer shrink-0 ${
                        isEnabled ? 'bg-blue-600' : (isLight ? 'bg-slate-300' : 'bg-zinc-700')
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                          isEnabled ? 'translate-x-4.5' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 百度翻译 API 凭据配置（仅当百度引擎开启时显示）*/}
          {online.baidu && (
            <div className={`p-4 space-y-3 rounded-2xl border transition-colors ${
              isLight ? 'bg-blue-50/60 border-blue-200/80' : 'bg-blue-950/20 border-blue-500/25'
            }`}>
              <div className={`flex items-center space-x-2 text-xs font-bold ${isLight ? 'text-blue-900' : 'text-blue-300'}`}>
                <span>🐾</span>
                <span>百度翻译 API 配置</span>
                <span className={`text-[9px] font-normal px-1.5 py-0.5 rounded border ml-1 ${isLight ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-blue-500/20 text-blue-400 border-blue-500/30'}`}>
                  免费 · 每月 100 万字符
                </span>
                <a href="https://fanyi-api.baidu.com/" target="_blank" rel="noreferrer"
                  className={`ml-auto text-[10px] underline underline-offset-2 ${isLight ? 'text-blue-600' : 'text-blue-400'}`}>
                  注册免费账号 →
                </a>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className={`block text-[10px] font-medium mb-1 ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>AppID（应用 ID）</label>
                  <input
                    type="text"
                    value={settings.baiduAppId || ''}
                    onChange={(e) => setBaiduConfig(e.target.value, settings.baiduSecret || '')}
                    placeholder="例如：20240001234567"
                    className={`w-full rounded-lg border px-3 py-1.5 text-xs font-mono transition focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                      isLight ? 'bg-white border-slate-300 text-slate-800 placeholder-slate-400' : 'bg-zinc-900/60 border-zinc-700 text-zinc-100 placeholder-zinc-500'
                    }`}
                  />
                </div>
                <div>
                  <label className={`block text-[10px] font-medium mb-1 ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>密钥（Secret Key）</label>
                  <input
                    type="password"
                    value={settings.baiduSecret || ''}
                    onChange={(e) => setBaiduConfig(settings.baiduAppId || '', e.target.value)}
                    placeholder="32 位密钥字符串"
                    className={`w-full rounded-lg border px-3 py-1.5 text-xs font-mono transition focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                      isLight ? 'bg-white border-slate-300 text-slate-800 placeholder-slate-400' : 'bg-zinc-900/60 border-zinc-700 text-zinc-100 placeholder-zinc-500'
                    }`}
                  />
                </div>
              </div>
              <p className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>
                前往 <a href="https://fanyi-api.baidu.com/" target="_blank" rel="noreferrer" className="underline underline-offset-2">fanyi-api.baidu.com</a> 注册开发者账号，创建应用后获取 AppID 与密钥，个人免费套餐每月 100 万字符。
              </p>
            </div>
          )}

          {/* DeepL 官方 API / 自建 DeepLX 配置（仅当 DeepL 引擎开启时显示）*/}
          {online.deepl && (
            <div className={`p-4 space-y-3 rounded-2xl border transition-colors ${
              isLight ? 'bg-teal-50/60 border-teal-200/80' : 'bg-teal-950/20 border-teal-500/25'
            }`}>
              <div className={`flex items-center space-x-2 text-xs font-bold ${isLight ? 'text-teal-900' : 'text-teal-300'}`}>
                <span>⚡</span>
                <span>DeepL 翻译 API 配置</span>
                <span className={`text-[9px] font-normal px-1.5 py-0.5 rounded border ml-1 ${isLight ? 'bg-teal-100 text-teal-700 border-teal-200' : 'bg-teal-500/20 text-teal-400 border-teal-500/30'}`}>
                  免费 · 每月 50 万字符
                </span>
              </div>
              <div>
                <label className={`block text-[10px] font-medium mb-1 ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>
                  官方免费 API Key
                  <a href="https://www.deepl.com/pro-api" target="_blank" rel="noreferrer"
                    className={`ml-2 underline underline-offset-2 ${isLight ? 'text-teal-600' : 'text-teal-400'}`}>
                    注册 →
                  </a>
                </label>
                <input
                  type="password"
                  value={settings.deeplApiKey || ''}
                  onChange={(e) => setDeeplConfig(e.target.value, settings.deeplCustomUrl || '')}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx"
                  className={`w-full rounded-lg border px-3 py-1.5 text-xs font-mono transition focus:outline-none focus:ring-2 focus:ring-teal-500/40 ${
                    isLight ? 'bg-white border-slate-300 text-slate-800 placeholder-slate-400' : 'bg-zinc-900/60 border-zinc-700 text-zinc-100 placeholder-zinc-500'
                  }`}
                />
              </div>
              <div>
                <label className={`block text-[10px] font-medium mb-1 ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>
                  自建 DeepLX 地址（可选，优先于官方 API）
                </label>
                <input
                  type="text"
                  value={settings.deeplCustomUrl || ''}
                  onChange={(e) => setDeeplConfig(settings.deeplApiKey || '', e.target.value)}
                  placeholder="http://localhost:1188/translate"
                  className={`w-full rounded-lg border px-3 py-1.5 text-xs font-mono transition focus:outline-none focus:ring-2 focus:ring-teal-500/40 ${
                    isLight ? 'bg-white border-slate-300 text-slate-800 placeholder-slate-400' : 'bg-zinc-900/60 border-zinc-700 text-zinc-100 placeholder-zinc-500'
                  }`}
                />
              </div>
              <p className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>
                填写官方 API Key 直连 DeepL 免费通道；或填写自建 DeepLX 地址（两者都填时优先使用自建地址）。
              </p>
            </div>
          )}

          {/* AI 大语言模型服务配置 (LLM) */}
          <div className={`p-5 space-y-5 rounded-2xl border transition-colors ${
            isLight ? 'bg-white/45 backdrop-blur-md border-slate-200/80 shadow-sm text-slate-800' : 'bg-zinc-900/50 border-white/[0.08] text-zinc-100'
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className={`flex items-center space-x-2 text-sm font-bold ${isLight ? 'text-slate-800' : 'text-white'}`}>
                  <Bot className="h-4 w-4 text-indigo-500" />
                  <span>AI 大语言模型服务配置 (LLM)</span>
                </div>
                <p className={`mt-1 text-xs ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                  支持 DeepSeek / OpenAI / 本地私有化 Ollama / 智谱 GLM / 自定义兼容接口
                </p>
              </div>

              <div className="flex items-center gap-2 flex-nowrap shrink-0 whitespace-nowrap">
                <button
                  type="button"
                  onClick={handleFetchModels}
                  disabled={isFetchingModels || !llm.endpoint}
                  className={`rounded-xl border px-3.5 py-1.5 text-xs font-medium disabled:opacity-40 transition flex items-center gap-1.5 cursor-pointer ${
                    isLight
                      ? 'bg-slate-100 border-slate-300 text-blue-700 hover:bg-slate-200'
                      : 'bg-zinc-800/90 border-white/10 text-blue-300 hover:bg-zinc-700 hover:text-white'
                  }`}
                  title="自动向 endpoint/models 发起 GET 请求拉取所有可用模型"
                >
                  <RotateCcw className={`h-3.5 w-3.5 ${isFetchingModels ? 'animate-spin' : ''}`} />
                  <span>{isFetchingModels ? '拉取模型中...' : '拉取所有可用模型'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleTestLlmConnection}
                  disabled={isTestingLlm}
                  className={`rounded-xl border px-3.5 py-1.5 text-xs font-medium disabled:opacity-40 transition flex items-center gap-1.5 cursor-pointer ${
                    isLight
                      ? 'bg-slate-100 border-slate-300 text-slate-800 hover:bg-slate-200'
                      : 'bg-zinc-800/90 border-white/[0.08] text-zinc-200 hover:bg-zinc-700 hover:text-white'
                  }`}
                >
                  <span>{isTestingLlm ? '测试中...' : '测试连通性'}</span>
                  {testLatency !== null && testSuccess && (
                    <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/20 border border-emerald-400/30 px-1.5 py-0.2 rounded-full">
                      {testLatency}ms
                    </span>
                  )}
                  {testSuccess === false && (
                    <span className="text-[10px] font-mono font-bold text-rose-400 bg-rose-500/20 border border-rose-400/30 px-1.5 py-0.2 rounded-full">
                      失败
                    </span>
                  )}
                </button>
              </div>

              {(testStatus || fetchModelNotice) && (
                <span className={`self-start sm:self-center max-w-[340px] truncate text-[10px] font-mono font-semibold ${
                  testSuccess === false || (fetchModelNotice && fetchModelNotice.includes('失败'))
                    ? 'text-rose-400'
                    : 'text-emerald-400'
                }`}>
                  {fetchModelNotice || testStatus}
                </span>
              )}
            </div>

            {/* 多模型配置池 */}
            <div className={`rounded-2xl border p-4 space-y-3 ${
              isLight ? 'bg-slate-50/80 border-slate-200' : 'bg-zinc-950/60 border-white/[0.08]'
            }`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center space-x-2">
                  <span className={`text-xs font-bold ${isLight ? 'text-slate-800' : 'text-zinc-100'}`}>
                    模型配置池
                  </span>
                  <span className={`text-[10px] font-mono font-semibold px-2 py-0.2 rounded-full border ${
                    isLight ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-blue-500/15 border-blue-400/30 text-blue-300'
                  }`}>
                    {llmPool.length} 个已保存
                  </span>
                  {llm.id && (
                    <span className={`text-[10px] font-mono px-2 py-0.2 rounded-full border ${
                      isLight ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300'
                    }`}>
                      ★ 当前激活
                    </span>
                  )}
                </div>

                <div className="flex items-center space-x-1.5">
                  {showModelPicker && (
                    <div className={`flex items-center space-x-1 p-1 rounded-xl border ${
                      isLight ? 'bg-white border-slate-300 shadow-xs' : 'bg-zinc-900 border-white/15 shadow-xs'
                    }`}>
                      {Object.keys(PROVIDER_DEFAULT_ENDPOINTS).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => handleAddModel(p)}
                          className={`px-2 py-1 rounded-lg text-[10px] font-semibold transition cursor-pointer whitespace-nowrap ${
                            isLight
                              ? 'text-slate-600 hover:bg-blue-50 hover:text-blue-700'
                              : 'text-zinc-300 hover:bg-blue-500/20 hover:text-blue-300'
                          }`}
                        >
                          + {p}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowModelPicker(!showModelPicker)}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-xl border text-xs font-medium transition cursor-pointer ${
                      showModelPicker
                        ? 'bg-blue-600 text-white border-blue-400 shadow-md'
                        : (isLight
                            ? 'bg-white border-slate-300 text-blue-700 hover:bg-blue-50'
                            : 'bg-zinc-800 border-white/15 text-blue-300 hover:bg-zinc-700')
                    }`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    添加模型
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {llmPool.map((m) => {
                  const isActive = llm.id ? m.id === llm.id : m.provider === llm.provider && m.model === llm.model;
                  return (
                    <div
                      key={m.id || `${m.provider}-${m.model}-${m.endpoint}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => m.id && setActiveLlmConfig(m.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && m.id) setActiveLlmConfig(m.id); }}
                      className={`group flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-xl border text-[11px] font-medium transition-all cursor-pointer select-none ${
                        isActive
                          ? (isLight
                              ? 'bg-blue-600 text-white border-blue-400 shadow-md ring-2 ring-blue-500/25'
                              : 'bg-blue-600 text-white border-blue-400/60 shadow-md ring-2 ring-blue-500/30')
                          : (isLight
                              ? 'bg-white text-slate-700 border-slate-200 hover:border-blue-300 hover:bg-blue-50/60'
                              : 'bg-zinc-900/80 text-zinc-300 border-white/10 hover:border-blue-400/40 hover:bg-zinc-800')
                      }`}
                      title="点击切换为激活模型"
                    >
                      <span className={`font-bold ${isActive ? 'text-white' : (isLight ? 'text-slate-500' : 'text-zinc-400')}`}>{m.provider}</span>
                      <span className={`font-mono max-w-[180px] truncate ${isActive ? 'text-white/95' : 'text-blue-600'}`}>{m.model || '(未指定模型)'}</span>
                      {!!m.apiKey && (
                        <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-300' : 'bg-emerald-500'}`} title="已配置 API Key" />
                      )}
                      {llmPool.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); if (m.id) deleteLlmConfig(m.id); }}
                          className={`p-1 rounded-lg transition cursor-pointer opacity-60 hover:opacity-100 ${
                            isActive ? 'hover:bg-white/20 text-white' : (isLight ? 'hover:bg-rose-50 text-rose-500' : 'hover:bg-rose-500/20 text-rose-400')
                          }`}
                          title={isActive ? '删除当前激活模型（自动切换）' : '删除该模型'}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
                {llmPool.length === 0 && (
                  <span className={`text-[11px] py-2 ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>
                    暂无已保存模型，点击右上角「添加模型」创建第一个配置。
                  </span>
                )}
              </div>

              <p className={`text-[10px] leading-relaxed ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>
                支持 DeepSeek / OpenAI / 本地私有化 Ollama / 智谱 GLM / 自定义兼容接口。多模型一键保存切换，下方表单实时编辑当前「激活模型」，测试与拉取模型操作均针对激活模型执行。
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={`mb-1.5 block text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>服务提供商</label>
                <select
                  value={llm.provider}
                  onChange={handleProviderChange}
                  className={`w-full rounded-xl border px-3.5 py-2 text-xs focus:border-blue-500 focus:outline-none cursor-pointer ${
                    isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-zinc-950/80 border-white/[0.09] text-zinc-100'
                  }`}
                >
                  <option value="DeepSeek">DeepSeek (推荐·高性价比)</option>
                  <option value="OpenAI">OpenAI (GPT-4o / GPT-4o-mini)</option>
                  <option value="Ollama">Ollama (本地私有化大模型)</option>
                  <option value="智谱 GLM">智谱 GLM (GLM-4-Flash)</option>
                  <option value="Custom">自定义兼容接口 (Custom Endpoint)</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className={`block text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>
                    模型名称 (Model Identifier)
                  </label>
                  {fetchedModels.length > 0 && (
                    <span className="text-[10px] text-emerald-600 font-mono font-semibold">
                      ✓ 已拉取 {fetchedModels.length} 个模型
                    </span>
                  )}
                </div>

                {fetchedModels.length > 0 ? (
                  <div className="space-y-1.5">
                    <select
                      value={llm.model}
                      onChange={(e) => setLlmConfig({ model: e.target.value })}
                      className={`w-full rounded-xl border px-3.5 py-2 text-xs font-mono focus:border-blue-500 focus:outline-none cursor-pointer ${
                        isLight ? 'bg-white border-blue-300 text-blue-800 font-bold' : 'bg-zinc-950/90 border-blue-500/40 text-blue-300'
                      }`}
                    >
                      {fetchedModels.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={llm.model}
                      onChange={(e) => setLlmConfig({ model: e.target.value })}
                      placeholder="或手动输入 Model ID"
                      className={`w-full rounded-lg border px-3 py-1 text-[11px] focus:border-blue-500 focus:outline-none font-mono ${
                        isLight ? 'bg-slate-50 border-slate-300 text-slate-800' : 'bg-zinc-950/60 border-white/10 text-zinc-300'
                      }`}
                    />
                  </div>
                ) : (
                  <input
                    type="text"
                    value={llm.model}
                    onChange={(e) => setLlmConfig({ model: e.target.value })}
                    placeholder="如 deepseek-chat, gpt-4o-mini"
                    className={`w-full rounded-xl border px-3.5 py-2 text-xs focus:border-blue-500 focus:outline-none font-mono ${
                      isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-zinc-950/80 border-white/[0.09] text-zinc-100'
                    }`}
                  />
                )}
              </div>

              <div className="md:col-span-2">
                <label className={`mb-1.5 block text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>API 接口地址 (Base URL)</label>
                <input
                  type="text"
                  value={llm.endpoint}
                  onChange={(e) => setLlmConfig({ endpoint: e.target.value })}
                  placeholder="https://api.deepseek.com/v1"
                  className={`w-full rounded-xl border px-3.5 py-2 text-xs focus:border-blue-500 focus:outline-none font-mono ${
                    isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-zinc-950/80 border-white/[0.09] text-zinc-100'
                  }`}
                />
              </div>

              <div className="md:col-span-2">
                <label className={`mb-1.5 block text-xs font-semibold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>API 密钥 (API Key)</label>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={llm.apiKey}
                    onChange={(e) => setLlmConfig({ apiKey: e.target.value })}
                    placeholder="sk-..."
                    className={`w-full rounded-xl border px-3.5 py-2 pr-10 text-xs focus:border-blue-500 focus:outline-none font-mono ${
                      isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-zinc-950/80 border-white/[0.09] text-zinc-100'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className={`absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer ${
                      isLight ? 'text-slate-400 hover:text-slate-700' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 分类 3: 本地专业词库、自定义词条与离线翻译模型 */}
      {activeCategory === 'dicts' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          {/* 本地 OCR 识别模型：真实下载（PP-OCRv3 三件套，进度为真实字节流） */}
          <OcrModelsCard />

          {/* 0. 离线词库引擎 (真实文件系统状态，无模拟下载) */}
          <div className={`p-5 space-y-3.5 rounded-2xl border transition-colors ${
            isLight ? 'bg-white/45 backdrop-blur-md border-slate-200/80 shadow-sm text-slate-800' : 'bg-zinc-900/50 border-white/[0.08] text-zinc-100'
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-2.5 border-slate-200 dark:border-white/10">
              <div>
                <div className={`flex items-center space-x-2 text-sm font-bold ${isLight ? 'text-slate-800' : 'text-white'}`}>
                  <WifiOff className="h-4 w-4 text-amber-500" />
                  <span>离线词库引擎 (内置，断网可用)</span>
                  <span className={`text-[10px] font-mono px-2 py-0.2 rounded-full font-bold border ${
                    offlineEngineStatus?.installed
                      ? (isLight ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30')
                      : (isLight ? 'bg-slate-100 text-slate-600 border-slate-300' : 'bg-white/10 text-zinc-400 border-white/15')
                  }`}>
                    {offlineEngineStatus?.installed
                      ? `🟢 已安装 (v${offlineEngineStatus.version})`
                      : '⚪ 未安装'}
                  </span>
                </div>
                <p className={`mt-0.5 text-xs ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                  通用 UI 短语离线对译引擎，随安装包内置、无需下载。安装后写入应用数据目录，并按「专业词库 → 离线词库 → AI → 在线兜底」的层级参与翻译。
                </p>
              </div>
            </div>

            <div
              className={`flex items-center justify-between rounded-xl p-3.5 border transition-all ${
                offlineEngineStatus?.installed
                  ? (isLight ? 'bg-emerald-50/80 border-emerald-300' : 'bg-zinc-950/70 border-emerald-500/30')
                  : (isLight ? 'bg-white border-slate-200 hover:border-slate-300' : 'bg-zinc-950/40 border-white/[0.06] hover:border-white/15')
              }`}
            >
              <div className="flex items-center space-x-3 min-w-0 flex-1 pr-2">
                <span className="text-base shrink-0">⚡</span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center space-x-1.5 flex-wrap">
                    <span className={`text-xs font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>
                      {offlineEngineStatus?.modelName || '离线词条引擎 v1'}
                    </span>
                    <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded border font-semibold ${
                      isLight ? 'bg-blue-100 text-blue-800 border-blue-200' : 'bg-blue-500/20 text-blue-300 border-blue-400/30'
                    }`}>
                      确定性词库对译
                    </span>
                  </div>
                  <p className={`text-[11px] truncate ${isLight ? 'text-slate-500' : 'text-zinc-400'}`} title={offlineEngineStatus?.path}>
                    {offlineEngineStatus?.installed
                      ? `${offlineEngineStatus.dictEntries} 条通用 UI 词条 · ${(offlineEngineStatus.storageBytes / 1024).toFixed(1)} KB · ${offlineEngineStatus.path}`
                      : '覆盖 Save / 取消 / 正在加载 等高频界面短语，安装后断网环境也能翻译。'}
                  </p>
                </div>
              </div>

              <div className="shrink-0 flex items-center space-x-1.5">
                {offlineEngineStatus?.installed ? (
                  <>
                    <span className="text-[10px] font-bold text-emerald-500 px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/20 flex items-center space-x-0.5">
                      <Check className="h-3 w-3" />
                      <span>参与翻译层级</span>
                    </span>
                    <button
                      type="button"
                      onClick={handleOfflineUninstall}
                      disabled={offlineBusy}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 transition cursor-pointer disabled:opacity-50"
                      title="卸载离线词库（删除应用数据目录中的词库文件）"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handleOfflineInstall}
                    disabled={offlineBusy}
                    className="flex items-center space-x-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-[11px] px-3 py-1.5 rounded-xl shadow-xs transition cursor-pointer active:scale-95"
                  >
                    <HardDriveDownload className="h-3.5 w-3.5" />
                    <span>{offlineBusy ? '安装中...' : '安装 (内置, 即装即用)'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 1. 内置 6 套 CG/3D 软件专属词库 */}
          <div className={`p-5 space-y-4 rounded-2xl border transition-colors ${
            isLight ? 'bg-white/45 backdrop-blur-md border-slate-200/80 shadow-sm text-slate-800' : 'bg-zinc-900/50 border-white/[0.08] text-zinc-100'
          }`}>
            <div className="flex items-center justify-between">
              <div>
                <div className={`flex items-center space-x-2 text-sm font-bold ${isLight ? 'text-slate-800' : 'text-white'}`}>
                  <BookOpen className="h-4 w-4 text-emerald-500" />
                  <span>系统内置专业词库 (6 套核心 CG 引擎已激活)</span>
                </div>
                <p className={`mt-1 text-xs ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                  划词翻译与对译引擎将优先检索命中的专业术语。点击“浏览词条”可检索内置映射表。
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {([
                { id: 'blender', keyt: 'blender', title: 'Blender 材质与节点词库', desc: 'Principled BSDF、Subsurface Scattering、Emission 等 32+ 核心节点', icon: '🧊' },
                { id: 'substance', keyt: 'substance', title: 'Substance Painter 词库', desc: 'Height Range、AO 混合模式、Curvature 等 18+ 贴图绘制术语', icon: '🎨' },
                { id: 'unity', keyt: 'unity', title: 'Unity 引擎词库', desc: 'NavMesh Surface、Rigidbody、Skinned Mesh Renderer 等 16+ 组件属性', icon: '🎮' },
                { id: 'unreal', keyt: 'unreal', title: 'Unreal Engine 5 词库', desc: 'Nanite、Lumen、Virtual Shadow Map 等 24+ 次时代渲染管线术语', icon: '⚡' },
                { id: 'maya', keyt: 'maya', title: 'Autodesk Maya 词库', desc: 'Bifrost、XGen、Arnold 渲染与程序化建模 18+ 术语', icon: '🧩' },
                { id: 'houdini', keyt: 'houdini', title: 'Houdini 程序化词库', desc: 'SOP/DOP 层级、VEX 表达式、FLIP 解算等 17+ 节点术语', icon: '🌀' },
              ] as const).map((dict) => {
                const enabled = settings.presetDicts[dict.keyt];
                const count = Object.keys(PRESET_DICTS_DATA[dict.keyt]?.terms || {}).length;
                return (
                  <div
                    key={dict.id}
                    className={`flex items-center justify-between rounded-xl p-3 border transition-all duration-200 ${
                      enabled
                        ? (isLight ? 'bg-blue-50/70 border-blue-300 shadow-xs' : 'bg-zinc-900/80 border-blue-500/35 shadow-sm')
                        : (isLight ? 'bg-slate-50 border-slate-200 opacity-75' : 'bg-zinc-950/40 border-white/[0.05] opacity-75')
                    }`}
                  >
                    <div className="flex items-center space-x-3 min-w-0">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm shrink-0 ${
                        isLight ? 'bg-slate-200/80' : 'bg-zinc-800/80'
                      }`}>
                        {dict.icon}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center space-x-2">
                          <span className={`text-xs font-bold truncate ${isLight ? 'text-slate-900' : 'text-zinc-100'}`}>{dict.title}</span>
                          <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded border shrink-0 ${
                            isLight ? 'bg-slate-200 text-slate-700 border-slate-300' : 'bg-white/10 text-zinc-300 border-white/20'
                          }`}>
                            {count} 词条
                          </span>
                        </div>
                        <div className={`text-[11px] truncate mt-0.5 ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>{dict.desc}</div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setPresetDictToggle(dict.keyt, !settings.presetDicts[dict.keyt])}
                        className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors cursor-pointer shrink-0 ${
                          settings.presetDicts[dict.keyt] ? 'bg-blue-600' : (isLight ? 'bg-slate-300' : 'bg-zinc-700')
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                            settings.presetDicts[dict.keyt] ? 'translate-x-5' : 'translate-x-1'
                          }`}
                        />
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setPresetViewerDictKey(dict.keyt);
                          setPresetSearchQuery('');
                        }}
                        className={`text-xs font-semibold px-2.5 py-1 rounded-lg border transition cursor-pointer flex items-center space-x-1 ${
                          isLight
                            ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-white/15'
                        }`}
                        title="查看词库内部词条"
                      >
                        <Search className="h-3 w-3 text-blue-500" />
                        <span>浏览</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 2. 用户自定义术语库 (增删改查 & 导入导出中心) */}
          <div className={`p-5 space-y-4 rounded-2xl border transition-colors ${
            isLight ? 'bg-white/45 backdrop-blur-md border-slate-200/80 shadow-sm text-slate-800' : 'bg-zinc-900/50 border-white/[0.08] text-zinc-100'
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3 border-slate-200 dark:border-white/10">
              <div>
                <div className={`flex items-center space-x-2 text-sm font-bold ${isLight ? 'text-slate-800' : 'text-white'}`}>
                  <Sparkles className="h-4 w-4 text-blue-500" />
                  <span>自定义专业词典 (增删改查 & 个人术语库)</span>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border font-bold ${
                    isLight ? 'bg-blue-100 text-blue-800 border-blue-200' : 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                  }`}>
                    {(settings.customDictItems || []).length} 条自定义词条
                  </span>
                </div>
                <p className={`mt-1 text-xs ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                  添加您工作流程中的专属英文缩写、品牌名称或 CG 术语，翻译时将享有第一最高优先级匹配！
                </p>
              </div>

              {/* 工具按钮组 */}
              <div className="flex items-center gap-2 flex-wrap shrink-0">
                <button
                  type="button"
                  onClick={openAddModal}
                  className="flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-3.5 py-1.5 rounded-xl shadow-md transition cursor-pointer active:scale-95"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>添加词条</span>
                </button>

                <label className={`flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                  isLight ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-white/15'
                }`}>
                  <Upload className="h-3.5 w-3.5 text-emerald-500" />
                  <span>导入 CSV</span>
                  <input type="file" accept=".csv" onChange={handleImportCsv} className="hidden" />
                </label>

                {(settings.customDictItems || []).length > 0 && (
                  <button
                    type="button"
                    onClick={handleExportCsv}
                    className={`flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                      isLight ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-white/15'
                    }`}
                    title="导出自定义词典为 CSV"
                  >
                    <Download className="h-3.5 w-3.5 text-sky-500" />
                    <span>导出 CSV</span>
                  </button>
                )}
              </div>
            </div>

            {/* 实时搜索过滤框 */}
            {(settings.customDictItems || []).length > 0 && (
              <div className="relative">
                <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 ${
                  isLight ? 'text-slate-400' : 'text-zinc-500'
                }`} />
                <input
                  type="text"
                  value={customSearchQuery}
                  onChange={(e) => setCustomSearchQuery(e.target.value)}
                  placeholder="搜索自定义词条原词、译文或分类标签..."
                  className={`w-full pl-9 pr-3 py-1.5 rounded-xl text-xs border outline-none transition ${
                    isLight
                      ? 'bg-white border-slate-200 text-slate-800 focus:border-blue-500'
                      : 'bg-zinc-950/80 border-white/10 text-zinc-100 focus:border-blue-400'
                  }`}
                />
              </div>
            )}

            {/* 词条列表容器 */}
            {(() => {
              const items = settings.customDictItems || [];
              const filtered = items.filter(
                (i) =>
                  i.original.toLowerCase().includes(customSearchQuery.toLowerCase()) ||
                  i.translated.toLowerCase().includes(customSearchQuery.toLowerCase()) ||
                  (i.category && i.category.toLowerCase().includes(customSearchQuery.toLowerCase()))
              );

              if (items.length === 0) {
                return (
                  <div className={`p-8 text-center rounded-xl border border-dashed flex flex-col items-center justify-center space-y-3 ${
                    isLight ? 'bg-slate-50 border-slate-300 text-slate-500' : 'bg-zinc-950/40 border-white/10 text-zinc-400'
                  }`}>
                    <FileSpreadsheet className="h-10 w-10 text-blue-500/70" />
                    <div>
                      <p className="text-xs font-bold text-slate-700 dark:text-zinc-200">暂无自定义词条</p>
                      <p className="text-[11px] mt-1 text-slate-500 dark:text-zinc-500">点击右上角“添加词条”或批量导入 CSV，建立您的私人专业字典库。</p>
                    </div>
                    <button
                      type="button"
                      onClick={openAddModal}
                      className="flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-4 py-2 rounded-xl shadow-md transition cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>添加第一条术语</span>
                    </button>
                  </div>
                );
              }

              return (
                <div className="space-y-2 max-h-[380px] overflow-y-auto scrollbar-thin pr-1">
                  {filtered.map((item) => (
                    <div
                      key={item.id}
                      className={`flex items-center justify-between rounded-xl p-3 border transition-all ${
                        isLight
                          ? 'bg-slate-50 hover:bg-slate-100/80 border-slate-200'
                          : 'bg-zinc-950/60 hover:bg-zinc-900 border-white/[0.06]'
                      }`}
                    >
                      <div className="flex items-center space-x-3 min-w-0 flex-1">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border shrink-0 ${
                          isLight
                            ? 'bg-blue-100 text-blue-800 border-blue-200'
                            : 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                        }`}>
                          {item.category || '通用CG'}
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center space-x-2">
                            <span className={`text-xs font-bold font-mono ${isLight ? 'text-slate-900' : 'text-white'}`}>
                              {item.original}
                            </span>
                            <span className={isLight ? 'text-slate-400' : 'text-zinc-500'}>➔</span>
                            <span className={`text-xs font-semibold ${isLight ? 'text-blue-700' : 'text-sky-300'}`}>
                              {item.translated}
                            </span>
                          </div>
                          {item.note && (
                            <p className={`text-[11px] truncate mt-0.5 ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                              备注: {item.note}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* 操作按钮 */}
                      <div className="flex items-center space-x-1 shrink-0 ml-3">
                        <button
                          type="button"
                          onClick={() => openEditModal(item)}
                          className={`p-1.5 rounded-lg transition border cursor-pointer ${
                            isLight
                              ? 'hover:bg-slate-200 text-slate-600 border-slate-300'
                              : 'hover:bg-zinc-800 text-zinc-400 border-white/10'
                          }`}
                          title="修改词条"
                        >
                          <Edit3 className="h-3.5 w-3.5 text-blue-500" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteCustomDictItem(item.id)}
                          className={`p-1.5 rounded-lg transition border cursor-pointer ${
                            isLight
                              ? 'hover:bg-rose-100 text-rose-600 border-rose-200'
                              : 'hover:bg-rose-950/60 text-rose-400 border-rose-500/20'
                          }`}
                          title="删除词条"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* 3. 系统内置词库检索 Pop-up Modal */}
          {presetViewerDictKey && PRESET_DICTS_DATA[presetViewerDictKey] && typeof document !== 'undefined' && createPortal(
            <div
              onClick={(e) => { if (e.target === e.currentTarget) setPresetViewerDictKey(null); }}
              className={`fixed inset-0 z-[500] flex items-center justify-center p-4 transition-colors animate-in fade-in duration-150 ${
                isLight ? 'bg-black/20 backdrop-blur-sm' : 'bg-black/60 backdrop-blur-md'
              }`}
            >
              <div className={`w-full max-w-2xl h-[560px] max-h-[85vh] rounded-2xl border p-5 flex flex-col shadow-2xl animate-in zoom-in-95 duration-150 ${
                isLight ? 'bg-white/95 backdrop-blur-xl text-slate-800 border-slate-200' : 'bg-zinc-900/95 backdrop-blur-xl text-zinc-100 border-white/15'
              }`}>
                {/* Modal Header */}
                <div className="flex items-center justify-between border-b pb-3 border-slate-200 dark:border-white/10 shrink-0">
                  <div>
                    <h3 className="text-sm font-bold flex items-center space-x-2">
                      <BookOpen className="h-4 w-4 text-emerald-500" />
                      <span>{PRESET_DICTS_DATA[presetViewerDictKey].title} - 内置词条清单</span>
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
                      {PRESET_DICTS_DATA[presetViewerDictKey].desc}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPresetViewerDictKey(null)}
                    className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Search in Preset Modal */}
                <div className="py-3 shrink-0">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 dark:text-zinc-500" />
                    <input
                      type="text"
                      value={presetSearchQuery}
                      onChange={(e) => setPresetSearchQuery(e.target.value)}
                      placeholder="快速检索该词典中的英文或中文术语..."
                      className={`w-full pl-9 pr-3 py-1.5 rounded-xl text-xs border outline-none ${
                        isLight ? 'bg-slate-50 border-slate-300 text-slate-800' : 'bg-zinc-950 border-white/15 text-white'
                      }`}
                    />
                  </div>
                </div>

                {/* Terms Table */}
                <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin space-y-1.5 pr-1">
                  {Object.entries(PRESET_DICTS_DATA[presetViewerDictKey].terms)
                    .filter(([orig, trans]) =>
                      orig.toLowerCase().includes(presetSearchQuery.toLowerCase()) ||
                      trans.toLowerCase().includes(presetSearchQuery.toLowerCase())
                    )
                    .map(([orig, trans], idx) => (
                      <div
                        key={idx}
                        className={`flex items-center justify-between p-2.5 rounded-xl border text-xs ${
                          isLight ? 'bg-slate-50 border-slate-200' : 'bg-zinc-950/60 border-white/[0.05]'
                        }`}
                      >
                        <div className="flex items-center space-x-3 font-mono font-medium min-w-0">
                          <span className={`font-bold truncate ${isLight ? 'text-slate-900' : 'text-white'}`}>{orig}</span>
                          <span className="text-slate-400 shrink-0">➔</span>
                          <span className="text-blue-500 font-sans font-semibold truncate">{trans}</span>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(`${orig} ${trans}`);
                            setCopiedTerm(orig);
                            setTimeout(() => setCopiedTerm(null), 1500);
                          }}
                          className={`p-1 rounded-md text-[10px] flex items-center space-x-1 border cursor-pointer shrink-0 ml-2 ${
                            isLight ? 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50' : 'bg-zinc-800 border-white/10 text-zinc-300 hover:bg-zinc-700'
                          }`}
                        >
                          {copiedTerm === orig ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                          <span>{copiedTerm === orig ? '已复制' : '复制'}</span>
                        </button>
                      </div>
                    ))}
                </div>

                {/* Modal Footer */}
                <div className="pt-3 border-t border-slate-200 dark:border-white/10 flex justify-end shrink-0">
                  <button
                    type="button"
                    onClick={() => setPresetViewerDictKey(null)}
                    className="px-4 py-1.5 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 transition cursor-pointer shadow-sm"
                  >
                    关闭
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}

          {/* 4. 新增 / 编辑自定义词条 Modal */}
          {showAddEditModal && typeof document !== 'undefined' && createPortal(
            <div
              onClick={(e) => { if (e.target === e.currentTarget) setShowAddEditModal(false); }}
              className={`fixed inset-0 z-[500] flex items-center justify-center p-4 transition-colors animate-in fade-in duration-150 ${
                isLight ? 'bg-black/20 backdrop-blur-sm' : 'bg-black/60 backdrop-blur-md'
              }`}
            >
              <form
                onSubmit={handleSaveCustomTerm}
                className={`w-full max-w-lg max-h-[90vh] flex flex-col rounded-3xl border p-6 space-y-4 shadow-2xl transition-all animate-in zoom-in-95 duration-200 overflow-y-auto scrollbar-thin ${
                  isLight
                    ? 'bg-white text-slate-900 border-slate-300 shadow-slate-900/25 ring-1 ring-slate-200'
                    : 'bg-[#181824] text-zinc-100 border-white/15 shadow-[0_25px_60px_rgba(0,0,0,0.85)] ring-1 ring-white/10'
                }`}
              >
                <div className={`flex items-center justify-between border-b pb-3.5 shrink-0 ${
                  isLight ? 'border-slate-200' : 'border-white/10'
                }`}>
                  <h3 className="text-sm font-extrabold flex items-center space-x-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-blue-500/15 border border-blue-400/30 text-blue-500">
                      <Plus className="h-4 w-4" />
                    </div>
                    <span className={isLight ? 'text-slate-900' : 'text-white'}>
                      {editingCustomItem ? '编辑自定义术语' : '新增自定义术语'}
                    </span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowAddEditModal(false)}
                    className={`p-1.5 rounded-xl transition cursor-pointer ${
                      isLight ? 'hover:bg-slate-100 text-slate-500' : 'hover:bg-white/10 text-zinc-400 hover:text-white'
                    }`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="space-y-4 text-xs">
                  <div>
                    <div className={`flex items-center space-x-1.5 font-bold mb-1.5 ${isLight ? 'text-slate-800' : 'text-zinc-200'}`}>
                      <Type className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                      <span>英文原词 / 术语 (Original)</span>
                    </div>
                    <input
                      type="text"
                      required
                      value={formOriginal}
                      onChange={(e) => setFormOriginal(e.target.value)}
                      placeholder="例: Anisotropy 或 Specular"
                      className={`w-full px-3.5 py-2.5 rounded-2xl border text-xs font-mono outline-none transition shadow-xs ${
                        isLight
                          ? 'bg-slate-50 border-slate-300 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20'
                          : 'bg-zinc-950/80 border-white/15 text-white placeholder:text-zinc-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20'
                      }`}
                    />
                  </div>

                  <div>
                    <div className={`flex items-center space-x-1.5 font-bold mb-1.5 ${isLight ? 'text-slate-800' : 'text-zinc-200'}`}>
                      <Languages className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      <span>中文精准译法 (Translation)</span>
                    </div>
                    <input
                      type="text"
                      required
                      value={formTranslated}
                      onChange={(e) => setFormTranslated(e.target.value)}
                      placeholder="例: 各向异性 (材质切线拉伸)"
                      className={`w-full px-3.5 py-2.5 rounded-2xl border text-xs outline-none transition shadow-xs ${
                        isLight
                          ? 'bg-slate-50 border-slate-300 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20'
                          : 'bg-zinc-950/80 border-white/15 text-white placeholder:text-zinc-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20'
                      }`}
                    />
                  </div>

                  <div>
                    <div className={`flex items-center space-x-1.5 font-bold mb-1.5 ${isLight ? 'text-slate-800' : 'text-zinc-200'}`}>
                      <Tag className="h-3.5 w-3.5 text-purple-500 shrink-0" />
                      <span>分类 / 适用领域</span>
                    </div>
                    <select
                      value={formCategory}
                      onChange={(e) => setFormCategory(e.target.value)}
                      className={`w-full px-3.5 py-2.5 rounded-2xl border text-xs outline-none cursor-pointer font-medium transition ${
                        isLight
                          ? 'bg-slate-50 border-slate-300 text-slate-900 focus:bg-white focus:border-blue-600'
                          : 'bg-zinc-950/80 border-white/15 text-white focus:border-blue-500'
                      }`}
                    >
                      <option value="Blender">🧊 Blender</option>
                      <option value="Substance">🎨 Substance Painter</option>
                      <option value="Unity">🎮 Unity 引擎</option>
                      <option value="Unreal Engine">⚡ Unreal Engine 5</option>
                      <option value="Maya">🧩 Autodesk Maya</option>
                      <option value="Houdini">🌀 Houdini 程序化</option>
                      <option value="通用CG">💻 通用 CG / 3D 领域</option>
                      <option value="代码技术">⚙️ 代码与技术名词</option>
                      <option value="其他">📌 其他个人专属</option>
                    </select>
                  </div>

                  <div>
                    <div className={`flex items-center space-x-1.5 font-bold mb-1.5 ${isLight ? 'text-slate-800' : 'text-zinc-200'}`}>
                      <FileText className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      <span>备注 / 语境说明 (选填)</span>
                    </div>
                    <input
                      type="text"
                      value={formNote}
                      onChange={(e) => setFormNote(e.target.value)}
                      placeholder="例: 原理化材质节点中的切线高光属性"
                      className={`w-full px-3.5 py-2.5 rounded-2xl border text-xs outline-none transition shadow-xs ${
                        isLight
                          ? 'bg-slate-50 border-slate-300 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20'
                          : 'bg-zinc-950/80 border-white/15 text-white placeholder:text-zinc-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20'
                      }`}
                    />
                  </div>
                </div>

                <div className={`pt-4 border-t flex items-center justify-end space-x-2.5 shrink-0 ${
                  isLight ? 'border-slate-200' : 'border-white/10'
                }`}>
                  <button
                    type="button"
                    onClick={() => setShowAddEditModal(false)}
                    className={`px-4.5 py-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                      isLight
                        ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                        : 'bg-white/10 hover:bg-white/20 text-zinc-200 border-white/15'
                    }`}
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white transition cursor-pointer shadow-lg shadow-blue-500/25 border border-blue-400/30 active:scale-95"
                  >
                    保存词条
                  </button>
                </div>
              </form>
            </div>,
            document.body
          )}
        </div>
      )}

      {/* 分类 4: 匹配优先级与偏好 */}
      {activeCategory === 'preference' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          <div className={`p-5 space-y-5 rounded-2xl border transition-colors ${
            isLight ? 'bg-white/45 backdrop-blur-md border-slate-200/80 shadow-sm text-slate-800' : 'bg-zinc-900/50 border-white/[0.08] text-zinc-100'
          }`}>
            <div>
              <div className={`flex items-center space-x-2 text-sm font-bold ${isLight ? 'text-slate-800' : 'text-white'}`}>
                <Sliders className="h-4 w-4 text-purple-500" />
                <span>翻译引擎匹配优先级</span>
              </div>
              <p className={`mt-1 text-xs ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                翻译时将自上而下匹配，排在第 1 位的引擎优先查询，若未匹配则自动回退至下一层级
              </p>
            </div>

            <div className="space-y-2">
              {settings.translationTiers.map((tier, index) => {
                const tierInfo: Record<string, { label: string; desc: string; icon: string }> = {
                  'Preset Dictionary': { label: '专业与自定义字典', desc: '本地离线 0ms 秒匹配，CG 节点/术语精准无误', icon: '🧊' },
                  'LLM API': { label: 'AI 大语言模型', desc: 'DeepSeek / OpenAI 高级润色与长句意译', icon: '🤖' },
                  'Online Fallback': { label: '在线极速通道 (兜底)', desc: 'Google / Bing 免 Key 兜底，保底 100% 吐出结果', icon: '🌐' },
                };
                const info = tierInfo[tier] || { label: tier, desc: '自定义翻译层级', icon: '⚡' };

                return (
                  <div
                    key={tier}
                    className={`flex items-center justify-between rounded-xl p-3 border transition-all ${
                      isLight ? 'bg-slate-50 border-slate-200 hover:border-slate-300 shadow-xs' : 'bg-zinc-950/70 border-white/[0.07] hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <span className={`flex h-5 w-5 items-center justify-center rounded-md text-[11px] font-mono font-bold ${
                        isLight ? 'bg-slate-200 text-slate-700' : 'bg-zinc-800 text-zinc-400'
                      }`}>
                        {index + 1}
                      </span>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className={`text-xs font-bold ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>
                            {info.icon} {tier} ({info.label})
                          </span>
                          {index === 0 && (
                            <span className={`flex items-center space-x-1 rounded-full border px-2 py-0.2 text-[10px] font-bold ${
                              isLight ? 'bg-blue-100 border-blue-300 text-blue-800' : 'bg-blue-500/15 border-blue-500/30 text-blue-300'
                            }`}>
                              <Sparkles className="h-3 w-3" />
                              <span>最先匹配</span>
                            </span>
                          )}
                        </div>
                        <p className={`text-[11px] mt-0.5 ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                          {info.desc}
                        </p>
                      </div>
                    </div>

                  <div className="flex items-center space-x-1">
                    <button
                      type="button"
                      onClick={() => moveTier(index, index - 1)}
                      disabled={index === 0}
                      className={`rounded-lg p-1.5 disabled:opacity-20 transition cursor-pointer ${
                        isLight ? 'text-slate-500 hover:bg-slate-200 hover:text-slate-800' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                      }`}
                      title="向上移动 (Move Up)"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveTier(index, index + 1)}
                      disabled={index === settings.translationTiers.length - 1}
                      className={`rounded-lg p-1.5 disabled:opacity-20 transition cursor-pointer ${
                        isLight ? 'text-slate-500 hover:bg-slate-200 hover:text-slate-800' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                      }`}
                      title="向下移动 (Move Down)"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
            </div>

            {/* 软件常规偏好信息 */}
            <div className={`pt-4 border-t space-y-3 ${isLight ? 'border-slate-200' : 'border-white/[0.06]'}`}>
              <h3 className={`text-xs font-bold ${isLight ? 'text-slate-800' : 'text-zinc-200'}`}>界面与系统偏好</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className={`rounded-xl border p-3 text-xs ${
                  isLight ? 'bg-slate-50 border-slate-200' : 'bg-zinc-950/50 border-white/[0.05]'
                }`}>
                  <div className={isLight ? 'text-slate-600 font-medium' : 'text-zinc-400 font-medium'}>默认词库 (Default Preset)</div>
                    <select
                      value={settings.defaultPreset || 'blender'}
                      onChange={(e) => setDefaultPreset(e.target.value)}
                      className={`mt-1.5 w-full rounded-lg border px-2.5 py-1.5 text-xs focus:border-blue-500 focus:outline-none cursor-pointer ${
                        isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-zinc-950/80 border-white/[0.08] text-zinc-100'
                      }`}
                    >
                      <option value="blender">Blender</option>
                      <option value="substance">Substance Painter</option>
                      <option value="unity">Unity</option>
                      <option value="unreal">Unreal Engine</option>
                      <option value="maya">Maya</option>
                      <option value="houdini">Houdini</option>
                      <option value="general">通用模式 (General)</option>
                    </select>
                  </div>
                <div className={`rounded-xl border p-3 text-xs ${
                  isLight ? 'bg-slate-50 border-slate-200' : 'bg-zinc-950/50 border-white/[0.05]'
                }`}>
                  <div className={isLight ? 'text-slate-600 font-medium' : 'text-zinc-400 font-medium'}>当前视觉主题</div>
                  <div className={`font-bold mt-0.5 ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>
                    {activeTheme === 'light'
                      ? '明亮浅色 (Light)'
                      : activeTheme === 'dark' || (activeTheme as any) === 'fluent-dark'
                      ? '经典深色 (Dark)'
                      : '跟随系统 (System)'}
                  </div>
                </div>
                <div className={`rounded-xl border p-3 text-xs sm:col-span-2 ${
                  isLight ? 'bg-slate-50 border-slate-200' : 'bg-zinc-950/50 border-white/[0.05]'
                }`}>
                  <div className="flex items-center justify-between">
                    <div className={isLight ? 'text-slate-600 font-medium' : 'text-zinc-400 font-medium'}>OCR 文字识别引擎</div>
                    <span
                      className={`text-[10px] font-mono font-medium px-1.5 py-0.2 rounded-full border ${
                        OCR_STATUS_STYLE[ocrStatus?.status || 'unknown']
                      }`}
                    >
                      {ocrStatus ? ocrStatus.status : '...'}
                    </span>
                  </div>
                  <div className={`font-bold mt-0.5 ${isLight ? 'text-slate-900' : 'text-zinc-200'}`}>
                    {ocrStatus ? ocrStatus.detail : '正在查询引擎状态...'}
                  </div>
                </div>

                {/* OCR 识别引擎选择器 */}
                <div className={`rounded-xl border p-3 text-xs sm:col-span-2 ${
                  isLight ? 'bg-slate-50 border-slate-200' : 'bg-zinc-950/50 border-white/[0.05]'
                }`}>
                  <div className={`font-medium mb-2 ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>
                    OCR 识别引擎
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                    {([
                      {
                        value: 'auto',
                        label: '自动选择',
                        desc: `智能探测：PP-OCR${(settings.ocrVersion || 'v4').toUpperCase()} 优先，自动降级`,
                      },
                      {
                        value: 'onnx',
                        label: `PP-OCR${(settings.ocrVersion || 'v4').toUpperCase()} (推荐)`,
                        desc: 'Rust 原生离线推理，中英排版最佳，无网络依赖',
                      },
                      {
                        value: 'winrt',
                        label: '系统 WinRT OCR',
                        desc: 'Windows 10/11 原生超高速识别 (<15ms 零延迟)',
                      },
                    ] as { value: 'auto' | 'onnx' | 'winrt'; label: string; desc: string }[]).map(({ value, label, desc }) => {
                      const isSelected = (settings.ocrEngine ?? 'auto') === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setOcrEngine(value)}
                          title={desc}
                          className={`text-left rounded-lg border px-2.5 py-2 transition-all cursor-pointer
                            ${isSelected
                              ? (isLight ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-blue-500/60 bg-blue-500/10 text-blue-300')
                              : (isLight ? 'border-slate-200 hover:border-slate-400 text-slate-700' : 'border-white/[0.06] hover:border-white/20 text-zinc-300')
                            }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                              isSelected ? 'bg-blue-500' : (isLight ? 'bg-slate-300' : 'bg-zinc-600')
                            }`} />
                            <span className="font-semibold">{label}</span>
                          </div>
                          <div className={`mt-0.5 text-[10px] leading-tight ${
                            isLight ? 'text-slate-500' : 'text-zinc-500'
                          }`}>{desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 首选翻译引擎选择器 */}
                <div className={`rounded-xl border p-3 text-xs sm:col-span-2 ${
                  isLight ? 'bg-slate-50 border-slate-200' : 'bg-zinc-950/50 border-white/[0.05]'
                }`}>
                  <div className={`font-medium mb-2 ${isLight ? 'text-slate-600' : 'text-zinc-400'}`}>
                    首选翻译引擎
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {([
                      { value: 'auto', label: '自动', desc: '按优先级依次尝试（推荐）' },
                      { value: 'dict', label: '仅词典', desc: '查 CG 专业词典，最快·完全离线' },
                      { value: 'llm', label: '优先 LLM', desc: '跳过词典，直接走 LLM 翻译' },
                      { value: 'online', label: '在线回退', desc: 'Google / MyMemory 等在线引擎' },
                    ] as { value: string; label: string; desc: string }[]).map(({ value, label, desc }) => {
                      const isSelected = (settings.primaryTranslationEngine ?? 'auto') === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setPrimaryTranslationEngine(value as 'auto' | 'dict' | 'llm' | 'online')}
                          title={desc}
                          className={`text-left rounded-lg border px-2.5 py-2 transition-all cursor-pointer
                            ${isSelected
                              ? (isLight ? 'border-violet-400 bg-violet-50 text-violet-700' : 'border-violet-500/60 bg-violet-500/10 text-violet-300')
                              : (isLight ? 'border-slate-200 hover:border-slate-400 text-slate-700' : 'border-white/[0.06] hover:border-white/20 text-zinc-300')
                            }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                              isSelected ? 'bg-violet-500' : (isLight ? 'bg-slate-300' : 'bg-zinc-600')
                            }`} />
                            <span className="font-semibold">{label}</span>
                          </div>
                          <div className={`mt-0.5 text-[10px] leading-tight ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>{desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 关闭窗口行为选择器 */}
                <div className={`rounded-xl border p-3 text-xs sm:col-span-2 ${
                  isLight ? 'bg-slate-50 border-slate-200' : 'bg-zinc-950/50 border-white/[0.05]'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className={`font-medium ${isLight ? 'text-slate-700' : 'text-zinc-300'}`}>
                      关闭主窗口行为 (必选项)
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      isLight ? 'bg-blue-100 text-blue-700' : 'bg-blue-500/20 text-blue-300'
                    }`}>
                      系统控制
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {([
                      {
                        value: 'ask',
                        label: '每次询问',
                        desc: '点击关闭时弹出对话框确认（推荐）',
                      },
                      {
                        value: 'minimize',
                        label: '最小化到托盘',
                        desc: '常驻后台，热键随时秒级呼出',
                      },
                      {
                        value: 'exit',
                        label: '直接退出程序',
                        desc: '关闭窗口时直接彻底结束软件',
                      },
                    ] as { value: 'ask' | 'minimize' | 'exit'; label: string; desc: string }[]).map(({ value, label, desc }) => {
                      const isSelected = (settings.closeAction ?? 'ask') === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setCloseAction(value)}
                          title={desc}
                          className={`text-left rounded-lg border p-2.5 transition-all cursor-pointer ${
                            isSelected
                              ? (isLight ? 'border-blue-500 bg-blue-50/80 text-blue-700 ring-1 ring-blue-500/20 shadow-2xs' : 'border-blue-500 bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30')
                              : (isLight ? 'border-slate-200 hover:border-slate-300 bg-white text-slate-700' : 'border-white/[0.06] hover:border-white/15 bg-zinc-900/50 text-zinc-300')
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 flex items-center justify-center border ${
                              isSelected
                                ? (isLight ? 'border-blue-600 bg-blue-600' : 'border-blue-400 bg-blue-400')
                                : (isLight ? 'border-slate-300 bg-white' : 'border-zinc-600 bg-transparent')
                            }`}>
                              {isSelected && <span className="w-1 h-1 rounded-full bg-white" />}
                            </span>
                            <span className="font-semibold text-xs">{label}</span>
                          </div>
                          <div className={`mt-1 text-[10.5px] leading-tight ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                            {desc}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Spotlight 查词小窗口行为 */}
                <div className={`rounded-xl border p-3 text-xs sm:col-span-2 ${
                  isLight ? 'bg-slate-50 border-slate-200' : 'bg-zinc-950/50 border-white/[0.05]'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className={`font-medium ${isLight ? 'text-slate-700' : 'text-zinc-300'}`}>
                      Win 快速查词小窗口 (Spotlight) 行为
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      isLight ? 'bg-purple-100 text-purple-700' : 'bg-purple-500/20 text-purple-300'
                    }`}>
                      快捷悬浮窗
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {([
                      {
                        value: 'hide',
                        label: '按 Esc / 失去焦点自动关闭',
                        desc: '查完即走，丝滑不遮挡 3D/CG 创作工作区',
                      },
                      {
                        value: 'minimize',
                        label: '仅按 Esc 手动关闭',
                        desc: '点击其他窗口时不自动关闭，便于对照参考',
                      },
                    ] as { value: 'hide' | 'minimize'; label: string; desc: string }[]).map(({ value, label, desc }) => {
                      const isSelected = (settings.miniWindowCloseAction ?? 'hide') === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setMiniWindowCloseAction(value)}
                          title={desc}
                          className={`text-left rounded-lg border p-2.5 transition-all cursor-pointer ${
                            isSelected
                              ? (isLight ? 'border-purple-500 bg-purple-50/80 text-purple-700 ring-1 ring-purple-500/20 shadow-2xs' : 'border-purple-500 bg-purple-500/15 text-purple-300 ring-1 ring-purple-500/30')
                              : (isLight ? 'border-slate-200 hover:border-slate-300 bg-white text-slate-700' : 'border-white/[0.06] hover:border-white/15 bg-zinc-900/50 text-zinc-300')
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 flex items-center justify-center border ${
                              isSelected
                                ? (isLight ? 'border-purple-600 bg-purple-600' : 'border-purple-400 bg-purple-400')
                                : (isLight ? 'border-slate-300 bg-white' : 'border-zinc-600 bg-transparent')
                            }`}>
                              {isSelected && <span className="w-1 h-1 rounded-full bg-white" />}
                            </span>
                            <span className="font-semibold text-xs">{label}</span>
                          </div>
                          <div className={`mt-1 text-[10.5px] leading-tight ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                            {desc}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 软件信息 / 关于卡片入口 */}
                <div className="pt-2">
                  <div className={`p-4 rounded-xl border flex flex-wrap items-center justify-between gap-3 ${
                    isLight ? 'bg-gradient-to-r from-blue-50/80 to-indigo-50/80 border-blue-200' : 'bg-gradient-to-r from-blue-950/20 to-indigo-950/20 border-blue-500/20'
                  }`}>
                    <div className="flex items-center space-x-3 min-w-0">
                      <div className="h-10 w-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-lg shrink-0">
                        🐾
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold flex items-center space-x-1.5 flex-wrap">
                          <span>猫步翻译 (Maobu Translator)</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-bold">v1.0.0</span>
                        </div>
                        <p className={`text-[11px] mt-0.5 truncate ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
                          基于 React 19 + Rust Tauri v2 · 专为 3D/CG 与多语种打造的下一代翻译利器
                        </p>
                      </div>
                    </div>

                    {onOpenAbout && (
                      <button
                        type="button"
                        onClick={onOpenAbout}
                        className="lg-btn lg-btn-primary !px-3 !py-1.5 !text-xs font-semibold shrink-0 cursor-pointer"
                      >
                        <span>查看软件信息与架构 ➔</span>
                      </button>
                    )}
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
      )}

      {/* 快捷键正在录制全屏强提示 Overlay Modal */}
      {recordingTarget && typeof document !== 'undefined' && createPortal(
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setRecordingTarget(null); }}
          className="fixed inset-0 z-[600] flex items-center justify-center bg-black/65 backdrop-blur-md animate-in fade-in duration-150"
        >
          <div className="bg-slate-900 border-2 border-blue-500/80 rounded-2xl p-6 shadow-2xl max-w-md w-full text-center space-y-4 animate-in zoom-in-95 duration-150">
            <div className="h-12 w-12 rounded-full bg-blue-500/20 border border-blue-400 flex items-center justify-center mx-auto text-2xl animate-bounce">
              ⌨️
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-white">
                正在录制【
                {recordingTarget === 'capture'
                  ? '全局划词选区'
                  : recordingTarget === 'spotlight'
                  ? 'Spotlight 居中查词'
                  : recordingTarget === 'clipboard'
                  ? '剪贴板静默翻译'
                  : '唤醒 / 隐藏主程序'}
                】快捷键
              </h3>
              <p className="text-xs text-blue-300 leading-relaxed">
                请直接在键盘上按下您想设定的按键或组合键（如 <kbd className="bg-blue-900 px-1.5 py-0.5 rounded text-white font-mono font-bold">F1</kbd>、<kbd className="bg-blue-900 px-1.5 py-0.5 rounded text-white font-mono font-bold">Alt+Space</kbd> 或 <kbd className="bg-blue-900 px-1.5 py-0.5 rounded text-white font-mono font-bold">1</kbd>）
              </p>
            </div>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setRecordingTarget(null)}
                className="px-5 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-bold border border-rose-500/40 transition cursor-pointer"
              >
                取消录制 (Esc)
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
