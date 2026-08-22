import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Star, Download, Search, BookMarked, Clock, Volume2, Trash2, Trash, Inbox, Play, X, Copy, Check, Camera, FileText, GraduationCap, Eye, RotateCcw, Library, ClipboardList } from "lucide-react";
import { cmdGetHistory, cmdToggleFavorite, cmdExportAnki, cmdDeleteHistoryEntry, cmdClearHistory, cmdGetCaptureSessions, cmdClearCaptureSessions, cmdGetClipboardHistory, cmdClearClipboardHistory, type ClipboardHistoryEntry } from "../../services/tauri";
import { speakText } from "../../services/tts";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useAppTheme } from "../../hooks/useAppTheme";
import { detectSpeechLang } from "../../services/langDetect";
import type { HistoryItem, CaptureSession } from "../../services/types";

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
  const [filterFavorite, setFilterFavorite] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(30);
  const [visibleClipCount, setVisibleClipCount] = useState(20);
  const [visibleSessionCount, setVisibleSessionCount] = useState(10);

  useEffect(() => {
    setVisibleCount(30);
  }, [searchQuery, filterFavorite]);

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

  const handleClearSessions = async () => {
    if (sessions.length === 0) return;
    if (!window.confirm(`确定要清空全部 ${sessions.length} 场划词回放记录吗？`)) return;
    try {
      await cmdClearCaptureSessions();
      setSessions([]);
      setReplay(null);
    } catch (err) {
      console.error("Failed to clear capture sessions:", err);
    }
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

  const handleClearAll = async () => {
    if (history.length === 0) return;
    const confirmed = window.confirm(
      `确定要清空全部 ${history.length} 条生词本与历史记录吗？此操作不可撤销。`
    );
    if (!confirmed) return;
    try {
      await cmdClearHistory();
      setHistory([]);
    } catch (err) {
      console.error("Failed to clear history:", err);
    }
  };

  const handleExportAnki = async () => {
    const targetItems = filterFavorite ? history.filter((i) => i.isFavorite) : history;
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
    } catch (err) {
      console.error("Export failed:", err);
    }
  };

  const filteredItems = history.filter((item) => {
    if (filterFavorite && !item.isFavorite) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return item.original.toLowerCase().includes(q) || item.translated.toLowerCase().includes(q);
    }
    return true;
  });

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
    <div className="space-y-5 max-w-4xl mx-auto">
      {/* 统计卡横排 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {[
          { icon: Library, label: "总记录", value: history.length, color: "var(--accent-text)" },
          { icon: Star, label: "收藏生词", value: favoriteCount, color: "var(--warn)" },
          { icon: Camera, label: "截图场次", value: sessions.length, color: "var(--accent-text)" },
          { icon: GraduationCap, label: "待复习", value: dueCount, color: dueCount > 0 ? "var(--danger)" : "var(--ok)" },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="lg-panel flex items-center gap-3 p-3">
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

      {/* Header and Controls */}
      <div className="lg-panel p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <BookMarked className="h-6 w-6" style={{ color: "var(--accent-text)" }} />
          <div>
            <h2 className="text-lg font-bold">生词本与历史记录</h2>
            <p className="text-xs" style={{ color: "var(--g-text-2)" }}>
              已保存 {history.length} 条查询记录 (收藏 {favoriteCount} 条)
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2.5 flex-wrap">
          <button
            onClick={startReview}
            disabled={dueCount === 0}
            className="lg-btn lg-btn-primary disabled:cursor-not-allowed"
            title={
              favoriteCount === 0
                ? "先在列表里点亮 ⭐ 收藏生词，才会进入复习队列"
                : dueCount > 0
                  ? `开始复习 ${Math.min(dueCount, MAX_REVIEW_QUEUE)} 个到期生词`
                  : "当前没有到期生词"
            }
          >
            <GraduationCap className="h-4 w-4" />
            <span>开始复习{dueCount > 0 ? ` (${Math.min(dueCount, MAX_REVIEW_QUEUE)})` : ""}</span>
          </button>

          <button
            onClick={() => setFilterFavorite((prev) => !prev)}
            className={`lg-btn ${filterFavorite ? "" : "lg-btn-ghost"}`}
            style={filterFavorite ? { background: "color-mix(in srgb, var(--warn) 18%, transparent)", borderColor: "color-mix(in srgb, var(--warn) 45%, transparent)", color: "var(--warn)" } : undefined}
          >
            <Star className={`h-4 w-4 ${filterFavorite ? "fill-current" : ""}`} />
            <span>仅看生词本</span>
          </button>

          <button
            onClick={handleClearAll}
            disabled={history.length === 0}
            className="lg-btn lg-btn-ghost"
            title="清空全部历史与生词本记录"
          >
            <Trash className="h-4 w-4" />
            <span>清空全部</span>
          </button>

          <button onClick={handleExportAnki} className="lg-btn lg-btn-primary">
            <Download className="h-4 w-4" />
            <span>导出 Anki / CSV</span>
          </button>
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

      {/* Filter Search Bar */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "var(--g-text-3)" }} />
        <input
          type="text"
          placeholder="搜索生词本或历史记录..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="lg-input w-full !rounded-xl pl-10 pr-4 py-2.5 text-xs shadow-sm"
        />
      </div>

      {/* History Items List */}
      <div className="space-y-3">
        {filteredItems.length === 0 ? (
          <div className="lg-panel text-center py-14 space-y-3" style={{ color: "var(--g-text-3)" }}>
            <Inbox className="h-10 w-10 mx-auto opacity-60" />
            <p className="text-xs">
              {history.length === 0 ? "暂无任何记录，去「翻译」或「查词」页进行首次翻译吧" : "暂无匹配的记录或生词"}
            </p>
          </div>
        ) : (
          <>
            {filteredItems.slice(0, visibleCount).map((item) => {
              const box = reviewProgress[item.id]?.box;
              return (
                <div key={item.id} className="lg-inset p-4 flex items-center justify-between transition hover:bg-[var(--g-surface-2)]">
                  <div className="space-y-1 flex-1 pr-4 min-w-0">
                    <div className="flex items-center space-x-3 flex-wrap">
                      <span className="font-semibold text-base truncate">{item.original}</span>
                      <button
                        onClick={() => handleSpeech(item.original)}
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
                      onClick={() => handleToggleFav(item.id)}
                      className="lg-btn lg-btn-ghost !p-2"
                      style={item.isFavorite ? { color: "var(--warn)", background: "color-mix(in srgb, var(--warn) 14%, transparent)" } : undefined}
                      title={item.isFavorite ? "从生词本移除" : "加入生词本"}
                    >
                      <Star className={`h-4 w-4 ${item.isFavorite ? "fill-current" : ""}`} />
                    </button>

                    <button
                      onClick={() => handleDelete(item.id)}
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

      {/* ── 剪贴板翻译历史 ─────────────────────────────────────────────────── */}
      <div className="lg-panel p-5" data-testid="clipboard-history-section">
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
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1 scrollbar-thin">
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

      {/* ── 划词回放：整场截图翻译会话时间线 ───────────────────────────────── */}
      <div className="lg-panel p-5">
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
              {/* 原位卡片微缩重演 */}
              {(() => {
                const xs = replay.blocks.map((b) => b.logicalX);
                const ys = replay.blocks.map((b) => b.logicalY);
                const minX = Math.min(...xs, 0);
                const minY = Math.min(...ys, 0);
                const maxX = Math.max(...replay.blocks.map((b) => b.logicalX + b.logicalW));
                const maxY = Math.max(...replay.blocks.map((b) => b.logicalY + b.logicalH));
                const contentW = Math.max(maxX - minX, 1);
                const contentH = Math.max(maxY - minY, 1);
                const scale = Math.min(1, 640 / contentW, 340 / contentH);
                return (
                  <div
                    className="lg-inset relative mx-auto !rounded-xl overflow-hidden"
                    style={{ width: Math.max(contentW * scale, 120), height: Math.max(contentH * scale, 60) }}
                  >
                    {replay.blocks.map((b, i) => (
                      <div
                        key={i}
                        className="absolute flex items-center justify-center rounded-[3px] overflow-hidden whitespace-nowrap text-ellipsis"
                        style={{
                          left: (b.logicalX - minX) * scale,
                          top: (b.logicalY - minY) * scale,
                          width: Math.max(b.logicalW * scale, 16),
                          height: Math.max(b.logicalH * scale, 10),
                          background: b.bgCss,
                          color: b.fgCss,
                          fontSize: Math.max(8, Math.min(14, b.logicalH * scale * 0.7)),
                          fontWeight: 600,
                          padding: '0 3px',
                          boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                        }}
                        title={`${b.original} → ${b.translated}`}
                      >
                        <span className="truncate">{b.translated || b.original}</span>
                      </div>
                    ))}
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
    </div>
  );
};
