import React from "react";
import {
  Languages,
  Search,
  BookMarked,
  Settings,
  Camera,
  Bot,
} from "lucide-react";
import { useSettingsStore } from "../../stores/useSettingsStore";

export type AppTab = "translate" | "search" | "vocabulary" | "settings" | "ai";

interface SidebarProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  onTriggerCapture: () => void;
  hotkey?: string;
}

interface NavSection {
  title: string;
  items: {
    id: AppTab;
    label: string;
    icon: React.ElementType;
  }[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: "工作台",
    items: [
      { id: "translate", label: "翻译器", icon: Languages },
      { id: "search", label: "划词查词", icon: Search },
      { id: "ai", label: "AI 对话", icon: Bot },
    ],
  },
  {
    title: "工具与配置",
    items: [
      { id: "vocabulary", label: "生词本", icon: BookMarked },
      { id: "settings", label: "系统设置", icon: Settings },
    ],
  },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  onTriggerCapture,
  hotkey = "Ctrl+Alt+D",
}) => {
  const { settings } = useSettingsStore();
  const activeTheme = settings.appearance?.theme || 'fluent-dark';
  const isSystemLight = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches;
  const isLight = activeTheme === 'light' || (activeTheme === 'system' && isSystemLight);

  return (
    <aside className={`flex flex-col w-44 shrink-0 border-r select-none transition-colors duration-200 ${
      isLight
        ? 'border-slate-200 bg-slate-100/90 text-slate-800'
        : 'border-white/10 bg-white/[0.04] backdrop-blur-md text-zinc-100'
    }`}>
      {/* 导航菜单区 */}
      <nav className="flex-1 px-2 py-3 space-y-3.5 overflow-y-auto scrollbar-none">
        {NAV_SECTIONS.map((section, idx) => (
          <div key={idx} className="space-y-1">
            {/* 分组小标题 */}
            <div className="px-2 pb-1">
              <span className={`text-[10px] font-mono font-semibold tracking-wider uppercase ${
                isLight ? 'text-slate-400' : 'text-zinc-500'
              }`}>
                {section.title}
              </span>
            </div>

            {/* 导航项列表 */}
            {section.items.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onTabChange(item.id)}
                  className={`group relative w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs transition-all duration-150 cursor-pointer ${
                    isActive
                      ? (isLight
                          ? "bg-blue-600/15 border border-blue-500/40 text-blue-700 font-bold shadow-xs"
                          : "bg-blue-600/15 border border-blue-400/30 text-white font-bold shadow-xs")
                      : (isLight
                          ? "border border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-200/70"
                          : "border border-transparent text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06]")
                  }`}
                >
                  {/* 选中时的左侧微型亮点发光条 */}
                  {isActive && (
                    <span className="absolute -left-1 top-1/2 -translate-y-1/2 w-1 h-4 bg-gradient-to-b from-sky-400 to-blue-500 rounded-r-full shadow-[0_0_8px_rgba(56,189,248,0.8)]" />
                  )}

                  {/* 图标精致微型衬底座 */}
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-all duration-150 ${
                      isActive
                        ? "bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600 text-white border-blue-400/50 shadow-md shadow-blue-500/25"
                        : (isLight
                            ? "bg-slate-200/80 text-slate-500 border-slate-300/60 group-hover:bg-slate-300/70 group-hover:text-slate-800"
                            : "bg-white/[0.04] text-zinc-400 border-white/[0.07] group-hover:bg-white/[0.08] group-hover:text-zinc-200 group-hover:border-white/15")
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 transition-transform group-hover:scale-110" />
                  </span>

                  <span className="truncate tracking-tight">{item.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* 底部：划词翻译 CTA 按钮 + 运行指示器 */}
      <div className={`p-2.5 space-y-2 border-t ${isLight ? 'border-slate-200 bg-slate-200/50' : 'border-white/[0.06] bg-black/10'}`}>
        <button
          type="button"
          onClick={onTriggerCapture}
          className="group w-full flex items-center justify-between rounded-xl bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 px-3 py-2 text-white shadow-md shadow-blue-600/25 border border-blue-400/30 transition-all duration-150 active:scale-[0.98] cursor-pointer"
          title="开启截图划词翻译选区"
        >
          <div className="flex items-center gap-2">
            <Camera className="h-3.5 w-3.5 text-blue-100 group-hover:rotate-6 transition-transform" />
            <span className="text-xs font-bold tracking-tight">划词翻译</span>
          </div>
          {hotkey && (
            <kbd className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-black/25 text-blue-100 border border-white/20 shadow-xs">
              {hotkey}
            </kbd>
          )}
        </button>

        {/* RapidOCR 运行指示 */}
        <div className={`px-2.5 py-1.5 rounded-xl border flex items-center justify-between text-[11px] transition-colors ${
          isLight
            ? "bg-slate-200/80 border-slate-300/80 text-slate-700"
            : "bg-white/[0.03] border-white/[0.07] text-zinc-300"
        }`}>
          <div className="flex items-center space-x-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className={`text-[10px] font-medium tracking-tight ${isLight ? "text-slate-700" : "text-zinc-300"}`}>
              RapidOCR 本地模型
            </span>
          </div>
          <span className="text-[9px] font-mono font-bold text-emerald-600">
            就绪
          </span>
        </div>
      </div>
    </aside>
  );
};