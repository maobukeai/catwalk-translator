import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { AnkiSyncModal } from '../components/Vocabulary/AnkiSyncModal';
import { GlossaryPanel } from '../components/Settings/panels/GlossaryPanel';
import { createMockIpcHarness, getActiveHarness } from './harness/tauriIpcMock';
import type { HistoryItem, UserGlossaryEntry } from '../services/types';

const SAMPLE_HISTORY: HistoryItem[] = [
  {
    id: 'vocab-1',
    original: 'Subsurface Scattering',
    translated: '次表面散射',
    sourceTier: 'Blender',
    timestamp: '2026/09/05 10:00',
    isFavorite: true,
  },
  {
    id: 'vocab-2',
    original: 'Roughness',
    translated: '粗糙度',
    sourceTier: 'CG',
    timestamp: '2026/09/05 10:05',
    isFavorite: true,
  },
];

const SAMPLE_GLOSSARY: UserGlossaryEntry[] = [
  {
    id: 'g-1',
    source: 'Principled BSDF',
    target: '原理化 BSDF',
    category: 'Blender',
    note: '通用物理着色器核心节点',
    createdAt: 1725500000000,
  },
  {
    id: 'g-2',
    source: 'Normal Map',
    target: '法线贴图',
    category: 'CG/3D',
    note: '切线空间法线信息',
    createdAt: 1725500001000,
  },
];

