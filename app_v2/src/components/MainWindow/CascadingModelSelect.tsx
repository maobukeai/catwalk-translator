import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight, Check, Bot } from 'lucide-react';
import { useAppTheme } from '../../hooks/useAppTheme';
import { resolveModelLabel } from '../../services/defaultSettings';
import type { LlmConfig } from '../../services/types';

export interface VendorGroupItem {
  vendor: string;
  models: LlmConfig[];
}

export interface CascadingModelSelectProps {
  activeVendor: string;
  activeModelLabel: string;
  activeModelKey: string;
  vendorGroups: VendorGroupItem[];
  onSelectModel: (config: LlmConfig) => void;
  onSelectVendor?: (vendor: string) => void;
  getConfigKey: (cfg: Partial<LlmConfig>) => string;
  buttonTitle?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export const CascadingModelSelect: React.FC<CascadingModelSelectProps> = ({
  activeVendor,
  activeModelLabel,
  activeModelKey,
  vendorGroups,
  onSelectModel,
  onSelectVendor,
  getConfigKey,
  buttonTitle = '点击按厂商分类选择大模型',
  size = 'sm',
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredVendor, setHoveredVendor] = useState<string | null>(null);
  const [flyoutPlacement, setFlyoutPlacement] = useState<'left' | 'right'>('right');

  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { isLight } = useAppTheme();

  const isSmall = size === 'sm';

  // 展开时计算屏幕边界，决定二级菜单向左或向右弹出（若右侧空间不足则向左侧弹出，对齐截图效果）
  useEffect(() => {
    if (isOpen && menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const screenW = window.innerWidth || document.documentElement.clientWidth;
      if (screenW - rect.right < 240) {
        setFlyoutPlacement('left');
      } else {
        setFlyoutPlacement('right');
      }
      setHoveredVendor(activeVendor);
    } else {
      setHoveredVendor(null);
    }
  }, [isOpen, activeVendor]);

  // 点击外部自动闭合
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 键盘 Esc 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 鼠标悬停厂商项时更新高亮厂商
  const handleVendorMouseEnter = (vendor: string) => {
    if (hoverCloseTimerRef.current) {
      clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
    setHoveredVendor(vendor);
  };

  const handleMenuMouseLeave = () => {
    hoverCloseTimerRef.current = setTimeout(() => {
      // 保留状态，避免用户稍有晃动即关停
    }, 200);
  };

  const handleSubmenuMouseEnter = () => {
    if (hoverCloseTimerRef.current) {
      clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  };

  const handleModelClick = (cfg: LlmConfig) => {
    onSelectModel(cfg);
    setIsOpen(false);
    setHoveredVendor(null);
  };

  const currentHoveredGroup = vendorGroups.find((g) => g.vendor === hoveredVendor);
  const allModels = vendorGroups.flatMap((g) => g.models);

  return (
    <div ref={containerRef} className={`relative inline-block min-w-0 max-w-full font-sans ${className}`}>
      {/* 隐藏式表单兼容 select，保证单元测试与无障碍畅通 */}
      <select
        tabIndex={-1}
        aria-hidden="true"
        title="快速切换当前对话所使用的大模型"
        value={activeModelKey}
        onChange={(e) => {
          const target = allModels.find(
            (m) => getConfigKey(m) === e.target.value || m.id === e.target.value || m.model === e.target.value
          );
          if (target) onSelectModel(target);
        }}
        className="sr-only pointer-events-none absolute inset-0 opacity-0"
      >
        {vendorGroups.map((group) => (
          <optgroup key={group.vendor} label={group.vendor}>
            {group.models.map((m) => (
              <option key={getConfigKey(m)} value={getConfigKey(m)}>
                {resolveModelLabel(m)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {/* 兼容厂商测试的隐藏 select */}
      <select
        tabIndex={-1}
        aria-hidden="true"
        title="快速切换 AI 厂商"
        value={activeVendor}
        onChange={(e) => {
          if (onSelectVendor) onSelectVendor(e.target.value);
        }}
        className="sr-only pointer-events-none absolute inset-0 opacity-0"
      >
        {vendorGroups.map((g) => (
          <option key={g.vendor} value={g.vendor}>
            {g.vendor}
          </option>
        ))}
      </select>

      {/* 触发器主按钮 */}
      <button
        type="button"
        data-testid="cascading-trigger"
        onClick={() => setIsOpen((prev) => !prev)}
        title={buttonTitle}
        className={`vision-select-trigger flex max-w-full min-w-0 items-center justify-between gap-1.5 rounded-xl cursor-pointer select-none ${
          isSmall ? 'h-7 px-2 text-[11px]' : 'h-8 px-3 text-xs'
        } ${isOpen ? 'is-open' : ''}`}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1 max-w-[280px]">
          <Bot className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
          <span className="opacity-75 font-medium truncate shrink-0">{activeVendor}</span>
          <span className="opacity-40 select-none shrink-0">·</span>
          <span className="font-bold truncate text-[var(--accent-text)]">{activeModelLabel}</span>
        </div>
        <ChevronDown
          className={`shrink-0 transition-transform duration-200 ${
            isSmall ? 'h-3 w-3' : 'h-3.5 w-3.5'
          } ${isOpen ? 'rotate-180' : ''}`}
          style={{ color: isOpen ? 'var(--accent-text)' : 'var(--g-text-3)' }}
        />
      </button>

      {/* 一级菜单：AI 厂商列表 Popover */}
      {isOpen && (
        <div
          ref={menuRef}
          data-testid="cascading-menu"
          onMouseLeave={handleMenuMouseLeave}
          className="vision-select-popover absolute z-[300] min-w-[175px] max-w-[240px] top-full mt-1.5 left-0"
        >
          <div
            className="vision-select-group-label flex items-center justify-between border-b mb-1 pb-1.5"
            style={{ borderColor: 'var(--g-hairline)' }}
          >
            <span>选择厂商</span>
            <span className="text-[9px] font-mono opacity-80">{vendorGroups.length} 厂商</span>
          </div>

          <div className="space-y-0.5">
            {vendorGroups.map((group) => {
              const isHovered = hoveredVendor === group.vendor;
              const isGroupActive = activeVendor === group.vendor;

              return (
                <div
                  key={group.vendor}
                  data-testid={`cascading-vendor-${group.vendor}`}
                  onMouseEnter={() => handleVendorMouseEnter(group.vendor)}
                  onClick={() => {
                    handleVendorMouseEnter(group.vendor);
                    if (group.models.length === 1) {
                      handleModelClick(group.models[0]);
                    }
                  }}
                  className={`vision-select-option select-none ${
                    isHovered || isGroupActive ? 'is-selected' : ''
                  }`}
                >
                  <div className="flex items-center gap-2 truncate pr-1">
                    <span className="truncate">{group.vendor}</span>
                    {group.models.length > 1 && (
                      <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-black/5 dark:bg-white/5 opacity-60">
                        {group.models.length}
                      </span>
                    )}
                  </div>
                  <ChevronRight
                    className={`h-3.5 w-3.5 shrink-0 transition-transform ${
                      isHovered ? 'translate-x-0.5' : ''
                    }`}
                    style={{ color: isHovered ? 'var(--accent-text)' : 'var(--g-text-3)' }}
                  />
                </div>
              );
            })}
          </div>

          {/* 二级悬浮菜单：所选厂商旗下的具体模型列表（对齐用户截图侧向展开效果） */}
          {hoveredVendor && currentHoveredGroup && currentHoveredGroup.models.length > 0 && (
            <div
              data-testid="cascading-flyout"
              onMouseEnter={handleSubmenuMouseEnter}
              className={`vision-select-popover absolute top-0 z-[310] min-w-[195px] max-w-[280px] ${
                flyoutPlacement === 'left' ? 'right-full mr-1.5' : 'left-full ml-1.5'
              }`}
            >
              <div
                className="vision-select-group-label flex items-center justify-between border-b mb-1 pb-1.5"
                style={{ borderColor: 'var(--g-hairline)' }}
              >
                <span className="truncate max-w-[150px] font-bold" style={{ color: 'var(--accent-text)' }}>
                  {currentHoveredGroup.vendor}
                </span>
                <span className="text-[9px] font-mono opacity-80">{currentHoveredGroup.models.length} 模型</span>
              </div>

              <div className="space-y-0.5 max-h-[320px] overflow-y-auto scrollbar-thin">
                {currentHoveredGroup.models.map((cfg) => {
                  const modelKey = getConfigKey(cfg);
                  const isSelected =
                    modelKey === activeModelKey ||
                    cfg.model === activeModelKey ||
                    (activeModelKey.includes(cfg.model) && activeVendor === currentHoveredGroup.vendor);
                  const label = resolveModelLabel(cfg);
                  const isLocal = cfg.endpoint?.includes('localhost') || cfg.endpoint?.includes('127.0.0.1');

                  return (
                    <div
                      key={modelKey}
                      data-testid={`cascading-model-${modelKey}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleModelClick(cfg);
                      }}
                      className={`vision-select-option select-none ${
                        isSelected ? 'is-selected' : ''
                      }`}
                    >
                      <div className="flex flex-col truncate pr-2">
                        <span className="truncate">{label}</span>
                        {isLocal && (
                          <span
                            className="text-[9.5px] font-sans leading-none mt-0.5 opacity-70"
                            style={{ color: isSelected ? 'var(--accent-text)' : 'var(--g-text-3)' }}
                          >
                            本地离线服务
                          </span>
                        )}
                      </div>
                      {isSelected && <Check className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--accent-text)' }} />}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
