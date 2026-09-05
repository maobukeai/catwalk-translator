import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle, ArrowDown, ArrowUp, Eye, EyeOff, RotateCcw, Save, CheckCircle2,
  Camera, Zap, Bot, BookOpen, Sliders, Sparkles, ShieldCheck, Globe, Palette,
  Sun, Moon, Monitor, Plus, Trash2, Edit3, Search, Download, Upload, X,
  FileSpreadsheet, Copy, Check, Type, Languages, Tag, FileText, WifiOff,
  HardDriveDownload, CloudUpload,
} from 'lucide-react';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { GeneralDictCard } from './GeneralDictCard';
import {
  cmdGetOcrEngineStatus, cmdFetchLlmModels, cmdOfflineStatus, cmdOfflineInstall,
  cmdOfflineUninstall, cmdGetAutoStart, cmdSetAutoStart,
} from '../../../services/tauri';
import { normalizeHotkeyForCompare } from '../../../services/hotkeys';
import type { OfflineEngineStatus } from '../../../services/tauri';
import type {
  LlmConfig, OcrEngineStatus, ThemeMode, FontFamilyOption, FontSizeOption, CustomDictItem,
} from '../../../services/types';

const isTestEnv = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
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
import { OcrModelsCard } from '../OcrModelsCard';

/** 专业词库：六个预置 DCC 词库浏览、自定义词条 CRUD(CSV 导入导出)、离线词条引擎、OCR 模型。
 * 自定义词条同时作为「术语强制表」参与全部翻译:精确命中直接出结果,未命中时注入 LLM 强制约束。 */
export const DictsPanel: React.FC = () => {
  const { isLight } = useAppTheme();
  const {
    settings,
    setPresetDictToggle,
    addCustomDictItem,
    updateCustomDictItem,
    deleteCustomDictItem,
    importCustomDictItems,
    setOfflineModelInstalled,
    setOfflineModelEnabled,
    installOfflineModel,
    uninstallOfflineModel,
    setActiveOfflineModel,
    setAutoDetectPreset,
} = useSettingsStore();

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

  return (
    <>
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
                  词条同时作为<span className="font-semibold">术语强制表</span>：精确命中直接出结果，未命中的句子也会把相关术语注入 AI 翻译，保证术语始终按您的译法输出。
                </p>
                <div className={`mt-2 p-2 rounded-xl border flex items-center justify-between text-[11px] font-medium ${
                  isLight ? 'bg-blue-50/80 border-blue-200/80 text-blue-800' : 'bg-blue-950/30 border-blue-800/40 text-blue-300'
                }`}>
                  <span>💡 提示：如需拖拽导入 Excel (.xlsx)、TSV、TXT 文本或配置 Anki 联动，请直接点击顶部导航栏中的<strong>「专属术语库」</strong>选项卡。</span>
                </div>
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

        {/* 自动识别前台 3D/CG 软件 → 切换对应专业词库 */}
        <div className={`rounded-2xl border p-4 flex items-center justify-between gap-3 ${
          isLight ? 'bg-white/70 border-slate-200' : 'bg-zinc-900/40 border-white/[0.07]'
        }`} data-testid="auto-detect-preset-card">
          <div className="min-w-0">
            <div className={`text-sm font-bold ${isLight ? 'text-slate-800' : 'text-white'}`}>智能词库 · 自动识别 3D 软件</div>
            <p className={`mt-1 text-[11px] leading-relaxed ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>
              按下截图快捷键的瞬间识别前台软件（Blender / Maya / Houdini / Substance / Unity / Unreal），
              本次划词自动切换为对应专业词库，无需手动选择。
            </p>
          </div>
          <label className="relative inline-flex shrink-0 cursor-pointer items-center">
            <input
              type="checkbox"
              checked={settings.autoDetectPreset !== false}
              onChange={(e) => setAutoDetectPreset(e.target.checked)}
              className="sr-only peer"
              data-testid="auto-detect-preset-toggle"
            />
            <div className="w-9 h-5 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>

        {/* 通用离线英汉词典（ECDICT） */}
        <GeneralDictCard />
    </>
  );
};