describe('Anki Ecosystem and Universal Glossary Engine', () => {
  beforeAll(() => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    // mock URL.createObjectURL and revokeObjectURL
    window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    window.URL.revokeObjectURL = vi.fn();
    (window as any).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    (window as any).__TAURI_INTERNALS__ = {};
    window.localStorage.clear();
  });

  describe('AnkiSyncModal', () => {
    it('detects connection and executes live sync to AnkiConnect', async () => {
      createMockIpcHarness();
      let syncCalledWith: any = null;

      (getActiveHarness()!.invokeMock as any).mockImplementation(async (cmd: string, args?: any): Promise<any> => {
        if (cmd === 'cmd_anki_check_connection') {
          return {
            connected: true,
            version: 6,
            decks: ['Default', 'Catwalk Vocabulary', 'Japanese'],
            models: ['Basic', 'Cloze'],
            message: 'OK',
          };
        }
        if (cmd === 'cmd_anki_sync_notes') {
          syncCalledWith = args;
          return {
            total: args?.notes?.length || 0,
            added: 2,
            skipped: 0,
            errors: [],
          };
        }
        if (cmd === 'cmd_get_settings') {
          return {};
        }
        return null;
      });

      render(
        <AnkiSyncModal
          isOpen={true}
          onClose={vi.fn()}
          items={SAMPLE_HISTORY}
        />
      );

      // Verify connection detection
      expect(await screen.findByText(/AnkiConnect 已连接 \(API v6\)/)).toBeInTheDocument();
      expect(screen.getByText(/生词本中全部 2 个生词/)).toBeInTheDocument();

      // Click sync button
      const syncBtn = screen.getByRole('button', { name: /一键同步至 Anki \(2\)/ });
      fireEvent.click(syncBtn);

      // Verify sync result feedback
      expect(await screen.findByText(/🎉 同步成功！/)).toBeInTheDocument();
      expect(screen.getByText(/成功新增 2 张卡片/)).toBeInTheDocument();

      expect(syncCalledWith).not.toBeNull();
      expect(syncCalledWith.notes).toHaveLength(2);
      expect(syncCalledWith.notes[0].original).toBe('Subsurface Scattering');
      expect(syncCalledWith.notes[0].translated).toBe('次表面散射');
    });

    it('displays plugin guide and supports TSV export when Anki is disconnected', async () => {
      createMockIpcHarness();
      let exportCalled = false;

      (getActiveHarness()!.invokeMock as any).mockImplementation(async (cmd: string): Promise<any> => {
        if (cmd === 'cmd_anki_check_connection') {
          return {
            connected: false,
            version: 0,
            decks: [],
            models: [],
            message: 'Connection refused',
          };
        }
        if (cmd === 'cmd_anki_export_file') {
          exportCalled = true;
          return '#separator:tab\n#html:true\nSubsurface Scattering\t次表面散射\tCatwalk\n';
        }
        if (cmd === 'cmd_get_settings') {
          return {};
        }
        return null;
      });

      render(
        <AnkiSyncModal
          isOpen={true}
          onClose={vi.fn()}
          items={SAMPLE_HISTORY}
        />
      );

      // Guide and code should be visible
      expect(await screen.findByText(/未连接到 AnkiConnect/)).toBeInTheDocument();
      expect(screen.getByText('2055492159')).toBeInTheDocument();

      // Test TSV file export button
      const tsvBtn = screen.getByRole('button', { name: /导出 Anki 文件 \(\.tsv\)/ });
      fireEvent.click(tsvBtn);

      await waitFor(() => {
        expect(exportCalled).toBe(true);
      });
    });
  });

  describe('GlossaryPanel', () => {
    it('loads glossary list, filters by search, and adds a new entry', async () => {
      createMockIpcHarness();
      let glossaryStore = [...SAMPLE_GLOSSARY];
      let upsertCalledWith: any = null;

      (getActiveHarness()!.invokeMock as any).mockImplementation(async (cmd: string, args?: any): Promise<any> => {
        if (cmd === 'cmd_get_custom_glossary') {
          return [...glossaryStore];
        }
        if (cmd === 'cmd_upsert_custom_glossary_entry') {
          upsertCalledWith = args?.entry;
          glossaryStore.push(args?.entry);
          return null;
        }
        if (cmd === 'cmd_delete_custom_glossary_entry') {
          glossaryStore = glossaryStore.filter((e) => e.id !== args?.id);
          return true;
        }
        if (cmd === 'cmd_get_settings') {
          return {};
        }
        return null;
      });

      render(<GlossaryPanel />);

      // Verify loaded terms
      expect(await screen.findByText('Principled BSDF')).toBeInTheDocument();
      expect(screen.getByText('原理化 BSDF')).toBeInTheDocument();
      expect(screen.getByText('Normal Map')).toBeInTheDocument();

      // Search filtering
      const searchInput = screen.getByPlaceholderText(/搜索原词、译文、分类或备注/);
      fireEvent.change(searchInput, { target: { value: 'Normal' } });

      expect(screen.queryByText('Principled BSDF')).not.toBeInTheDocument();
      expect(screen.getByText('Normal Map')).toBeInTheDocument();

      // Clear search
      fireEvent.change(searchInput, { target: { value: '' } });
      expect(await screen.findByText('Principled BSDF')).toBeInTheDocument();

      // Click "新建词条" button
      const addBtn = screen.getByRole('button', { name: /新建词条/ });
      fireEvent.click(addBtn);

      // Fill in modal
      const srcInput = screen.getByPlaceholderText(/例如: Principled BSDF/);
      const tgtInput = screen.getByPlaceholderText(/例如: 原理化 BSDF/);
      fireEvent.change(srcInput, { target: { value: 'Anisotropic' } });
      fireEvent.change(tgtInput, { target: { value: '各向异性' } });

      const saveBtn = screen.getByRole('button', { name: /保存词条/ });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(upsertCalledWith).not.toBeNull();
        expect(upsertCalledWith.source).toBe('Anisotropic');
        expect(upsertCalledWith.target).toBe('各向异性');
      });
    });

    it('exports custom glossary to CSV', async () => {
      createMockIpcHarness();
      let exportCalled = false;

      (getActiveHarness()!.invokeMock as any).mockImplementation(async (cmd: string): Promise<any> => {
        if (cmd === 'cmd_get_custom_glossary') {
          return [...SAMPLE_GLOSSARY];
        }
        if (cmd === 'cmd_export_custom_glossary') {
          exportCalled = true;
          return 'source,target,category,note\nPrincipled BSDF,原理化 BSDF,Blender,\n';
        }
        if (cmd === 'cmd_get_settings') {
          return {};
        }
        return null;
      });

      render(<GlossaryPanel />);

      expect(await screen.findByText('Principled BSDF')).toBeInTheDocument();

      const exportCsvBtn = screen.getByRole('button', { name: /导出 CSV/ });
      fireEvent.click(exportCsvBtn);

      await waitFor(() => {
        expect(exportCalled).toBe(true);
      });
    });

    it('processes txt file drag-and-drop and imports entries', async () => {
      createMockIpcHarness();
      let importedEntries: any[] = [];

      (getActiveHarness()!.invokeMock as any).mockImplementation(async (cmd: string, args?: any): Promise<any> => {
        if (cmd === 'cmd_get_custom_glossary') {
          return [...SAMPLE_GLOSSARY, ...importedEntries];
        }
        if (cmd === 'cmd_parse_glossary_text') {
          return [
            { id: 't-1', source: 'Emission', target: '自发光', category: '通用', createdAt: Date.now() },
            { id: 't-2', source: 'Transmission', target: '透射', category: '通用', createdAt: Date.now() },
          ];
        }
        if (cmd === 'cmd_import_custom_glossary') {
          importedEntries = args?.entries || [];
          return {
            totalParsed: 2,
            added: 2,
            updated: 0,
            skipped: 0,
            totalAfter: SAMPLE_GLOSSARY.length + 2,
          };
        }
        if (cmd === 'cmd_get_settings') {
          return {};
        }
        return null;
      });

      render(<GlossaryPanel />);
      expect(await screen.findByText('Principled BSDF')).toBeInTheDocument();

      // Create dummy file with JSDOM text() support
      const file = new File(['Emission = 自发光\nTransmission = 透射'], 'glossary.txt', { type: 'text/plain' });
      file.text = async () => 'Emission = 自发光\nTransmission = 透射';

      const dropzone = screen.getByText(/拖拽 Excel \(\.xlsx\) 或 CSV \/ TSV \/ TXT 文件至此处/).closest('div')!;
      fireEvent.drop(dropzone, {
        dataTransfer: {
          files: [file],
        },
      });

      expect(await screen.findByText(/🎉 导入成功！共解析 2 条，新增 2 条/)).toBeInTheDocument();
    });
  });

  describe('HistoryPanel Integration', () => {
    it('opens AnkiSyncModal when clicking 同步至 Anki button in HistoryPanel', async () => {
      createMockIpcHarness();
      (getActiveHarness()!.invokeMock as any).mockImplementation(async (cmd: string): Promise<any> => {
        if (cmd === 'cmd_get_history') {
          return [...SAMPLE_HISTORY];
        }
        if (cmd === 'cmd_get_capture_sessions') return [];
        if (cmd === 'cmd_get_clipboard_history') return [];
        if (cmd === 'cmd_get_settings') return {};
        if (cmd === 'cmd_anki_check_connection') {
          return {
            connected: true,
            version: 6,
            decks: ['Catwalk Vocabulary'],
            models: ['Basic'],
            message: 'OK',
          };
        }
        return null;
      });

      const { HistoryPanel } = await import('../components/Vocabulary/HistoryPanel');
      render(<HistoryPanel />);

      expect(await screen.findByText('Subsurface Scattering')).toBeInTheDocument();

      const ankiBtn = screen.getByRole('button', { name: /📇 同步至 Anki/ });
      fireEvent.click(ankiBtn);

      expect(await screen.findByText('同步生词到 Anki')).toBeInTheDocument();
      expect(screen.getByText('双轨闭环')).toBeInTheDocument();
    });
  });
});
