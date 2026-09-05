import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Star, Download, Search, BookMarked, Clock, Volume2, Trash2, Trash, Inbox, Play, X, Copy, Check, Camera, FileText, GraduationCap, Eye, RotateCcw, Library, ClipboardList, CheckSquare, AlertCircle } from "lucide-react";
import { cmdGetHistory, cmdToggleFavorite, cmdExportAnki, cmdDeleteHistoryEntry, cmdDeleteHistoryEntries, cmdBatchSetFavorite, cmdClearHistory, cmdClearUnfavoritedHistory, cmdGetCaptureSessions, cmdClearCaptureSessions, cmdGetClipboardHistory, cmdClearClipboardHistory, type ClipboardHistoryEntry } from "../../services/tauri";
import { speakText } from "../../services/tts";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useAppTheme } from "../../hooks/useAppTheme";
import { detectSpeechLang } from "../../services/langDetect";
import type { HistoryItem, CaptureSession } from "../../services/types";
import { AnkiSyncModal } from "./AnkiSyncModal";

/* ── 复习模式：Leitner 盒子间隔重复（localStorage 轻量持久化） ──────────────── */

interface ReviewProgress {
  box: number; // 0~5，盒子越高间隔越长
  lastReviewedAt: number;
}

/** 各盒子的复习间隔（天）；盒 0 立即到期 */
const REVIEW_INTERVAL_DAYS = [0, 1, 2, 4, 7, 15];
const REVIEW_KEY = "maobu_review_progress_v1";
const MAX_REVIEW_QUEUE = 30;

