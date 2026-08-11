import React, { useEffect, useState } from "react";
import { Star, Download, Search, BookMarked, Clock, Volume2, Trash2, Trash, Inbox } from "lucide-react";
import { cmdGetHistory, cmdToggleFavorite, cmdExportAnki, cmdDeleteHistoryEntry, cmdClearHistory } from "../../services/tauri";
import { useSettingsStore } from "../../stores/useSettingsStore";
import type { HistoryItem } from "../../services/types";

export const HistoryPanel: React.FC = () => {
  const { settings } = useSettingsStore();
  const activeTheme = settings.appearance?.theme || 'fluent-dark';
  const isSystemLight = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches;
  const isLight = activeTheme === 'light' || (activeTheme === 'system' && isSystemLight);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [filterFavorite, setFilterFavorite] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

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
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    window.speechSynthesis.speak(utterance);
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

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header and Controls */}
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl border transition-all ${
        isLight
          ? "bg-white border-slate-200 shadow-sm text-slate-800"
          : "bg-white/[0.04] border-white/10 text-zinc-100 shadow-lg backdrop-blur-xl"
      }`}>
        <div className="flex items-center space-x-3">
          <BookMarked className="h-6 w-6 text-blue-500" />
          <div>
            <h2 className={`text-lg font-bold ${isLight ? "text-slate-900" : "text-white"}`}>生词本与历史记录</h2>
            <p className={`text-xs ${isLight ? "text-slate-500 font-medium" : "text-zinc-400"}`}>
              已保存 {history.length} 条查询记录 (收藏 {history.filter(i => i.isFavorite).length} 条)
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => setFilterFavorite((prev) => !prev)}
            className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-medium border transition cursor-pointer ${
              filterFavorite
                ? "bg-amber-500/20 border-amber-400/50 text-amber-500 font-bold"
                : (isLight
                    ? "bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200"
                    : "bg-zinc-800/80 border-white/[0.08] text-zinc-300 hover:bg-zinc-700")
            }`}
          >
            <Star className={`h-4 w-4 ${filterFavorite ? "fill-amber-400 text-amber-400" : ""}`} />
            <span>仅看生词本</span>
          </button>

          <button
            onClick={handleClearAll}
            disabled={history.length === 0}
            className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-medium border transition disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer ${
              isLight
                ? "bg-slate-100 border-slate-300 text-slate-500 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-300"
                : "bg-zinc-800/60 border-white/[0.08] text-zinc-400 hover:bg-rose-500/10 hover:text-rose-300 hover:border-rose-500/40"
            }`}
            title="清空全部历史与生词本记录"
          >
            <Trash className="h-4 w-4" />
            <span>清空全部</span>
          </button>

          <button
            onClick={handleExportAnki}
            className="flex items-center space-x-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-medium transition shadow-md cursor-pointer border border-blue-400/30 shrink-0"
          >
            <Download className="h-4 w-4" />
            <span>导出 Anki / CSV</span>
          </button>
        </div>
      </div>

      {/* Filter Search Bar */}
      <div className="relative">
        <Search className={`absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 ${isLight ? "text-slate-400" : "text-zinc-400"}`} />
        <input
          type="text"
          placeholder="搜索生词本或历史记录..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className={`w-full rounded-xl pl-10 pr-4 py-2.5 text-xs focus:outline-none border shadow-sm ${
            isLight
              ? "bg-white border-slate-300 text-slate-900 placeholder-slate-400 focus:border-blue-500"
              : "bg-zinc-950/80 border-white/10 text-zinc-100 placeholder-zinc-500 focus:border-blue-500/60"
          }`}
        />
      </div>

      {/* History Items List */}
      <div className="space-y-3">
        {filteredItems.length === 0 ? (
          <div className={`text-center py-14 rounded-2xl space-y-3 border ${
            isLight ? "bg-white border-slate-200 text-slate-500" : "bg-white/[0.04] border-white/10 text-zinc-400"
          }`}>
            <Inbox className={`h-10 w-10 mx-auto ${isLight ? "text-slate-400" : "text-zinc-500"}`} />
            <p className="text-xs">
              {history.length === 0 ? "暂无任何记录，去「翻译」或「查词」页进行首次翻译吧" : "暂无匹配的记录或生词"}
            </p>
          </div>
        ) : (
          filteredItems.map((item) => (
            <div
              key={item.id}
              className={`p-4 rounded-xl border flex items-center justify-between transition shadow-sm ${
                isLight
                  ? "bg-white border-slate-200 text-slate-800 hover:border-slate-300"
                  : "bg-white/[0.04] border-white/10 text-zinc-100 hover:border-white/20"
              }`}
            >
              <div className="space-y-1 flex-1 pr-4">
                <div className="flex items-center space-x-3">
                  <span className={`font-semibold text-base ${isLight ? "text-slate-900" : "text-white"}`}>{item.original}</span>
                  <button
                    onClick={() => handleSpeech(item.original)}
                    className={`transition ${isLight ? "text-slate-400 hover:text-blue-600" : "text-zinc-500 hover:text-blue-400"}`}
                  >
                    <Volume2 className="h-4 w-4" />
                  </button>
                  <span className={`text-[11px] px-2 py-0.5 rounded border ${
                    isLight ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-zinc-800/80 text-zinc-500 border-zinc-700/50"
                  }`}>
                    {item.sourceTier}
                  </span>
                </div>
                <p className={`text-sm font-medium ${isLight ? "text-emerald-600 font-bold" : "text-emerald-400"}`}>{item.translated}</p>
                <div className={`flex items-center space-x-2 text-[11px] ${isLight ? "text-slate-400" : "text-zinc-500"}`}>
                  <Clock className="h-3 w-3" />
                  <span>{item.timestamp}</span>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleToggleFav(item.id)}
                  className={`p-2 rounded-lg border transition ${
                    item.isFavorite
                      ? "bg-amber-500/20 border-amber-400/50 text-amber-500"
                      : (isLight ? "bg-slate-100 border-slate-300 text-slate-400 hover:text-slate-700" : "bg-zinc-800/60 border-zinc-700/60 text-zinc-500 hover:text-zinc-300")
                  }`}
                  title={item.isFavorite ? "从生词本移除" : "加入生词本"}
                >
                  <Star className={`h-4 w-4 ${item.isFavorite ? "fill-amber-400 text-amber-400" : ""}`} />
                </button>

                <button
                  onClick={() => handleDelete(item.id)}
                  className={`p-2 rounded-lg border transition ${
                    isLight
                      ? "bg-slate-100 border-slate-300 text-slate-400 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-300"
                      : "bg-zinc-800/60 border-zinc-700/60 text-zinc-500 hover:text-rose-300 hover:bg-rose-500/10 hover:border-rose-500/40"
                  }`}
                  title="删除该条记录"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
