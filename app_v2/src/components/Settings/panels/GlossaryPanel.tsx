import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  BookOpen,
  Sparkles,
  Upload,
  Download,
  Plus,
  Search,
  Trash2,
  Edit3,
  Check,
  X,
  FileSpreadsheet,
  FileText,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  HelpCircle,
  GraduationCap,
  Layers,
  ArrowUpDown,
  Filter,
} from 'lucide-react';
import {
  cmdGetCustomGlossary,
  cmdImportCustomGlossary,
  cmdParseGlossaryText,
  cmdUpsertCustomGlossaryEntry,
  cmdDeleteCustomGlossaryEntry,
  cmdClearCustomGlossary,
  cmdExportCustomGlossary,
  cmdAnkiCheckConnection,
} from '../../../services/tauri';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import { useAppTheme } from '../../../hooks/useAppTheme';
import type { UserGlossaryEntry, GlossaryImportSummary, AnkiCheckResult } from '../../../services/types';

export const GlossaryPanel: React.FC = () => {
  const { isLight } = useAppTheme();
  const { settings, setAnkiSettings } = useSettingsStore();

  const [entries, setEntries] = useState<UserGlossaryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [visibleCount, setVisibleCount] = useState(50);

  // 导入状态与设置
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [isDragging, setIsDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<GlossaryImportSummary | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [showFormatGuide, setShowFormatGuide] = useState(false);

  // 单条编辑/新增模态框
  const [editEntry, setEditEntry] = useState<Partial<UserGlossaryEntry> | null>(null);
  const [isSavingEntry, setIsSavingEntry] = useState(false);

  // 清空确认弹窗
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Anki 设置联动状态
  const [ankiEndpoint, setAnkiEndpoint] = useState(
    settings.ankiSettings?.endpoint || 'http://127.0.0.1:8765'
  );
  const [ankiDeck, setAnkiDeck] = useState(
    settings.ankiSettings?.deckName || 'Catwalk Vocabulary'
  );
  const [ankiAutoStar, setAnkiAutoStar] = useState(
    settings.ankiSettings?.autoSyncOnStar || false
  );
  const [ankiStatus, setAnkiStatus] = useState<AnkiCheckResult | null>(null);
  const [checkingAnki, setCheckingAnki] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 加载术语库
  const loadGlossary = async () => {
    setLoading(true);
    try {
      const list = await cmdGetCustomGlossary();
      setEntries(list || []);
    } catch (err) {
      console.error('Failed to load custom glossary:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGlossary();
  }, []);

  // 提取所有分类供筛选
  const categories = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => {
      if (e.category && e.category.trim()) {
        set.add(e.category.trim());
      }
    });
    return Array.from(set);
  }, [entries]);

  // 过滤后的列表
  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      if (selectedCategory !== 'all' && e.category !== selectedCategory) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        e.source.toLowerCase().includes(q) ||
        e.target.toLowerCase().includes(q) ||
        (e.category && e.category.toLowerCase().includes(q)) ||
        (e.note && e.note.toLowerCase().includes(q))
      );
    });
  }, [entries, selectedCategory, searchQuery]);

  // 处理文件拖拽解析并导入
  const processFile = async (file: File) => {
    setIsImporting(true);
    setImportSummary(null);
    setImportError(null);

    const ext = file.name.split('.').pop()?.toLowerCase() || '';

    try {
      if (ext === 'xlsx' || ext === 'xls') {
        // Excel 格式：在前端使用 xlsx 解析为结构化条目
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) {
          throw new Error('Excel 文件中没有找到工作表');
        }
        const sheet = workbook.Sheets[firstSheetName];
        const rawData: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        if (!rawData || rawData.length === 0) {
          throw new Error('Excel 表格为空');
        }

        // 智能探查表头位置与列映射
        let sourceCol = 0;
        let targetCol = 1;
        let categoryCol = -1;
        let noteCol = -1;
        let startRow = 0;

        const headerRow = rawData[0];
        if (headerRow && Array.isArray(headerRow)) {
          headerRow.forEach((cell, idx) => {
            const str = String(cell || '').trim().toLowerCase();
            if (['source', '原词', '英文', '源语言', 'term', 'key'].includes(str)) {
              sourceCol = idx;
              startRow = 1;
            } else if (['target', '译文', '中文', '目标语言', 'translation', 'value'].includes(str)) {
              targetCol = idx;
              startRow = 1;
            } else if (['category', '分类', '类别', 'tag', '标签'].includes(str)) {
              categoryCol = idx;
              startRow = 1;
            } else if (['note', '备注', '说明', 'context', '释义'].includes(str)) {
              noteCol = idx;
              startRow = 1;
            }
          });
        }

        const parsedEntries: UserGlossaryEntry[] = [];
        const now = Date.now();
        for (let i = startRow; i < rawData.length; i++) {
          const row = rawData[i];
          if (!row || !Array.isArray(row)) continue;
          const src = String(row[sourceCol] || '').trim();
          const tgt = String(row[targetCol] || '').trim();
          if (!src || !tgt) continue;

          const cat = categoryCol >= 0 ? String(row[categoryCol] || '').trim() : '通用';
          const note = noteCol >= 0 ? String(row[noteCol] || '').trim() : undefined;

          parsedEntries.push({
            id: `entry_${now}_${i}`,
            source: src,
            target: tgt,
            category: cat || '通用',
            note: note || undefined,
            createdAt: now,
          });
        }

        if (parsedEntries.length === 0) {
          throw new Error('未能从 Excel 中识别出有效的原词和译文列');
        }

        const summary = await cmdImportCustomGlossary(parsedEntries, importMode);
        setImportSummary(summary);
      } else if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
        const text = await file.text();
        const parsed = await cmdParseGlossaryText(text, ext === 'txt' ? 'txt' : 'csv');
        if (parsed.length === 0) {
          throw new Error('未能从文件中识别出有效的术语条目');
        }
        const summary = await cmdImportCustomGlossary(parsed, importMode);
        setImportSummary(summary);
      } else {
        throw new Error('不支持的文件格式，请导入 .xlsx, .csv, .tsv 或 .txt 文件');
      }

      // 刷新列表
      await loadGlossary();
    } catch (err: any) {
      console.error('Import error:', err);
      setImportError(err?.message || '导入文件时发生错误');
    } finally {
      setIsImporting(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
      e.target.value = '';
    }
  };

  // 保存单个条目（新增或修改）
  const handleSaveEntry = async () => {
    if (!editEntry || !editEntry.source?.trim() || !editEntry.target?.trim()) return;
    setIsSavingEntry(true);
    try {
      const entry: UserGlossaryEntry = {
        id: editEntry.id || `entry_${Date.now()}`,
        source: editEntry.source.trim(),
        target: editEntry.target.trim(),
        category: editEntry.category?.trim() || '通用',
        note: editEntry.note?.trim() || undefined,
        createdAt: editEntry.createdAt || Date.now(),
      };
      await cmdUpsertCustomGlossaryEntry(entry);
      setEditEntry(null);
      await loadGlossary();
    } catch (err) {
      console.error('Save entry failed:', err);
    } finally {
      setIsSavingEntry(false);
    }
  };

  // 删除单个条目
  const handleDeleteEntry = async (id: string) => {
    try {
      await cmdDeleteCustomGlossaryEntry(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      console.error('Delete entry failed:', err);
    }
  };

  // 清空全部
  const handleClearAll = async () => {
    try {
      await cmdClearCustomGlossary();
      setEntries([]);
      setShowClearConfirm(false);
    } catch (err) {
      console.error('Clear glossary failed:', err);
    }
  };

  // 导出
  const handleExport = async (format: 'csv' | 'json') => {
    try {
      const content = format === 'json' ? JSON.stringify(entries, null, 2) : await cmdExportCustomGlossary();
      const mime = format === 'json' ? 'application/json' : 'text/csv;charset=utf-8;';
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `catwalk_glossary_${Date.now()}.${format}`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  // 下载示例 CSV 模板
  const handleDownloadSampleCsv = () => {
    const sample = `source,target,category,note\nPrincipled BSDF,原理化 BSDF,Blender,通用物理着色器核心节点\nRoughness,粗糙度,CG/3D,微表面粗糙程度参数\nCurvature,曲率图,Substance,贴图烘焙曲率信息\nNavMesh Surface,NavMesh 表面,Unity,寻路网格计算组件\n`;
    const blob = new Blob([sample], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'catwalk_glossary_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // 测试 Anki 连接
  const testAnkiConnection = async () => {
    setCheckingAnki(true);
    try {
      const res = await cmdAnkiCheckConnection(ankiEndpoint);
      setAnkiStatus(res);
    } catch (err: any) {
      setAnkiStatus({
        connected: false,
        version: 0,
        decks: [],
        models: [],
        message: err?.message || '连接失败',
      });
    } finally {
      setCheckingAnki(false);
    }
  };

  const handleSaveAnkiConfig = () => {
    setAnkiSettings({
      endpoint: ankiEndpoint,
      deckName: ankiDeck,
      autoSyncOnStar: ankiAutoStar,
    });
  };

  return (
    <div className="space-y-6">
      {/* 1. 头部介绍与术语库能力说明 */}
      <div
        className={`p-5 rounded-2xl border transition-colors ${
          isLight
            ? 'bg-white/70 backdrop-blur-md border-slate-200/80 shadow-sm text-slate-800'
            : 'bg-zinc-900/50 border-white/[0.08] text-zinc-100'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-4 border-slate-200 dark:border-white/10">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-blue-500/15 text-blue-500 shrink-0">
              <BookOpen className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold">📚 专业术语库与团队词表</h2>
                <span
                  className={`text-[11px] font-mono px-2 py-0.5 rounded-full font-bold border ${
                    isLight
                      ? 'bg-blue-100 text-blue-800 border-blue-200'
                      : 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                  }`}
                >
                  {entries.length} 条已生效
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1 leading-relaxed">
                万能格式导入与智能大模型注入引擎。单词查词时享{' '}
                <span className="font-semibold text-blue-500">Tier 0.5 优先命中</span>
                ；长句/划词翻译时自动扫描并提取文中出现的专属术语，动态注入 System Prompt 强制 AI
                遵循统一译法。
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setEditEntry({ source: '', target: '', category: '通用' })}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-sm transition cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>新建词条</span>
            </button>

            <button
              type="button"
              onClick={() => setShowFormatGuide(!showFormatGuide)}
              className={`flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                isLight
                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-white/15'
              }`}
              title="查看支持的文件格式与导入规范"
            >
              <HelpCircle className="h-3.5 w-3.5 text-blue-500" />
              <span>格式指引</span>
            </button>
          </div>
        </div>

        {/* 格式参考与模板卡片 */}
        {showFormatGuide && (
          <div
            className={`mt-4 p-4 rounded-xl border text-xs space-y-3 animate-in fade-in duration-150 ${
              isLight ? 'bg-blue-50/50 border-blue-200 text-slate-700' : 'bg-blue-950/20 border-blue-800/40 text-zinc-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
                <Sparkles className="h-4 w-4" />
                <span>支持的导入文件格式与模板示例</span>
              </span>
              <button
                type="button"
                onClick={handleDownloadSampleCsv}
                className="flex items-center space-x-1 text-[11px] font-semibold text-blue-600 hover:underline cursor-pointer"
              >
                <Download className="h-3 w-3" />
                <span>下载标准 CSV 模板</span>
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-[11px]">
              <div className="p-2.5 rounded-lg border bg-white/60 dark:bg-black/30 border-blue-300/30 space-y-1">
                <div className="font-semibold text-blue-500">1. Excel (.xlsx / .xls)</div>
                <div className="text-slate-500 dark:text-zinc-400">
                  支持第一行为表头（如: 原词 / 译文 / 分类 / 备注），或前两列直接填写原词与译文。
                </div>
              </div>
              <div className="p-2.5 rounded-lg border bg-white/60 dark:bg-black/30 border-blue-300/30 space-y-1">
                <div className="font-semibold text-emerald-500">2. CSV / TSV 文件</div>
                <div className="text-slate-500 dark:text-zinc-400">
                  标准逗号或制表符分隔文件。支持 UTF-8 编码，轻松从各类词典软件一键导出迁移。
                </div>
              </div>
              <div className="p-2.5 rounded-lg border bg-white/60 dark:bg-black/30 border-blue-300/30 space-y-1">
                <div className="font-semibold text-amber-500">3. 纯文本 (.txt)</div>
                <div className="text-slate-500 dark:text-zinc-400">
                  支持每行一个术语对，如: <code className="font-mono">Roughness = 粗糙度</code> 或{' '}
                  <code className="font-mono">IOR -&gt; 折射率</code>。
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 2. 万能拖拽导入区 */}
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-700 dark:text-zinc-300 flex items-center gap-1.5">
              <Upload className="h-3.5 w-3.5 text-blue-500" />
              <span>拖拽导入术语表</span>
            </span>

            <div className="flex items-center space-x-2">
              <span className="text-slate-500 dark:text-zinc-400">导入策略:</span>
              <div className="inline-flex rounded-lg border border-slate-300 dark:border-white/15 p-0.5 text-[11px] bg-slate-100 dark:bg-zinc-800">
                <button
                  type="button"
                  onClick={() => setImportMode('merge')}
                  className={`px-2.5 py-0.5 rounded-md font-medium transition cursor-pointer ${
                    importMode === 'merge'
                      ? 'bg-white dark:bg-zinc-700 text-blue-600 dark:text-blue-400 shadow-xs font-bold'
                      : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900'
                  }`}
                >
                  增量合并 (Merge)
                </button>
                <button
                  type="button"
                  onClick={() => setImportMode('replace')}
                  className={`px-2.5 py-0.5 rounded-md font-medium transition cursor-pointer ${
                    importMode === 'replace'
                      ? 'bg-white dark:bg-zinc-700 text-rose-600 dark:text-rose-400 shadow-xs font-bold'
                      : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900'
                  }`}
                  title="清空当前所有词条，完全替换为新导入内容"
                >
                  完全替换 (Replace)
                </button>
              </div>
            </div>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-6 text-center transition cursor-pointer select-none ${
              isDragging
                ? 'border-blue-500 bg-blue-500/10'
                : isLight
                ? 'border-slate-300 hover:border-blue-500/60 bg-slate-50/70 hover:bg-slate-50'
                : 'border-white/15 hover:border-blue-500/50 bg-zinc-800/30 hover:bg-zinc-800/50'
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".xlsx,.xls,.csv,.tsv,.txt"
              className="hidden"
            />
            <div className="flex flex-col items-center justify-center space-y-2">
              <div className="p-3 rounded-full bg-blue-500/15 text-blue-500">
                {isImporting ? (
                  <RefreshCw className="h-6 w-6 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-6 w-6" />
                )}
              </div>
              <div className="space-y-0.5">
                <p className="text-xs font-bold text-slate-700 dark:text-zinc-200">
                  {isImporting
                    ? '正在解析并导入术语数据...'
                    : '拖拽 Excel (.xlsx) 或 CSV / TSV / TXT 文件至此处，或点击浏览'}
                </p>
                <p className="text-[11px] text-slate-400 dark:text-zinc-500">
                  支持 .xlsx, .xls, .csv, .tsv, .txt · 秒级解析十万级术语库
                </p>
              </div>
            </div>
          </div>

          {/* 导入结果反馈提示 */}
          {importSummary && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs flex items-center justify-between animate-in fade-in duration-150">
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>
                  🎉 导入成功！共解析 {importSummary.totalParsed} 条，新增 {importSummary.added}{' '}
                  条，更新 {importSummary.updated} 条，当前词库总计 {importSummary.totalAfter} 条。
                </span>
              </div>
              <button
                type="button"
                onClick={() => setImportSummary(null)}
                className="p-1 hover:bg-emerald-500/20 rounded cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {importError && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 text-xs flex items-center justify-between animate-in fade-in duration-150">
              <div className="flex items-center space-x-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{importError}</span>
              </div>
              <button
                type="button"
                onClick={() => setImportError(null)}
                className="p-1 hover:bg-rose-500/20 rounded cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 3. 词库浏览与管理操作栏 */}
      <div
        className={`p-5 rounded-2xl border transition-colors space-y-4 ${
          isLight
            ? 'bg-white/70 backdrop-blur-md border-slate-200/80 shadow-sm text-slate-800'
            : 'bg-zinc-900/50 border-white/[0.08] text-zinc-100'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* 搜索与分类 */}
          <div className="flex items-center gap-2.5 flex-1 max-w-lg">
            <div className="relative flex-1">
              <Search
                className={`absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 ${
                  isLight ? 'text-slate-400' : 'text-zinc-500'
                }`}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索原词、译文、分类或备注..."
                className={`w-full pl-9 pr-3 py-1.5 rounded-xl text-xs border outline-none transition ${
                  isLight
                    ? 'bg-slate-50 border-slate-300 text-slate-800 focus:border-blue-500'
                    : 'bg-zinc-800/60 border-white/10 text-zinc-100 focus:border-blue-500'
                }`}
              />
            </div>

            {/* 分类筛选器 */}
            {categories.length > 0 && (
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className={`px-3 py-1.5 rounded-xl text-xs border outline-none font-medium cursor-pointer ${
                  isLight
                    ? 'bg-slate-50 border-slate-300 text-slate-700'
                    : 'bg-zinc-800/60 border-white/10 text-zinc-200'
                }`}
              >
                <option value="all">所有分类 ({entries.length})</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* 批量与导出按钮 */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleExport('csv')}
              disabled={entries.length === 0}
              className={`flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer disabled:opacity-40 ${
                isLight
                  ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-white/15'
              }`}
              title="导出当前术语库为 CSV"
            >
              <Download className="h-3.5 w-3.5 text-blue-500" />
              <span>导出 CSV</span>
            </button>

            <button
              type="button"
              onClick={() => handleExport('json')}
              disabled={entries.length === 0}
              className={`flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer disabled:opacity-40 ${
                isLight
                  ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-white/15'
              }`}
              title="导出当前术语库为 JSON"
            >
              <Download className="h-3.5 w-3.5 text-emerald-500" />
              <span>导出 JSON</span>
            </button>

            {entries.length > 0 && (
              <button
                type="button"
                onClick={() => setShowClearConfirm(true)}
                className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-rose-500 hover:bg-rose-500/10 border border-rose-500/30 transition cursor-pointer"
                title="清空全部自定义术语库"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>清空</span>
              </button>
            )}
          </div>
        </div>

        {/* 词条列表表格 */}
        <div className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr
                  className={`border-b font-semibold ${
                    isLight
                      ? 'bg-slate-100/80 border-slate-200 text-slate-700'
                      : 'bg-zinc-800/80 border-white/10 text-zinc-300'
                  }`}
                >
                  <th className="py-2.5 px-4 w-1/3">原词 (Source)</th>
                  <th className="py-2.5 px-4 w-1/3">译文 (Target)</th>
                  <th className="py-2.5 px-4 w-28">分类</th>
                  <th className="py-2.5 px-4">备注</th>
                  <th className="py-2.5 px-4 w-20 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-white/5">
                {filteredEntries.slice(0, visibleCount).map((entry) => (
                  <tr
                    key={entry.id}
                    className={`transition-colors ${
                      isLight ? 'hover:bg-slate-50' : 'hover:bg-white/[0.02]'
                    }`}
                  >
                    <td className="py-2.5 px-4 font-bold text-blue-600 dark:text-blue-400 select-text">
                      {entry.source}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-slate-800 dark:text-zinc-200 select-text">
                      {entry.target}
                    </td>
                    <td className="py-2.5 px-4">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-mono font-medium ${
                          isLight
                            ? 'bg-slate-200/80 text-slate-700'
                            : 'bg-zinc-800 text-zinc-300'
                        }`}
                      >
                        {entry.category || '通用'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-400 dark:text-zinc-500 text-[11px] truncate max-w-xs">
                      {entry.note || '-'}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="flex items-center justify-end space-x-1.5">
                        <button
                          type="button"
                          onClick={() => setEditEntry({ ...entry })}
                          className="p-1 rounded hover:bg-blue-500/10 text-blue-500 cursor-pointer"
                          title="编辑词条"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteEntry(entry.id)}
                          className="p-1 rounded hover:bg-rose-500/10 text-rose-500 cursor-pointer"
                          title="删除词条"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 空状态提示 */}
          {filteredEntries.length === 0 && (
            <div className="py-12 text-center text-slate-400 dark:text-zinc-500 space-y-2">
              <BookOpen className="h-8 w-8 mx-auto opacity-30" />
              <p className="text-xs">
                {searchQuery || selectedCategory !== 'all'
                  ? '未搜索到匹配的术语词条'
                  : '暂无自定义术语条目，可通过上方拖拽导入或点击新建'}
              </p>
            </div>
          )}

          {/* 加载更多按钮 */}
          {filteredEntries.length > visibleCount && (
            <div className="p-3 text-center border-t border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-zinc-900/30">
              <button
                type="button"
                onClick={() => setVisibleCount((prev) => prev + 50)}
                className="text-xs text-blue-500 hover:underline font-semibold cursor-pointer"
              >
                加载更多词条 (已展示 {visibleCount} / 共 {filteredEntries.length} 条)
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 4. AnkiConnect 本地同步联动卡片 */}
      <div
        className={`p-5 rounded-2xl border transition-colors space-y-4 ${
          isLight
            ? 'bg-white/70 backdrop-blur-md border-slate-200/80 shadow-sm text-slate-800'
            : 'bg-zinc-900/50 border-white/[0.08] text-zinc-100'
        }`}
      >
        <div className="flex items-center justify-between border-b pb-3 border-slate-200 dark:border-white/10">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-purple-500/15 text-purple-500">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold flex items-center gap-1.5">
                <span>AnkiConnect 本地联动设置</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-400 font-mono">
                  插件 2055492159
                </span>
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                配置生词本直连同步端口与收藏自动推流策略
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={testAnkiConnection}
              disabled={checkingAnki}
              className={`flex items-center space-x-1 px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                isLight
                  ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-white/15'
              }`}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${checkingAnki ? 'animate-spin' : ''}`} />
              <span>测试连接</span>
            </button>

            <button
              type="button"
              onClick={handleSaveAnkiConfig}
              className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-sm transition cursor-pointer"
            >
              保存 Anki 配置
            </button>
          </div>
        </div>

        {ankiStatus && (
          <div
            className={`p-3 rounded-xl border text-xs flex items-center space-x-2 ${
              ankiStatus.connected
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-500'
            }`}
          >
            {ankiStatus.connected ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            <span>
              {ankiStatus.connected
                ? `连接成功！AnkiConnect 版本: v${ankiStatus.version}，已发现 ${ankiStatus.decks.length} 个本地牌组`
                : `连接失败: ${ankiStatus.message || '请确认本地已启动 Anki 并安装 AnkiConnect 插件'}`}
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="space-y-1.5">
            <label className="font-semibold text-slate-700 dark:text-zinc-300">
              AnkiConnect 服务地址
            </label>
            <input
              type="text"
              value={ankiEndpoint}
              onChange={(e) => setAnkiEndpoint(e.target.value)}
              placeholder="http://127.0.0.1:8765"
              className={`w-full px-3 py-2 rounded-xl border text-xs outline-none font-mono ${
                isLight
                  ? 'bg-slate-50 border-slate-300 text-slate-800'
                  : 'bg-zinc-800/60 border-white/10 text-zinc-100'
              }`}
            />
          </div>

          <div className="space-y-1.5">
            <label className="font-semibold text-slate-700 dark:text-zinc-300">
              默认生词同步牌组 (Deck Name)
            </label>
            <input
              type="text"
              value={ankiDeck}
              onChange={(e) => setAnkiDeck(e.target.value)}
              placeholder="例如: Catwalk Vocabulary"
              className={`w-full px-3 py-2 rounded-xl border text-xs outline-none ${
                isLight
                  ? 'bg-slate-50 border-slate-300 text-slate-800'
                  : 'bg-zinc-800/60 border-white/10 text-zinc-100'
              }`}
            />
          </div>
        </div>

        <div className="pt-2 flex items-center justify-between border-t border-slate-200 dark:border-white/10">
          <div>
            <div className="text-xs font-semibold text-slate-800 dark:text-zinc-200">
              ⭐ 点亮收藏生词时自动同步
            </div>
            <div className="text-[11px] text-slate-500 dark:text-zinc-400">
              开启后，在主界面或划词卡片中点击 ⭐ 收藏生词将直接自动添加至 Anki
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={ankiAutoStar}
            onClick={() => setAnkiAutoStar(!ankiAutoStar)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${
              ankiAutoStar ? 'bg-blue-600' : isLight ? 'bg-slate-300' : 'bg-zinc-700'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform mt-0.5 ${
                ankiAutoStar ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      {/* 新增/编辑词条弹窗 */}
      {editEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className={`w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden flex flex-col ${
              isLight
                ? 'bg-white text-slate-800 border-slate-200'
                : 'bg-zinc-900 text-zinc-100 border-white/10'
            }`}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10 shrink-0">
              <h3 className="text-sm font-bold flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-blue-500" />
                <span>{editEntry.id ? '编辑术语词条' : '新建专业术语'}</span>
              </h3>
              <button
                type="button"
                onClick={() => setEditEntry(null)}
                className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-slate-700 dark:text-zinc-300">
                  原词 (Source Term) *
                </label>
                <input
                  type="text"
                  value={editEntry.source || ''}
                  onChange={(e) => setEditEntry({ ...editEntry, source: e.target.value })}
                  placeholder="例如: Principled BSDF"
                  className={`w-full px-3 py-2 rounded-xl border text-xs outline-none ${
                    isLight
                      ? 'bg-slate-50 border-slate-300 text-slate-800 focus:border-blue-500'
                      : 'bg-zinc-800/80 border-white/10 text-zinc-100 focus:border-blue-500'
                  }`}
                  autoFocus
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700 dark:text-zinc-300">
                  译文 (Target Translation) *
                </label>
                <input
                  type="text"
                  value={editEntry.target || ''}
                  onChange={(e) => setEditEntry({ ...editEntry, target: e.target.value })}
                  placeholder="例如: 原理化 BSDF"
                  className={`w-full px-3 py-2 rounded-xl border text-xs outline-none ${
                    isLight
                      ? 'bg-slate-50 border-slate-300 text-slate-800 focus:border-blue-500'
                      : 'bg-zinc-800/80 border-white/10 text-zinc-100 focus:border-blue-500'
                  }`}
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700 dark:text-zinc-300">
                  分类标签 (Category)
                </label>
                <input
                  type="text"
                  value={editEntry.category || ''}
                  onChange={(e) => setEditEntry({ ...editEntry, category: e.target.value })}
                  placeholder="例如: Blender, CG/3D, 游戏开发"
                  className={`w-full px-3 py-2 rounded-xl border text-xs outline-none ${
                    isLight
                      ? 'bg-slate-50 border-slate-300 text-slate-800'
                      : 'bg-zinc-800/80 border-white/10 text-zinc-100'
                  }`}
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700 dark:text-zinc-300">
                  备注或上下文 (Note, 可选)
                </label>
                <textarea
                  rows={2}
                  value={editEntry.note || ''}
                  onChange={(e) => setEditEntry({ ...editEntry, note: e.target.value })}
                  placeholder="可选的解释、使用场景或英文缩写全称..."
                  className={`w-full px-3 py-2 rounded-xl border text-xs outline-none resize-none ${
                    isLight
                      ? 'bg-slate-50 border-slate-300 text-slate-800'
                      : 'bg-zinc-800/80 border-white/10 text-zinc-100'
                  }`}
                />
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-200 dark:border-white/10 flex items-center justify-end space-x-2 bg-slate-50/50 dark:bg-zinc-900/50">
              <button
                type="button"
                onClick={() => setEditEntry(null)}
                className="px-3.5 py-1.5 rounded-xl border border-slate-300 dark:border-white/15 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveEntry}
                disabled={!editEntry.source?.trim() || !editEntry.target?.trim() || isSavingEntry}
                className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md transition cursor-pointer disabled:opacity-40"
              >
                {isSavingEntry ? '保存中...' : '保存词条'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 清空全部确认弹窗 */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className={`w-full max-w-sm rounded-2xl border shadow-2xl p-5 space-y-4 ${
              isLight ? 'bg-white text-slate-800 border-slate-200' : 'bg-zinc-900 text-zinc-100 border-white/10'
            }`}
          >
            <div className="flex items-center space-x-2.5 text-rose-500 font-bold text-sm">
              <AlertCircle className="h-5 w-5" />
              <span>清空全部术语库</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed">
              确定要清空全部 {entries.length} 条专业术语词库吗？此操作不可撤销，建议在清空前先导出备份。
            </p>
            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-white/15 text-xs font-semibold cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleClearAll}
                className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-md cursor-pointer"
              >
                确认彻底清空
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
