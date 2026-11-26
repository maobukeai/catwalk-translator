import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, Search, X } from "lucide-react";

export interface GlassSelectOption {
  value: string;
  label: string;
  sub?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export interface GlassSelectGroup {
  key?: string;
  label: string;
  options: GlassSelectOption[];
}

export interface GlassSelectProps {
  value: string;
  options?: GlassSelectOption[];
  groups?: GlassSelectGroup[];
  onChange: (value: string) => void;
  placeholder?: string;
  direction?: "up" | "down";
  align?: "left" | "right";
  size?: "xs" | "sm" | "md";
  variant?: "rounded" | "pill";
  fullWidth?: boolean;
  menuMinWidth?: number;
  menuMaxWidth?: number;
  searchable?: boolean;
  title?: string;
  ariaLabel?: string;
  selectTestId?: string;
  triggerTestId?: string;
  icon?: React.ReactNode;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  disabled?: boolean;
}

interface PopoverCoords {
  left: number;
  top?: number;
  bottom?: number;
  minWidth: number;
  maxWidth: number;
  placement: "up" | "down";
}

export const GlassSelect: React.FC<GlassSelectProps> = ({
  value,
  options = [],
  groups = [],
  onChange,
  placeholder = "请选择...",
  direction = "down",
  align = "left",
  size = "md",
  variant = "rounded",
  fullWidth = false,
  menuMinWidth = 200,
  menuMaxWidth = 320,
  searchable = false,
  title,
  ariaLabel,
  selectTestId,
  triggerTestId,
  icon,
  className = "",
  triggerClassName = "",
  menuClassName = "",
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [popoverCoords, setPopoverCoords] = useState<PopoverCoords | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const allOptions = useMemo(
    () => [...options, ...groups.flatMap((g) => g.options)],
    [options, groups]
  );

  const selectedOption = allOptions.find((opt) => opt.value === value);

  const updatePosition = useCallback(() => {
    const triggerEl = triggerRef.current;
    if (!triggerEl) return;

    const rect = triggerEl.getBoundingClientRect();
    const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
    const vh = typeof window !== "undefined" ? window.innerHeight : 768;

    const minW = Math.max(rect.width || 0, menuMinWidth);
    const maxW = Math.max(minW, menuMaxWidth);

    const spaceBelow = vh - rect.bottom - 10;
    const spaceAbove = rect.top - 10;

    let placement: "up" | "down" = direction;
    if (direction === "down" && spaceBelow < 220 && spaceAbove > spaceBelow) {
      placement = "up";
    } else if (direction === "up" && spaceAbove < 220 && spaceBelow > spaceAbove) {
      placement = "down";
    }

    const effectiveMenuW = Math.min(minW, maxW);
    let left = align === "right" ? rect.right - effectiveMenuW : rect.left;
    const maxLeft = Math.max(8, vw - effectiveMenuW - 8);
    left = Math.min(Math.max(8, left), maxLeft);

    if (placement === "up") {
      setPopoverCoords({
        left,
        bottom: Math.max(8, vh - rect.top + 6),
        minWidth: minW,
        maxWidth: maxW,
        placement: "up",
      });
    } else {
      setPopoverCoords({
        left,
        top: Math.max(8, rect.bottom + 6),
        minWidth: minW,
        maxWidth: maxW,
        placement: "down",
      });
    }
  }, [align, direction, menuMaxWidth, menuMinWidth]);

  // Close on outside click & Escape, and keep Portal coordinates synced
  useEffect(() => {
    if (!isOpen) return;

    updatePosition();

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        (!popoverRef.current || !popoverRef.current.contains(target))
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
      }
    };

    const handleReposition = () => updatePosition();

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [isOpen, updatePosition]);

  // Auto focus search input
  useEffect(() => {
    if (isOpen && searchable) {
      setSearchQuery("");
      setTimeout(() => searchInputRef.current?.focus(), 40);
    }
  }, [isOpen, searchable]);

  const query = searchQuery.trim().toLowerCase();
  const matchesQuery = useCallback(
    (opt: GlassSelectOption) =>
      !query ||
      opt.label.toLowerCase().includes(query) ||
      (opt.sub && opt.sub.toLowerCase().includes(query)) ||
      opt.value.toLowerCase().includes(query),
    [query]
  );

  const filteredStandalone = useMemo(
    () => (searchable && query ? options.filter(matchesQuery) : options),
    [options, searchable, query, matchesQuery]
  );

  const filteredGroups = useMemo(
    () =>
      groups
        .map((g) => ({
          ...g,
          options: searchable && query ? g.options.filter(matchesQuery) : g.options,
        }))
        .filter((g) => g.options.length > 0),
    [groups, searchable, query, matchesQuery]
  );

  const hasAnyFilteredResults =
    filteredStandalone.length > 0 || filteredGroups.length > 0;

  const sizeClass =
    size === "xs"
      ? "h-6 px-2 text-[11px] font-semibold"
      : size === "sm"
      ? "h-7 px-2.5 text-xs font-semibold"
      : "h-[34px] px-3 text-xs font-semibold";

  const radiusClass = variant === "pill" ? "rounded-full" : "rounded-xl";
  const effectivePlacement = popoverCoords?.placement ?? direction;

  const renderOptionButton = (opt: GlassSelectOption) => {
    const isSelected = opt.value === value;
    return (
      <button
        key={opt.value}
        type="button"
        disabled={opt.disabled}
        onClick={() => {
          if (opt.disabled) return;
          onChange(opt.value);
          setIsOpen(false);
        }}
        className={`vision-select-option ${isSelected ? "is-selected" : ""} ${
          opt.disabled ? "opacity-45 cursor-not-allowed" : ""
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0 pr-2">
          {opt.icon && <span className="shrink-0">{opt.icon}</span>}
          <div className="flex flex-col min-w-0">
            <span className="truncate">{opt.label}</span>
            {opt.sub && (
              <span
                className="text-[10px] truncate opacity-75"
                style={{ color: isSelected ? "var(--accent-text)" : "var(--g-text-3)" }}
              >
                {opt.sub}
              </span>
            )}
          </div>
        </div>
        {isSelected && (
          <Check
            className="h-3.5 w-3.5 shrink-0 ml-1"
            style={{ color: "var(--accent-text)" }}
          />
        )}
      </button>
    );
  };

  const popoverMenu = isOpen ? (
    <div
      ref={popoverRef}
      data-testid="vision-select-popover"
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        zIndex: 9990,
        left: popoverCoords ? `${popoverCoords.left}px` : "8px",
        top: popoverCoords?.top !== undefined ? `${popoverCoords.top}px` : undefined,
        bottom:
          popoverCoords?.bottom !== undefined ? `${popoverCoords.bottom}px` : undefined,
        minWidth: `${popoverCoords?.minWidth ?? menuMinWidth}px`,
        maxWidth: `${popoverCoords?.maxWidth ?? menuMaxWidth}px`,
      }}
      className={`vision-select-popover ${
        effectivePlacement === "up" ? "vision-select-popover-up" : ""
      } font-sans ${menuClassName}`}
    >
      {/* Optional Search */}
      {searchable && (
        <div className="px-0.5 mb-1.5">
          <div className="vision-select-search relative flex items-center">
            <Search
              className="h-3 w-3 absolute left-2.5 pointer-events-none"
              style={{ color: "var(--g-text-3)" }}
            />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索选项..."
              className="w-full bg-transparent pl-7 pr-7 py-1 text-xs outline-none"
              style={{ color: "var(--g-text-1)" }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 opacity-60 hover:opacity-100 cursor-pointer"
                style={{ color: "var(--g-text-2)" }}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* List Options + Groups */}
      <div className="max-h-64 overflow-y-auto space-y-0.5 pr-0.5">
        {!hasAnyFilteredResults ? (
          <div
            className="py-3 text-center text-xs"
            style={{ color: "var(--g-text-3)" }}
          >
            无匹配选项
          </div>
        ) : (
          <>
            {filteredStandalone.map(renderOptionButton)}
            {filteredStandalone.length > 0 && filteredGroups.length > 0 && (
              <div className="vision-select-divider" />
            )}
            {filteredGroups.map((group, gIdx) => (
              <div key={group.key || group.label} className={gIdx > 0 ? "pt-1" : ""}>
                {gIdx > 0 && <div className="vision-select-divider" />}
                <div className="vision-select-group-label">{group.label}</div>
                <div className="space-y-0.5">
                  {group.options.map(renderOptionButton)}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div
      ref={containerRef}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className={`relative ${fullWidth ? "block w-full" : "inline-block"} font-sans ${className}`}
    >
      {/* Hidden Accessible / Form-compatible Select for Tests & Accessibility */}
      <select
        tabIndex={-1}
        title={title}
        aria-label={ariaLabel}
        data-testid={selectTestId}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only pointer-events-none absolute inset-0 opacity-0"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
        {groups.map((g) => (
          <optgroup key={g.key || g.label} label={g.label}>
            {g.options.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        data-testid={triggerTestId}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setIsOpen((prev) => !prev);
        }}
        className={`vision-select-trigger ${fullWidth ? "w-full" : ""} flex items-center justify-between gap-1.5 ${radiusClass} cursor-pointer select-none ${sizeClass} ${
          isOpen ? "is-open" : ""
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""} ${triggerClassName}`}
      >
        <div className="flex items-center gap-1.5 truncate min-w-0">
          {icon && <span className="shrink-0">{icon}</span>}
          {selectedOption?.icon && (
            <span className="shrink-0">{selectedOption.icon}</span>
          )}
          <span className="truncate">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </div>
        <ChevronDown
          className={`shrink-0 transition-transform duration-200 ${
            size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5"
          } ${
            isOpen
              ? effectivePlacement === "up"
                ? ""
                : "rotate-180"
              : effectivePlacement === "up"
              ? "rotate-180"
              : ""
          }`}
          style={{
            color: isOpen ? "var(--accent-text)" : "var(--g-text-3)",
          }}
        />
      </button>

      {/* Portal Popover Menu */}
      {popoverMenu &&
        (typeof document !== "undefined"
          ? createPortal(popoverMenu, document.body)
          : popoverMenu)}
    </div>
  );
};