function loadReviewProgress(): Record<string, ReviewProgress> {
  try {
    const raw = localStorage.getItem(REVIEW_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function persistReviewProgress(progress: Record<string, ReviewProgress>) {
  try {
    localStorage.setItem(REVIEW_KEY, JSON.stringify(progress));
  } catch {
    /* 存储不可用时静默降级为会话内记忆 */
  }
}

function isReviewDue(progress: Record<string, ReviewProgress>, id: string): boolean {
  const p = progress[id];
  if (!p) return true;
  const intervalDays = REVIEW_INTERVAL_DAYS[Math.min(p.box, REVIEW_INTERVAL_DAYS.length - 1)];
  if (intervalDays === 0) return true;
  return Date.now() >= p.lastReviewedAt + intervalDays * 86_400_000;
}

/** Humanised next-due label for the vocab list badges. */
function nextDueText(progress: Record<string, ReviewProgress>, id: string): string {
  if (!progress[id]) return "新词";
  if (isReviewDue(progress, id)) return "待复习";
  const intervalDays = REVIEW_INTERVAL_DAYS[Math.min(progress[id].box, REVIEW_INTERVAL_DAYS.length - 1)];
  const nextAt = progress[id].lastReviewedAt + intervalDays * 86_400_000;
  const days = Math.max(1, Math.ceil((nextAt - Date.now()) / 86_400_000));
  return days <= 1 ? "明天到期" : `${days} 天后`;
}

export const HistoryPanel: React.FC = () => {
  const { settings } = useSettingsStore();
  const { isLight } = useAppTheme();

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(30);
  const [visibleClipCount, setVisibleClipCount] = useState(20);
  const [visibleSessionCount, setVisibleSessionCount] = useState(10);
  // ── 生词本与查询历史彻底解耦（我的生词本 / 查询历史 / 剪贴板 / 划词回放）───────────
  const [activeSubTab, setActiveSubTab] = useState<'vocabulary' | 'history' | 'clipboard' | 'replay'>('vocabulary');
  const [showAnkiModal, setShowAnkiModal] = useState(false);

  // ── 批量操作状态 ──────────────────────────────────────────────────────────
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);

  // ── 跨平台安全确认弹窗状态（消除 window.confirm 在 WebView2 下被阻断的问题） ──
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    body: string;
    confirmText?: string;
    danger?: boolean;
    onConfirm: () => Promise<void> | void;
  } | null>(null);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [activeSubTab]);

  useEffect(() => {
    setVisibleCount(30);
  }, [searchQuery, activeSubTab]);

  // ── 划词回放：整场截图翻译会话 ────────────────────────────────────────────
  const [sessions, setSessions] = useState<CaptureSession[]>([]);

  // ── 剪贴板翻译历史：被动监听翻译成功的条目（上限 200 条） ─────────────────
  const [clipHistory, setClipHistory] = useState<ClipboardHistoryEntry[]>([]);
  useEffect(() => {
    cmdGetClipboardHistory().then((list) => setClipHistory(list ?? [])).catch(() => undefined);
  }, []);
  const [replay, setReplay] = useState<CaptureSession | null>(null);
  const [replayCopied, setReplayCopied] = useState(false);

  // ── 复习模式状态 ──────────────────────────────────────────────────────────
  const [reviewProgress, setReviewProgress] = useState<Record<string, ReviewProgress>>({});
  const [reviewQueue, setReviewQueue] = useState<HistoryItem[]>([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewRevealed, setReviewRevealed] = useState(false);
  const [reviewStats, setReviewStats] = useState({ known: 0, fuzzy: 0, forgot: 0 });
  const [reviewFinished, setReviewFinished] = useState(false);

  useEffect(() => {
    setReviewProgress(loadReviewProgress());
  }, []);

  const loadSessions = async () => {
    try {
      setSessions(await cmdGetCaptureSessions());
    } catch (err) {
      console.error("Failed to load capture sessions:", err);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const handleExportReplay = (session: CaptureSession) => {
    const lines = session.blocks.map(
      (b) => `${b.original}\n${b.translated}  [${b.sourceTier}]`
    );
    const content = `猫步翻译 · 划词回放 ${session.timestamp} (引擎: ${session.engine} → ${session.targetLang})\n${"=".repeat(48)}\n\n${lines.join("\n\n")}\n`;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `capture_replay_${session.id}.txt`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCopyReplay = (session: CaptureSession) => {
    const text = session.blocks.map((b) => b.translated).join("\n");
    navigator.clipboard.writeText(text);
    setReplayCopied(true);
    setTimeout(() => setReplayCopied(false), 1800);
  };

  const handleClearSessions = () => {
    if (sessions.length === 0) return;
    setConfirmModal({
      title: "清空划词回放记录",
      body: `确定要清空全部 ${sessions.length} 场划词回放记录吗？`,
      confirmText: "清空回放",
      danger: true,
      onConfirm: async () => {
        try {
          await cmdClearCaptureSessions();
          setSessions([]);
          setReplay(null);
        } catch (err) {
          console.error("Failed to clear capture sessions:", err);
        }
      },
    });
  };

  const loadHistory = async () => {
    try {
      const items = await cmdGetHistory();
      setHistory(items);
    } catch (err) {
      console.error("Failed to load history:", err);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleToggleFav = async (id: string) => {
    try {
      await cmdToggleFavorite(id);
      setHistory((prev) =>
        prev.map((item) => (item.id === id ? { ...item, isFavorite: !item.isFavorite } : item))
      );
    } catch (err) {
      console.error("Failed to toggle favorite:", err);
    }
  };

  const handleSpeech = (text: string) => {
    speakText(text, { lang: detectSpeechLang(text) });
  };

  const handleDelete = async (id: string) => {
    try {
      await cmdDeleteHistoryEntry(id);
      setHistory((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      console.error("Failed to delete history entry:", err);
    }
  };

  const handleClearUnfavorited = () => {
    const unfavoritedCount = history.filter((i) => !i.isFavorite).length;
    if (unfavoritedCount === 0) return;
    setConfirmModal({
      title: "清空未收藏历史记录",
      body: `确定要清空 ${unfavoritedCount} 条未收藏的临时查询历史吗？\n\n您的生词本（${favoriteCount} 条已收藏生词 ⭐）将受到永久完整保护。`,
      confirmText: `清空 ${unfavoritedCount} 条历史`,
      danger: true,
      onConfirm: async () => {
        try {
          await cmdClearUnfavoritedHistory();
          setHistory((prev) => prev.filter((item) => item.isFavorite));
        } catch (err) {
          console.error("Failed to clear unfavorited history:", err);
        }
      },
    });
  };

  const handleClearAll = () => {
    if (history.length === 0) return;
    setConfirmModal({
      title: "清空全部历史与生词本",
      body: `确定要清空全部 ${history.length} 条记录（包括生词本中收藏的 ${favoriteCount} 个生词）吗？\n\n此操作不可撤销，请谨慎操作。`,
      confirmText: "全部彻底清空",
      danger: true,
      onConfirm: async () => {
        try {
          await cmdClearHistory();
          setHistory([]);
        } catch (err) {
          console.error("Failed to clear history:", err);
        }
      },
    });
  };

  const handleExportAnki = async () => {
    const targetItems = activeSubTab === "vocabulary"
      ? history.filter((i) => i.isFavorite)
      : history;
    if (targetItems.length === 0) return;
    try {
      const csv = await cmdExportAnki(targetItems);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `cg_translator_vocabulary_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
    }
  };

  const filteredItems = history.filter((item) => {
    // 生词本视图：100% 严格仅展示用户主动点亮 ⭐ 收藏的生词
    if (activeSubTab === "vocabulary" && !item.isFavorite) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return item.original.toLowerCase().includes(q) || item.translated.toLowerCase().includes(q);
    }
    return true;
  });

  /* ── 批量操作逻辑 ────────────────────────────────────────────────────────── */
  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const allVisibleSelected = filteredItems.length > 0 && filteredItems.every((i) => selectedIds.has(i.id));

  const handleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredItems.map((i) => i.id)));
    }
  };

  const handleBatchUnfavorite = async () => {
    if (selectedIds.size === 0) return;
    setIsBatchProcessing(true);
    try {
      await cmdBatchSetFavorite(Array.from(selectedIds), false);
      setHistory((prev) =>
        prev.map((item) => (selectedIds.has(item.id) ? { ...item, isFavorite: false } : item))
      );
      setSelectedIds(new Set());
    } catch (err) {
      console.error("Failed to batch unfavorite:", err);
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const handleBatchFavorite = async () => {
    if (selectedIds.size === 0) return;
    setIsBatchProcessing(true);
    try {
      await cmdBatchSetFavorite(Array.from(selectedIds), true);
      setHistory((prev) =>
        prev.map((item) => (selectedIds.has(item.id) ? { ...item, isFavorite: true } : item))
      );
      setSelectedIds(new Set());
    } catch (err) {
      console.error("Failed to batch favorite:", err);
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    setConfirmModal({
      title: activeSubTab === "vocabulary" ? "彻底删除生词记录" : "彻底删除查询历史",
      body:
        activeSubTab === "vocabulary"
          ? `确定要彻底删除已选中的 ${count} 条生词记录吗？\n\n⚠️ 该操作将同时从查询历史与生词本中永久抹除，不可撤销。\n\n💡 提示：如仅希望不在生词本中显示，建议使用「移出生词本」保留查词历史。`
          : `确定要彻底删除已选中的 ${count} 条查询历史记录吗？此操作不可撤销。`,
      confirmText: `彻底删除 (${count})`,
      danger: true,
      onConfirm: async () => {
        setIsBatchProcessing(true);
        try {
          await cmdDeleteHistoryEntries(Array.from(selectedIds));
          setHistory((prev) => prev.filter((item) => !selectedIds.has(item.id)));
          setSelectedIds(new Set());
        } catch (err) {
          console.error("Failed to batch delete:", err);
        } finally {
          setIsBatchProcessing(false);
        }
      },
    });
  };

  /* ── 复习模式逻辑 ─────────────────────────────────────────────────────── */

  const favoriteCount = history.filter((i) => i.isFavorite).length;
  // Review pool = starred words ONLY (falling back to raw history would quiz
  // users on transient lookups they never chose to memorise)
  const reviewPool = history.filter((i) => i.isFavorite);
  const dueCount = reviewPool.filter((i) => isReviewDue(reviewProgress, i.id)).length;

  const startReview = () => {
    const queue = reviewPool
      .filter((i) => isReviewDue(reviewProgress, i.id))
      .sort((a, b) => (reviewProgress[a.id]?.box ?? -1) - (reviewProgress[b.id]?.box ?? -1))
      .slice(0, MAX_REVIEW_QUEUE);
    if (queue.length === 0) return;
    setReviewQueue(queue);
    setReviewIndex(0);
    setReviewRevealed(false);
    setReviewStats({ known: 0, fuzzy: 0, forgot: 0 });
    setReviewFinished(false);
  };

  const gradeCurrent = (grade: "known" | "fuzzy" | "forgot") => {
    const item = reviewQueue[reviewIndex];
    if (!item) return;
    const prev = reviewProgress[item.id];
    const box = grade === "known"
      ? Math.min((prev?.box ?? 0) + 1, REVIEW_INTERVAL_DAYS.length - 1)
      : grade === "forgot"
        ? 0
        : (prev?.box ?? 0);
    const next = { ...reviewProgress, [item.id]: { box, lastReviewedAt: Date.now() } };
    setReviewProgress(next);
    persistReviewProgress(next);
    setReviewStats((s) => ({
      known: s.known + (grade === "known" ? 1 : 0),
      fuzzy: s.fuzzy + (grade === "fuzzy" ? 1 : 0),
      forgot: s.forgot + (grade === "forgot" ? 1 : 0),
    }));

    if (reviewIndex + 1 >= reviewQueue.length) {
      setReviewFinished(true);
    } else {
      setReviewIndex((i) => i + 1);
      setReviewRevealed(false);
    }
  };

  const exitReview = () => {
    setReviewQueue([]);
    setReviewIndex(0);
    setReviewRevealed(false);
    setReviewFinished(false);
  };

  const currentReviewItem = reviewQueue[reviewIndex];

  // ── 复习键盘流：空格翻面 · 1/2/3 评分 · Esc 退出 ─────────────────────────
  useEffect(() => {
    if (reviewQueue.length === 0 || reviewFinished) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.code === "Space") {
        e.preventDefault();
        setReviewRevealed((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        exitReview();
        return;
      }
      if (reviewRevealed && (e.key === "1" || e.key === "2" || e.key === "3")) {
        e.preventDefault();
        gradeCurrent(e.key === "1" ? "forgot" : e.key === "2" ? "fuzzy" : "known");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  /* ── 渲染 ─────────────────────────────────────────────────────────────── */

  return (
    <div className="space-y-5 max-w-4xl mx-auto pb-28">
      {/* 统计卡横排：支持一键点击直达对应功能模块 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {[
          { tab: "vocabulary" as const, icon: Star, label: "我的生词", value: favoriteCount, color: "var(--warn)" },
          { tab: "vocabulary" as const, icon: GraduationCap, label: "待复习", value: dueCount, color: dueCount > 0 ? "var(--danger)" : "var(--ok)" },
          { tab: "history" as const, icon: Clock, label: "查询历史", value: history.length, color: "var(--accent-text)" },
          { tab: "replay" as const, icon: Camera, label: "划词回放", value: sessions.length, color: "var(--accent-text)" },
        ].map((stat) => {
          const Icon = stat.icon;
          const isActive = activeSubTab === stat.tab;
          return (
            <div
              key={stat.label}
              onClick={() => setActiveSubTab(stat.tab)}
              className={`lg-panel flex items-center gap-3 p-3 cursor-pointer transition-all hover:scale-[1.01] hover:border-[var(--g-border-strong)] ${
                isActive ? "ring-1 ring-[var(--accent)]/40 shadow-sm" : ""
              }`}
              title={`点击切换到「${stat.tab === "replay" ? "截图划词回放" : stat.tab === "vocabulary" ? "我的生词本" : "查询历史"}」`}
            >
              <div className="lg-inset !p-2 rounded-xl shrink-0">
                <Icon className="h-4 w-4" style={{ color: stat.color }} />
              </div>
              <div className="min-w-0">
                <div className="text-lg font-bold leading-none tabular-nums">{stat.value}</div>
                <div className="text-[10.5px] mt-1 truncate" style={{ color: "var(--g-text-3)" }}>{stat.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 模块分类导航栏 */}
      <div className="flex items-center justify-between gap-3 p-1.5 rounded-2xl lg-panel flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            data-testid="subtab-vocabulary"
            onClick={() => setActiveSubTab("vocabulary")}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
              activeSubTab === "vocabulary"
                ? "bg-[var(--accent)] text-white shadow-sm"
                : "hover:bg-[var(--g-surface-2)] text-[var(--g-text-2)]"
            }`}
          >
            <Star className={`h-3.5 w-3.5 ${activeSubTab === "vocabulary" ? "fill-current" : ""}`} />
            <span>⭐ 我的生词本</span>
            <span
              className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                activeSubTab === "vocabulary" ? "bg-white/20 text-white" : "bg-[var(--g-surface-3)] text-[var(--g-text-3)]"
              }`}
            >
              {favoriteCount}
            </span>
          </button>

          <button
            type="button"
            data-testid="subtab-history"
            onClick={() => setActiveSubTab("history")}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
              activeSubTab === "history"
                ? "bg-[var(--accent)] text-white shadow-sm"
                : "hover:bg-[var(--g-surface-2)] text-[var(--g-text-2)]"
            }`}
          >
            <Clock className="h-3.5 w-3.5" />
            <span>🕒 查询历史</span>
            <span
              className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                activeSubTab === "history" ? "bg-white/20 text-white" : "bg-[var(--g-surface-3)] text-[var(--g-text-3)]"
              }`}
            >
              {history.length}
            </span>
          </button>

          <button
            type="button"
            data-testid="subtab-clipboard"
            onClick={() => setActiveSubTab("clipboard")}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
              activeSubTab === "clipboard"
                ? "bg-[var(--accent)] text-white shadow-sm"
                : "hover:bg-[var(--g-surface-2)] text-[var(--g-text-2)]"
            }`}
          >
            <ClipboardList className="h-3.5 w-3.5" />
            <span>📋 剪贴板翻译</span>
            <span
              className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                activeSubTab === "clipboard" ? "bg-white/20 text-white" : "bg-[var(--g-surface-3)] text-[var(--g-text-3)]"
              }`}
            >
              {clipHistory.length}
            </span>
          </button>

          <button
            type="button"
            data-testid="subtab-replay"
            onClick={() => setActiveSubTab("replay")}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
              activeSubTab === "replay"
                ? "bg-[var(--accent)] text-white shadow-sm"
                : "hover:bg-[var(--g-surface-2)] text-[var(--g-text-2)]"
            }`}
          >
            <Camera className="h-3.5 w-3.5" />
            <span>📸 划词回放</span>
            <span
              className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                activeSubTab === "replay" ? "bg-white/20 text-white" : "bg-[var(--g-surface-3)] text-[var(--g-text-3)]"
              }`}
            >
              {sessions.length}
            </span>
          </button>
        </div>
      </div>

      {/* Header and Controls */}
      {(activeSubTab === "vocabulary" || activeSubTab === "history") && (
        <>
          <div className="lg-panel p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center space-x-3">
              {activeSubTab === "vocabulary" ? (
                <Star className="h-6 w-6 text-amber-500 fill-amber-500 shrink-0" />
              ) : (
                <Clock className="h-6 w-6 shrink-0" style={{ color: "var(--accent-text)" }} />
              )}
              <div>
                <h2 className="text-lg font-bold">
                  {activeSubTab === "vocabulary" ? "我的生词本" : "查询历史记录"}
                </h2>
                <p className="text-xs" style={{ color: "var(--g-text-2)" }}>
                  {activeSubTab === "vocabulary"
                    ? `已收藏 ${favoriteCount} 条生词${dueCount > 0 ? ` (当前 ${dueCount} 条待复习)` : " · 暂无到期生词"}`
                    : `已保存 ${history.length} 条查询记录 (收藏 ${favoriteCount} 条)`}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2.5 flex-wrap">
              {activeSubTab === "vocabulary" ? (
                <>
                  <button
                    onClick={startReview}
                    disabled={dueCount === 0}
                    className="lg-btn lg-btn-primary disabled:cursor-not-allowed cursor-pointer"
                    title={
                      favoriteCount === 0
                        ? "先在列表或翻译结果里点亮 ⭐ 收藏生词，才会进入复习队列"
                        : dueCount > 0
                          ? `开始复习 ${Math.min(dueCount, MAX_REVIEW_QUEUE)} 个到期生词`
                          : "当前没有到期生词"
                    }
                  >
                    <GraduationCap className="h-4 w-4" />
                    <span>开始复习{dueCount > 0 ? ` (${Math.min(dueCount, MAX_REVIEW_QUEUE)})` : ""}</span>
                  </button>

                  <button
                    onClick={() => setShowAnkiModal(true)}
                    disabled={favoriteCount === 0}
                    className="lg-btn lg-btn-primary cursor-pointer disabled:opacity-50"
                    title="通过 AnkiConnect 直连同步生词，或一键导出 Anki 卡片"
                  >
                    <GraduationCap className="h-4 w-4" />
                    <span>📇 同步至 Anki</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsBatchMode((prev) => {
                        if (prev) setSelectedIds(new Set());
                        return !prev;
                      });
                    }}
                    data-testid="header-batch-toggle"
                    className={`lg-btn cursor-pointer transition ${
                      isBatchMode
                        ? "bg-[var(--accent)] text-white shadow-sm"
                        : "lg-btn-ghost hover:bg-[var(--g-surface-2)]"
                    }`}
                    title={isBatchMode ? "退出批量操作" : "开启批量管理"}
                  >
                    <CheckSquare className="h-4 w-4" />
                    <span>{isBatchMode ? "退出批量" : "批量管理"}</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setIsBatchMode((prev) => {
                        if (prev) setSelectedIds(new Set());
                        return !prev;
                      });
                    }}
                    data-testid="header-history-batch-toggle"
                    className={`lg-btn cursor-pointer transition ${
                      isBatchMode
                        ? "bg-[var(--accent)] text-white shadow-sm"
                        : "lg-btn-ghost hover:bg-[var(--g-surface-2)]"
                    }`}
                    title={isBatchMode ? "退出批量操作" : "开启批量管理"}
                  >
                    <CheckSquare className="h-4 w-4" />
                    <span>{isBatchMode ? "退出批量" : "批量管理"}</span>
                  </button>

                  <button
                    onClick={handleClearUnfavorited}
                    disabled={history.filter((i) => !i.isFavorite).length === 0}
                    className="lg-btn lg-btn-ghost cursor-pointer disabled:opacity-40"
                    title="仅清空未收藏的临时查询记录，完整保留生词本中的所有收藏"
                  >
                    <Trash className="h-4 w-4" />
                    <span>清空未收藏历史</span>
                  </button>

                  <button
                    onClick={handleClearAll}
                    disabled={history.length === 0}
                    className="lg-btn lg-btn-ghost text-red-500/80 hover:text-red-500 cursor-pointer disabled:opacity-30 text-[11px]"
                    title="清空全部历史记录与生词本"
                  >
                    <span>清空全部</span>
                  </button>

                  <button
                    onClick={() => setShowAnkiModal(true)}
                    disabled={history.length === 0}
                    className="lg-btn lg-btn-primary cursor-pointer disabled:opacity-50"
                    title="将查询历史同步至 Anki 或导出文件"
                  >
                    <GraduationCap className="h-4 w-4" />
                    <span>同步至 Anki</span>
                  </button>
                </>
              )}
            </div>
          </div>

      {/* 复习卡片模式（遮住译文自测 + Leitner 评分） */}
      {reviewQueue.length > 0 && (
        <div className="lg-surface p-6 relative overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <GraduationCap className="h-5 w-5" style={{ color: "var(--accent-text)" }} />
              <h3 className="text-sm font-bold">生词复习</h3>
              <span className="lg-pill">
                {reviewFinished ? reviewQueue.length : reviewIndex + 1} / {reviewQueue.length}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {!reviewFinished && (
                <button onClick={() => setReviewRevealed((v) => !v)} className="lg-btn !py-1.5 !text-[11px]">
                  {reviewRevealed ? <RotateCcw className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  <span>{reviewRevealed ? "重新遮挡" : "显示答案"}</span>
                </button>
              )}
              <button onClick={exitReview} className="lg-btn lg-btn-ghost !p-2" title="退出复习">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* 进度条 */}
          <div className="lg-inset h-1.5 !rounded-full overflow-hidden mb-5">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${((reviewFinished ? reviewQueue.length : reviewIndex) / reviewQueue.length) * 100}%`,
                background: "var(--accent)",
              }}
            />
          </div>

          {!reviewFinished && (
            <p className="text-[10.5px] text-center mb-3" style={{ color: "var(--g-text-3)" }} data-testid="review-kbd-hint">
              空格 翻面 · 1 不认识 · 2 模糊 · 3 认识 · Esc 退出
            </p>
          )}

          {reviewFinished ? (
            <div className="text-center py-8 space-y-4">
              <div className="lg-inset inline-flex h-14 w-14 items-center justify-center !rounded-2xl">
                <Check className="h-7 w-7" style={{ color: "var(--ok)" }} />
              </div>
              <div>
                <h4 className="text-sm font-bold">本轮复习完成</h4>
                <p className="text-xs mt-1.5" style={{ color: "var(--g-text-2)" }}>
                  认识 <strong style={{ color: "var(--ok)" }}>{reviewStats.known}</strong> ·
                  模糊 <strong style={{ color: "var(--warn)" }}>{reviewStats.fuzzy}</strong> ·
                  不认识 <strong style={{ color: "var(--danger)" }}>{reviewStats.forgot}</strong>
                  　已按艾宾浩斯间隔安排下一轮
                </p>
              </div>
              <div className="flex items-center justify-center gap-2">
                <button onClick={exitReview} className="lg-btn">返回生词本</button>
              </div>
            </div>
          ) : currentReviewItem && (
            <div className="text-center py-6 space-y-5">
              {/* 正面：原文 */}
              <div className="space-y-2">
                <p className="text-2xl font-bold tracking-tight break-words">{currentReviewItem.original}</p>
                <button
                  onClick={() => handleSpeech(currentReviewItem.original)}
                  className="lg-btn lg-btn-ghost !p-2"
                  title="朗读原词"
                >
                  <Volume2 className="h-4 w-4" />
                </button>
              </div>

              {/* 背面：译文 */}
              {reviewRevealed ? (
                <div className="space-y-1 page-in">
                  <p className="text-lg font-semibold" style={{ color: "var(--accent-text)" }}>
                    {currentReviewItem.translated}
                  </p>
                  <span className="lg-pill font-mono">{currentReviewItem.sourceTier}</span>
                </div>
              ) : (
                <button onClick={() => setReviewRevealed(true)} className="lg-btn !px-6 !py-2.5">
                  <Eye className="h-4 w-4" />
                  <span>显示答案</span>
                </button>
              )}

              {/* 自评三键 */}
              {reviewRevealed && (
                <div className="flex items-center justify-center gap-2.5 page-in">
                  <button
                    onClick={() => gradeCurrent("forgot")}
                    className="lg-btn !px-5"
                    style={{ color: "var(--danger)", borderColor: "color-mix(in srgb, var(--danger) 40%, transparent)" }}
                  >
                    <span>不认识</span>
                  </button>
                  <button
                    onClick={() => gradeCurrent("fuzzy")}
                    className="lg-btn !px-5"
                    style={{ color: "var(--warn)", borderColor: "color-mix(in srgb, var(--warn) 40%, transparent)" }}
                  >
                    <span>模糊</span>
                  </button>
                  <button
                    onClick={() => gradeCurrent("known")}
                    className="lg-btn lg-btn-primary !px-5"
                  >
                    <Check className="h-4 w-4" />
                    <span>认识</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Filter Search Bar & Batch Mode Toggle */}
      <div className="flex items-center gap-2.5">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "var(--g-text-3)" }} />
          <input
            type="text"
            placeholder={activeSubTab === "vocabulary" ? "在我的生词本中搜索..." : "在查询历史记录中搜索..."}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="lg-input w-full !rounded-xl pl-10 pr-4 py-2.5 text-xs shadow-sm"
          />
        </div>
        <button
          type="button"
          data-testid="batch-mode-toggle"
          onClick={() => {
            setIsBatchMode((prev) => {
              if (prev) setSelectedIds(new Set());
              return !prev;
            });
          }}
          className={`lg-btn !px-3.5 !py-2.5 !rounded-xl !text-xs cursor-pointer transition shrink-0 ${
            isBatchMode
              ? "bg-[var(--accent)] text-white shadow-sm"
              : "lg-btn-ghost hover:bg-[var(--g-surface-2)]"
          }`}
          title={isBatchMode ? "退出批量操作" : "开启批量管理"}
        >
          <CheckSquare className="h-4 w-4" />
          <span>{isBatchMode ? "退出批量" : "批量管理"}</span>
        </button>
      </div>

      {/* 顶部常驻批量操作栏（批量模式开启时立即显式展开在搜索栏正下方） */}
      {isBatchMode && (activeSubTab === "vocabulary" || activeSubTab === "history") && (
        <div className="lg-panel p-3.5 rounded-2xl border-2 border-[var(--accent)]/50 bg-[var(--accent)]/5 flex items-center justify-between gap-3 flex-wrap shadow-md animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSelectAll}
              data-testid="batch-select-all"
              className="lg-btn !text-xs !py-1.5 !px-3.5 cursor-pointer border border-[var(--g-border-strong)] hover:border-[var(--accent)] bg-[var(--g-surface)] font-medium shadow-xs"
            >
              <CheckSquare className="h-3.5 w-3.5 text-[var(--accent-text)]" />
              <span>{allVisibleSelected ? "取消全选" : `全选当前 (${filteredItems.length})`}</span>
            </button>

            <span
              data-testid="batch-selected-count"
              className="text-xs font-semibold tabular-nums"
              style={{ color: "var(--g-text-2)" }}
            >
              已选 <span className="font-bold text-[var(--accent-text)] text-sm">{selectedIds.size}</span> / {filteredItems.length} 项
            </span>
          </div>

          <div className="flex items-center gap-2">
            {activeSubTab === "vocabulary" ? (
              <>
                <button
                  type="button"
                  disabled={selectedIds.size === 0 || isBatchProcessing}
                  onClick={() => setShowAnkiModal(true)}
                  data-testid="batch-anki-btn"
                  className="lg-btn lg-btn-primary !text-xs !py-1.5 !px-3.5 cursor-pointer disabled:opacity-40 font-semibold"
                  title="将选中的生词同步至 Anki"
                >
                  <GraduationCap className="h-3.5 w-3.5" />
                  <span>同步至 Anki{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}</span>
                </button>

                <button
                  type="button"
                  disabled={selectedIds.size === 0 || isBatchProcessing}
                  onClick={handleBatchUnfavorite}
                  data-testid="batch-unfavorite-btn"
                  className="lg-btn !text-xs !py-1.5 !px-3.5 cursor-pointer disabled:opacity-40 font-semibold"
                  title="从生词本中移出（保留在查询历史中，防误删）"
                >
                  <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
                  <span>移出生词本{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}</span>
                </button>

                <button
                  type="button"
                  disabled={selectedIds.size === 0 || isBatchProcessing}
                  onClick={handleBatchDelete}
                  data-testid="batch-delete-btn"
                  className="lg-btn lg-btn-ghost text-red-500 hover:bg-red-500/10 !text-xs !py-1.5 !px-3.5 cursor-pointer disabled:opacity-40 font-semibold border border-red-500/30"
                  title="彻底抹除所选记录（从生词本与查询历史中彻底删除）"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>彻底删除{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={selectedIds.size === 0 || isBatchProcessing}
                  onClick={handleBatchFavorite}
                  data-testid="batch-favorite-btn"
                  className="lg-btn lg-btn-primary !text-xs !py-1.5 !px-3.5 cursor-pointer disabled:opacity-40 font-semibold"
                  title="将所选记录批量加入生词本"
                >
                  <Star className="h-3.5 w-3.5 fill-current" />
                  <span>加入生词本{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}</span>
                </button>

                <button
                  type="button"
                  disabled={selectedIds.size === 0 || isBatchProcessing}
                  onClick={handleBatchDelete}
                  data-testid="batch-delete-btn"
                  className="lg-btn lg-btn-ghost text-red-500 hover:bg-red-500/10 !text-xs !py-1.5 !px-3.5 cursor-pointer disabled:opacity-40 font-semibold border border-red-500/30"
                  title="从查询历史中彻底删除"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>彻底删除{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => {
                setIsBatchMode(false);
                setSelectedIds(new Set());
              }}
              className="lg-btn lg-btn-ghost !text-xs !py-1.5 !px-3 cursor-pointer ml-1"
              title="完成并退出批量操作"
            >
              <X className="h-3.5 w-3.5" />
              <span>退出批量</span>
            </button>
          </div>
        </div>
      )}

      {/* History Items List */}
      <div className="space-y-3">
        {filteredItems.length === 0 ? (
          <div className="lg-panel text-center py-14 space-y-3" style={{ color: "var(--g-text-3)" }}>
            <Inbox className="h-10 w-10 mx-auto opacity-60" />
            <p className="text-xs">
              {activeSubTab === "vocabulary"
                ? (favoriteCount === 0
                    ? "生词本暂无收藏。在首页翻译或查询历史中点击 ⭐ 即可加入生词本"
                    : "生词本中未找到匹配的词条")
                : (history.length === 0
                    ? "暂无任何历史记录，去「翻译」或「查词」页进行首次翻译吧"
                    : "查询历史中未找到匹配的记录")}
            </p>
          </div>
        ) : (
          <>
            {filteredItems.slice(0, visibleCount).map((item) => {
              const box = reviewProgress[item.id]?.box;
              const isSelected = selectedIds.has(item.id);
              return (
                <div
                  key={item.id}
                  onClick={isBatchMode ? () => handleToggleSelect(item.id) : undefined}
                  className={`lg-inset p-4 flex items-center justify-between transition ${
                    isBatchMode ? "cursor-pointer select-none" : ""
                  } ${
                    isSelected
                      ? "ring-2 ring-[var(--accent)]/60 bg-[var(--accent)]/10 border-[var(--accent)]/40 shadow-sm"
                      : "hover:bg-[var(--g-surface-2)]"
                  }`}
                >
                  {isBatchMode && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleSelect(item.id);
                      }}
                      data-testid={`batch-checkbox-${item.id}`}
                      className={`w-5 h-5 rounded-md flex items-center justify-center transition-all shrink-0 cursor-pointer mr-3.5 ${
                        isSelected
                          ? "bg-[var(--accent)] text-white shadow-xs border border-[var(--accent)]"
                          : "border-2 border-[var(--g-border-strong)] hover:border-[var(--accent)] bg-[var(--g-surface)]"
                      }`}
                      title={isSelected ? "取消选择" : "选择此项"}
                    >
                      {isSelected && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                    </button>
                  )}

                  <div className="space-y-1 flex-1 pr-4 min-w-0">
                    <div className="flex items-center space-x-3 flex-wrap">
                      <span className="font-semibold text-base truncate">{item.original}</span>
                      <button
                        onClick={(e) => {
                          if (isBatchMode) e.stopPropagation();
                          handleSpeech(item.original);
                        }}
                        className="transition hover:opacity-70"
                        style={{ color: "var(--g-text-3)" }}
                      >
                        <Volume2 className="h-4 w-4" />
                      </button>
                      <span className="lg-pill font-mono">{item.sourceTier}</span>
                      {(item.isFavorite || box !== undefined) && (
                        <span
                          className="lg-pill"
                          data-testid={`due-badge-${item.id}`}
                          title={`Leitner 盒 ${box ?? 0}/5 · 间隔 ${REVIEW_INTERVAL_DAYS[Math.min(box ?? 0, 5)]} 天 · 下次复习：${nextDueText(reviewProgress, item.id)}`}
                          style={
                            isReviewDue(reviewProgress, item.id)
                              ? { color: "var(--danger)", borderColor: "color-mix(in srgb, var(--danger) 40%, transparent)" }
                              : undefined
                          }
                        >
                          <GraduationCap className="h-3 w-3" />
                          {nextDueText(reviewProgress, item.id)}
                          {box !== undefined ? ` · 盒 ${box}` : ""}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-bold" style={{ color: isLight ? "#059669" : "#34d399" }}>{item.translated}</p>
                    <div className="flex items-center space-x-2 text-[11px]" style={{ color: "var(--g-text-3)" }}>
                      <Clock className="h-3 w-3" />
                      <span>{item.timestamp}</span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 shrink-0">
                    <button
                      onClick={(e) => {
                        if (isBatchMode) e.stopPropagation();
                        handleToggleFav(item.id);
                      }}
                      data-testid={`fav-toggle-${item.id}`}
                      className="lg-btn lg-btn-ghost !p-2"
                      style={item.isFavorite ? { color: "var(--warn)", background: "color-mix(in srgb, var(--warn) 14%, transparent)" } : undefined}
                      title={item.isFavorite ? "从生词本移除" : "加入生词本"}
                    >
                      <Star className={`h-4 w-4 ${item.isFavorite ? "fill-current" : ""}`} />
                    </button>

                    <button
                      onClick={(e) => {
                        if (isBatchMode) e.stopPropagation();
                        handleDelete(item.id);
                      }}
                      className="lg-btn lg-btn-ghost !p-2"
                      style={{ color: "var(--danger)" }}
                      title="删除该条记录"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}

            {filteredItems.length > visibleCount && (
              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => setVisibleCount((prev) => prev + 30)}
                  className="lg-btn lg-btn-ghost text-xs px-5 py-2 hover:bg-[var(--g-surface-2)] transition cursor-pointer"
                >
                  加载更多记录 (还有 {filteredItems.length - visibleCount} 条)
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* 底部悬浮批量操作栏（使用 React Portal 挂载到 body，突破包含块限制并置于 Dock 之上） */}
      {isBatchMode && (activeSubTab === "vocabulary" || activeSubTab === "history") && typeof document !== "undefined" && createPortal(
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[100] lg-panel px-5 py-3 shadow-2xl rounded-2xl flex items-center gap-3.5 flex-wrap max-w-[94vw] border-2 border-[var(--accent)]/50 bg-[var(--g-surface)]/95 backdrop-blur-xl">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSelectAll}
              className="lg-btn lg-btn-ghost !text-xs !py-1.5 !px-2.5 cursor-pointer"
              data-testid="batch-select-all-floating"
            >
              <span>{allVisibleSelected ? "取消全选" : "全选当前"}</span>
            </button>
            <span
              data-testid="batch-selected-count-floating"
              className="text-xs font-semibold tabular-nums"
              style={{ color: "var(--g-text-2)" }}
            >
              已选 <span className="font-bold text-[var(--accent-text)]">{selectedIds.size}</span> / {filteredItems.length} 项
            </span>
          </div>

          <div className="h-4 w-[1px] bg-[var(--g-border)] hidden sm:block" />

          <div className="flex items-center gap-2">
            {activeSubTab === "vocabulary" ? (
              <>
                <button
                  type="button"
                  disabled={selectedIds.size === 0 || isBatchProcessing}
                  onClick={handleBatchUnfavorite}
                  className="lg-btn !text-xs !py-1.5 !px-3 cursor-pointer disabled:opacity-40 font-medium"
                  data-testid="batch-unfavorite-btn-floating"
                  title="从生词本中移出（保留在查询历史中）"
                >
                  <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
                  <span>移出生词本{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}</span>
                </button>

                <button
                  type="button"
                  disabled={selectedIds.size === 0 || isBatchProcessing}
                  onClick={handleBatchDelete}
                  className="lg-btn lg-btn-ghost text-red-500 hover:bg-red-500/10 !text-xs !py-1.5 !px-3 cursor-pointer disabled:opacity-40 font-medium border border-red-500/30"
                  data-testid="batch-delete-btn-floating"
                  title="从所有历史记录与生词本中彻底删除"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>彻底删除{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={selectedIds.size === 0 || isBatchProcessing}
                  onClick={handleBatchFavorite}
                  className="lg-btn lg-btn-primary !text-xs !py-1.5 !px-3 cursor-pointer disabled:opacity-40 font-medium"
                  data-testid="batch-favorite-btn-floating"
                  title="将所选记录批量加入生词本"
                >
                  <Star className="h-3.5 w-3.5 fill-current" />
                  <span>加入生词本{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}</span>
                </button>

                <button
                  type="button"
                  disabled={selectedIds.size === 0 || isBatchProcessing}
                  onClick={handleBatchDelete}
                  className="lg-btn lg-btn-ghost text-red-500 hover:bg-red-500/10 !text-xs !py-1.5 !px-3 cursor-pointer disabled:opacity-40 font-medium border border-red-500/30"
                  data-testid="batch-delete-btn-floating"
                  title="从查询历史中彻底删除"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>彻底删除{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => {
                setIsBatchMode(false);
                setSelectedIds(new Set());
              }}
              className="lg-btn lg-btn-ghost !text-xs !py-1.5 !px-2.5 cursor-pointer ml-1"
              title="完成并退出批量操作"
            >
              <X className="h-3.5 w-3.5" />
              <span>退出</span>
            </button>
          </div>
        </div>,
        document.body
      )}
        </>
      )}

      {/* ── 剪贴板翻译历史 ─────────────────────────────────────────────────── */}
      {activeSubTab === "clipboard" && (
        <div className="lg-panel p-5 animate-in fade-in" data-testid="clipboard-history-section">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <ClipboardList className="h-4 w-4" style={{ color: "var(--accent-text)" }} />
              剪贴板翻译历史
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full border" style={{ color: "var(--g-text-3)", borderColor: "var(--g-border)" }}>
                {clipHistory.length}
              </span>
            </h3>
            {clipHistory.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm("确定清空全部剪贴板翻译历史吗？")) return;
                  cmdClearClipboardHistory()
                    .then(() => setClipHistory([]))
                    .catch(console.warn);
                }}
                className="flex items-center gap-1 text-[11px] font-medium rounded-lg px-2 py-1 border transition cursor-pointer hover:bg-rose-500/10 hover:text-rose-500"
                style={{ color: "var(--g-text-3)", borderColor: "var(--g-border)" }}
              >
                <Trash className="h-3 w-3" />
                <span>清空</span>
              </button>
            )}
          </div>

          {clipHistory.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--g-text-3)" }}>
              在设置中开启「剪贴板静默翻译」后，复制的外文会自动翻译并记录在这里
            </p>
          ) : (
            <div className={`${activeSubTab === 'clipboard' ? 'max-h-[62vh]' : 'max-h-72'} space-y-1.5 overflow-y-auto pr-1 scrollbar-thin`}>
              {clipHistory.slice(0, visibleClipCount).map((entry, idx) => (
                <div
                  key={`${entry.atMs}_${idx}`}
                  className="rounded-lg border px-3 py-2 text-xs"
                  style={{ borderColor: "var(--g-border)" }}
                  data-testid="clipboard-history-item"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono truncate" style={{ color: "var(--g-text-3)" }}>{entry.original}</span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="text-[9px] font-mono px-1 rounded border" style={{ color: "var(--g-text-3)", borderColor: "var(--g-border)" }}>
                        {entry.sourceTier}
                      </span>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(entry.translated)}
                        className="rounded p-0.5 transition cursor-pointer hover:text-sky-500"
                        style={{ color: "var(--g-text-3)" }}
                        title="复制译文"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-0.5 font-bold truncate">{entry.translated}</div>
                </div>
              ))}
              {clipHistory.length > visibleClipCount && (
                <div className="text-center pt-1">
                  <button
                    type="button"
                    onClick={() => setVisibleClipCount((prev) => prev + 20)}
                    className="text-[11px] font-medium px-3 py-1 rounded hover:bg-[var(--g-surface-2)] transition cursor-pointer"
                    style={{ color: "var(--g-text-3)" }}
                  >
                    查看更多剪贴板记录 (还有 {clipHistory.length - visibleClipCount} 条)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── 划词回放：整场截图翻译会话时间线 ───────────────────────────────── */}
      {activeSubTab === "replay" && (
        <div className="lg-panel p-5 animate-in fade-in">
        <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: "var(--g-hairline)" }}>
          <div className="flex items-center space-x-2.5">
            <Camera className="h-5 w-5" style={{ color: "var(--accent-text)" }} />
            <h3 className="text-sm font-bold">划词回放</h3>
            <span className="text-[11px]" style={{ color: "var(--g-text-2)" }}>
              {sessions.length > 0 ? `${sessions.length} 场截图翻译可重看` : "使用划词翻译后会自动保存整场会话"}
            </span>
          </div>
          {sessions.length > 0 && (
            <button onClick={handleClearSessions} className="lg-btn lg-btn-ghost !px-2.5 !py-1.5 !text-[11px]" style={{ color: "var(--danger)" }}>
              <Trash className="h-3.5 w-3.5" />
              <span>清空回放</span>
            </button>
          )}
        </div>

        {sessions.length === 0 ? (
          <div className="flex flex-col items-center py-6 text-xs space-y-2" style={{ color: "var(--g-text-3)" }}>
            <Play className="h-8 w-8 opacity-50" />
            <p>按 {settings.hotkey || "F4"} 截图划词后，这里会出现可回放的翻译现场</p>
          </div>
        ) : (
          <div className="space-y-2 pt-3">
            {sessions.slice(0, visibleSessionCount).map((session) => (
              <div
                key={session.id}
                className="lg-inset flex items-center justify-between gap-3 p-3 cursor-pointer transition group hover:border-[var(--g-border-strong)]"
                onClick={() => setReplay(session)}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="lg-pill !p-2 shrink-0 group-hover:scale-105 transition-transform">
                    <Play className="h-3.5 w-3.5" style={{ color: "var(--accent-text)" }} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold">{session.timestamp}</span>
                      <span className="lg-pill font-mono">
                        {session.engine} → {session.targetLang}
                      </span>
                      <span className="text-[10px]" style={{ color: "var(--g-text-3)" }}>
                        {session.blocks.length} 个文本块
                      </span>
                    </div>
                    <p className="text-[11px] truncate mt-0.5" style={{ color: "var(--g-text-2)" }}>
                      {session.blocks.map((b) => b.original).join(" · ")}
                    </p>
                  </div>
                </div>
                <span className="text-[10px] shrink-0 opacity-0 group-hover:opacity-100 transition" style={{ color: "var(--accent-text)" }}>
                  点击回放 →
                </span>
              </div>
            ))}
            {sessions.length > visibleSessionCount && (
              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => setVisibleSessionCount((prev) => prev + 10)}
                  className="text-[11px] font-medium px-3 py-1 rounded hover:bg-[var(--g-surface-2)] transition cursor-pointer"
                  style={{ color: "var(--g-text-3)" }}
                >
                  查看更多回放记录 (还有 {sessions.length - visibleSessionCount} 场)
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {/* ── 回放弹窗：原位卡片重演 + 文本对照 ─────────────────────────────── */}
      {replay && typeof document !== "undefined" && createPortal(
        <div
          className={`fixed inset-0 z-[500] flex items-center justify-center p-6 transition-colors ${
            isLight ? 'bg-black/20 backdrop-blur-sm' : 'bg-black/60 backdrop-blur-md'
          }`}
          style={{ animation: 'page-in 0.18s cubic-bezier(0.16, 1, 0.3, 1) both' }}
          onClick={() => setReplay(null)}
        >
          <div
            className="lg-surface w-full max-w-3xl max-h-[85vh] overflow-y-auto scrollbar-thin shadow-2xl"
            style={{ background: isLight ? 'rgba(255,255,255,0.96)' : 'rgba(20,22,30,0.96)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b sticky top-0 z-10 backdrop-blur-xl" style={{ borderColor: "var(--g-hairline)", background: isLight ? 'rgba(255,255,255,0.85)' : 'rgba(20,22,30,0.85)' }}>
              <div className="flex items-center gap-2.5">
                <Play className="h-4 w-4" style={{ color: "var(--accent-text)" }} />
                <span className="text-sm font-bold">
                  划词回放 · {replay.timestamp}
                </span>
                <span className="lg-pill font-mono">
                  {replay.engine} → {replay.targetLang}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleCopyReplay(replay)} className="lg-btn lg-btn-primary !px-3 !py-1.5 !text-xs">
                  {replayCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{replayCopied ? '已复制' : '复制全部'}</span>
                </button>
                <button onClick={() => handleExportReplay(replay)} className="lg-btn !px-3 !py-1.5 !text-xs">
                  <FileText className="h-3.5 w-3.5" />
                  <span>导出 TXT</span>
                </button>
                <button
                  onClick={() => setReplay(null)}
                  className="lg-btn lg-btn-ghost !p-2"
                  style={{ color: "var(--danger)" }}
                  title="关闭回放"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="p-5 space-y-5">
              {/* 原位卡片微缩重演：以真实文本包围盒为基准自适应缩放居中 */}
              {(() => {
                if (!replay.blocks || replay.blocks.length === 0) return null;
                const xs = replay.blocks.map((b) => b.logicalX);
                const ys = replay.blocks.map((b) => b.logicalY);
                const minX = Math.min(...xs);
                const minY = Math.min(...ys);
                const maxX = Math.max(...replay.blocks.map((b) => b.logicalX + b.logicalW));
                const maxY = Math.max(...replay.blocks.map((b) => b.logicalY + b.logicalH));
                const pad = 24;
                const rawW = Math.max(maxX - minX, 1);
                const rawH = Math.max(maxY - minY, 1);
                const contentW = rawW + pad * 2;
                const contentH = rawH + pad * 2;
                // 限制在最大 680x320 容器内等比缩放，放大上限 1.25，缩小下限 0.35
                const scale = Math.min(1.25, Math.max(0.35, Math.min(680 / contentW, 320 / contentH)));
                const boxW = Math.round(contentW * scale);
                const boxH = Math.round(contentH * scale);

                return (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] px-1" style={{ color: "var(--g-text-3)" }}>
                      <span>原位划词分布微缩还原 (共 {replay.blocks.length} 处译文)</span>
                      <span className="font-mono">缩放比例: {Math.round(scale * 100)}%</span>
                    </div>
                    <div
                      className="lg-inset relative mx-auto !rounded-xl overflow-hidden border shadow-inner transition-all flex items-center justify-center"
                      style={{
                        width: boxW,
                        height: boxH,
                        background: isLight ? 'rgba(0,0,0,0.03)' : 'rgba(0,0,0,0.25)',
                        borderColor: 'var(--g-hairline)',
                      }}
                    >
                      {replay.blocks.map((b, i) => (
                        <div
                          key={i}
                          className="absolute flex items-center justify-center rounded-[4px] overflow-hidden whitespace-nowrap text-ellipsis border transition-all"
                          style={{
                            left: (b.logicalX - minX + pad) * scale,
                            top: (b.logicalY - minY + pad) * scale,
                            width: Math.max(b.logicalW * scale, 22),
                            height: Math.max(b.logicalH * scale, 14),
                            background: b.bgCss || (isLight ? '#ffffff' : '#1e293b'),
                            color: b.fgCss || (isLight ? '#0f172a' : '#f8fafc'),
                            borderColor: 'rgba(0,0,0,0.12)',
                            fontSize: Math.max(10, Math.min(15, b.logicalH * scale * 0.72)),
                            fontWeight: 600,
                            padding: '0 4px',
                            boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
                          }}
                          title={`${b.original} → ${b.translated}`}
                        >
                          <span className="truncate">{b.translated || b.original}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* 文本对照列表 */}
              <div className="space-y-2">
                {replay.blocks.map((b, i) => (
                  <div key={i} className="lg-inset flex items-start gap-3 p-3 text-xs">
                    <span className="lg-pill !p-0 !w-5 !h-5 shrink-0 mt-0.5 font-mono font-bold justify-center" style={{ color: "var(--accent-text)" }}>
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-mono" style={{ color: "var(--g-text-2)" }}>{b.original}</p>
                      <p className="font-semibold mt-0.5">
                        {b.translated || "（未翻译）"}
                        <span className="ml-2 text-[10px] font-mono" style={{ color: "var(--g-text-3)" }}>[{b.sourceTier}]</span>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 跨平台安全确认弹窗 (彻底解决 Tauri WebView 下原生 window.confirm 被静默拦截或无响应问题) */}
      {confirmModal && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div
            className={`w-full max-w-sm rounded-2xl border p-5 space-y-4 shadow-2xl ${
              isLight ? "bg-white border-slate-200 text-slate-800" : "bg-zinc-900 border-white/10 text-zinc-100"
            }`}
          >
            <div className="flex items-start space-x-3">
              <div className="p-2 rounded-xl bg-red-500/10 text-red-500 shrink-0">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold">{confirmModal.title}</div>
                <p className={`mt-2 text-xs leading-relaxed whitespace-pre-line ${isLight ? "text-slate-600" : "text-zinc-400"}`}>
                  {confirmModal.body}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="lg-btn lg-btn-ghost !text-xs !py-1.5 !px-3.5 cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="confirm-dialog-submit"
                onClick={async () => {
                  const action = confirmModal.onConfirm;
                  setConfirmModal(null);
                  await action();
                }}
                className={`flex items-center space-x-1.5 rounded-xl px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition cursor-pointer ${
                  confirmModal.danger
                    ? "bg-red-600 hover:bg-red-500 border border-red-400/40"
                    : "bg-[var(--accent)] hover:opacity-90"
                }`}
              >
                <span>{confirmModal.confirmText || "确定"}</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Anki 同步与导出闭环弹窗 */}
      <AnkiSyncModal
        isOpen={showAnkiModal}
        onClose={() => setShowAnkiModal(false)}
        items={activeSubTab === "vocabulary" ? history.filter((i) => i.isFavorite) : history}
        selectedIds={selectedIds.size > 0 ? selectedIds : undefined}
      />
    </div>
  );
};
