import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { OcrModelsCard } from '../components/Settings/OcrModelsCard';
import { SettingsDashboard } from '../components/Settings/SettingsDashboard';
import { useSettingsStore } from '../stores/useSettingsStore';
import { createMockIpcHarness, getActiveHarness } from './harness/tauriIpcMock';

// Capture the progress listener so tests can push `model-download-progress` events
let progressHandler: ((event: { payload: any }) => void) | null = null;
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_event: string, cb: (event: { payload: any }) => void) => {
    progressHandler = cb;
    return () => { progressHandler = null; };
  }),
}));

const STATUS = [
  { id: 'ppocrv3-det', name: 'PP-OCRv3 文本检测', fileName: 'ch_PP-OCRv3_det_infer.onnx', installed: true, sizeBytes: 4_700_000, approxBytes: 4_700_000 },
  { id: 'ppocrv3-rec', name: 'PP-OCRv3 文本识别', fileName: 'ch_PP-OCRv3_rec_infer.onnx', installed: false, sizeBytes: 0, approxBytes: 9_800_000 },
  { id: 'ppocr-cls', name: 'PP-OCR 方向分类 (180°)', fileName: 'ch_ppocr_mobile_v2.0_cls_infer.onnx', installed: false, sizeBytes: 0, approxBytes: 1_200_000 },
];

function wireStatus(installed: typeof STATUS = STATUS) {
  const calls: Array<{ cmd: string; args: any }> = [];
  (getActiveHarness()!.invokeMock as any).mockImplementation(async (cmd: string, args?: any): Promise<any> => {
    calls.push({ cmd, args });
    if (cmd === 'cmd_get_settings') return { ...useSettingsStore.getState().settings };
    if (cmd === 'cmd_save_settings') return null;
    if (cmd === 'cmd_ocr_engine_status') return { status: 'ready', detail: 'OCR 引擎就绪' };
    if (cmd === 'cmd_offline_models_status') return installed.map((m) => ({ ...m }));
    if (cmd === 'cmd_get_active_ocr_version') return useSettingsStore.getState().settings.ocrVersion || 'v4';
    if (cmd === 'cmd_switch_ocr_version') return true;
    if (cmd === 'cmd_download_offline_model') return true;
    if (cmd === 'cmd_delete_offline_model') return true;
    return null;
  });
  return calls;
}

describe('OcrModelsCard (real OCR model downloads)', () => {
  beforeAll(() => {
    (window as any).__TAURI_INTERNALS__ = {};
  });

  beforeEach(() => {
    // Re-arm for every test (afterEach removes it so other suites stay clean)
    (window as any).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    progressHandler = null;
    delete (window as any).__TAURI_INTERNALS__;
  });

  it('lists the three PP-OCRv3 models with honest installed states', async () => {
    wireStatus();
    render(<OcrModelsCard />);

    expect(await screen.findByTestId('ocr-model-ppocrv3-det')).toBeInTheDocument();
    expect(screen.getByTestId('ocr-status-ppocrv3-det').textContent).toContain('已安装');
    expect(screen.getByTestId('ocr-status-ppocrv3-rec').textContent).toContain('未下载');
    expect(screen.getByTestId('ocr-model-ppocr-cls')).toBeInTheDocument();
    // Installed model offers delete, missing ones offer download
    expect(screen.queryByTestId('ocr-download-ppocrv3-det')).not.toBeInTheDocument();
    expect(screen.getByTestId('ocr-download-ppocrv3-rec')).toBeInTheDocument();
  });

  it('download streams real progress events into the bar, then refreshes status', async () => {
    let installed = STATUS.map((m) => ({ ...m }));
    let finishDownload!: (v: boolean) => void;
    const calls: Array<{ cmd: string; args: any }> = [];
    (getActiveHarness()!.invokeMock as any).mockImplementation(async (cmd: string, args?: any): Promise<any> => {
      calls.push({ cmd, args });
      if (cmd === 'cmd_offline_models_status') return installed.map((m) => ({ ...m }));
      if (cmd === 'cmd_download_offline_model') {
        // Deferred completion keeps the progress bar alive for assertions
        return new Promise<boolean>((resolve) => {
          finishDownload = resolve;
          progressHandler?.({ payload: { modelId: 'ppocrv3-rec', received: 2_500_000, total: 9_800_000 } });
        });
      }
      if (cmd === 'cmd_delete_offline_model') return true;
      return null;
    });

    render(<OcrModelsCard />);
    await screen.findByTestId('ocr-download-ppocrv3-rec');

    fireEvent.click(screen.getByTestId('ocr-download-ppocrv3-rec'));

    // First streamed chunk → 26%
    await waitFor(() => {
      expect(screen.getByTestId('ocr-progress-ppocrv3-rec').style.width).toBe('26%');
    });

    // Final chunk → 100%
    progressHandler?.({ payload: { modelId: 'ppocrv3-rec', received: 9_800_000, total: 9_800_000, done: true } });
    await waitFor(() => {
      expect(screen.getByTestId('ocr-progress-ppocrv3-rec').style.width).toBe('100%');
    });

    // Complete the download → status refresh shows the honest installed state
    installed = installed.map((m) => (m.id === 'ppocrv3-rec' ? { ...m, installed: true, sizeBytes: 9_800_000 } : m));
    finishDownload(true);
    await waitFor(() => {
      expect(screen.getByTestId('ocr-status-ppocrv3-rec').textContent).toContain('已安装');
    });
    expect(calls.some((c) => c.cmd === 'cmd_download_offline_model' && c.args?.id === 'ppocrv3-rec')).toBe(true);
  });

  it('surfacing a download error honestly', async () => {
    const calls = wireStatus(STATUS);
    (getActiveHarness()!.invokeMock as any).mockImplementation(async (cmd: string, args?: any): Promise<any> => {
      calls.push({ cmd, args });
      if (cmd === 'cmd_offline_models_status') return STATUS.map((m) => ({ ...m }));
      if (cmd === 'cmd_download_offline_model') {
        throw new Error('所有镜像均下载失败：404');
      }
      return null;
    });

    render(<OcrModelsCard />);
    await screen.findByTestId('ocr-download-ppocrv3-rec');
    fireEvent.click(screen.getByTestId('ocr-download-ppocrv3-rec'));

    expect(await screen.findByTestId('ocr-models-error')).toBeInTheDocument();
    expect(screen.getByTestId('ocr-models-error').textContent).toContain('下载失败');
  });

  it('delete calls the Rust delete command for installed models', async () => {
    const calls = wireStatus();
    render(<OcrModelsCard />);
    const del = await screen.findByTitle('删除已下载的模型文件');
    fireEvent.click(del);
    await waitFor(() => {
      expect(calls.some((c) => c.cmd === 'cmd_delete_offline_model' && c.args?.id === 'ppocrv3-det')).toBe(true);
    });
  });

  it('supports PP-OCRv3 / PP-OCRv4 / PP-OCRv5 version tabs switching', async () => {
    // 默认档现在是 v6Tiny；本用例只装 v3/v4/v5 的 mock，先显式切到 v4 再验证页签。
    act(() => {
      useSettingsStore.getState().setOcrVersion('v4');
    });

    const multiVersionStatus = [
      { id: 'ppocrv3-det', version: 'v3', name: 'PP-OCRv3 文本检测', fileName: 'ch_PP-OCRv3_det_infer.onnx', installed: true, sizeBytes: 4_700_000, approxBytes: 4_700_000 },
      { id: 'ppocrv3-rec', version: 'v3', name: 'PP-OCRv3 文本识别', fileName: 'ch_PP-OCRv3_rec_infer.onnx', installed: true, sizeBytes: 10_800_000, approxBytes: 10_800_000 },
      { id: 'ppocrv3-cls', version: 'v3', name: 'PP-OCR 方向分类 (180°)', fileName: 'ch_ppocr_mobile_v2.0_cls_infer.onnx', installed: true, sizeBytes: 1_400_000, approxBytes: 1_400_000 },
      { id: 'ppocrv4-det', version: 'v4', name: 'PP-OCRv4 文本检测', fileName: 'ch_PP-OCRv4_det_infer.onnx', installed: true, sizeBytes: 4_700_000, approxBytes: 4_700_000 },
      { id: 'ppocrv4-rec', version: 'v4', name: 'PP-OCRv4 文本识别', fileName: 'ch_PP-OCRv4_rec_infer.onnx', installed: true, sizeBytes: 10_800_000, approxBytes: 10_800_000 },
      { id: 'ppocrv4-cls', version: 'v4', name: 'PP-OCR 方向分类 (180°)', fileName: 'ch_ppocr_mobile_v2.0_cls_infer.onnx', installed: true, sizeBytes: 1_400_000, approxBytes: 1_400_000 },
      { id: 'ppocrv5-det', version: 'v5', name: 'PP-OCRv5 文本检测', fileName: 'ch_PP-OCRv5_det_infer.onnx', installed: false, sizeBytes: 0, approxBytes: 4_900_000 },
      { id: 'ppocrv5-rec', version: 'v5', name: 'PP-OCRv5 文本识别', fileName: 'ch_PP-OCRv5_rec_infer.onnx', installed: false, sizeBytes: 0, approxBytes: 11_200_000 },
      { id: 'ppocrv5-cls', version: 'v5', name: 'PP-OCR 方向分类 (180°)', fileName: 'ch_ppocr_mobile_v2.0_cls_infer.onnx', installed: false, sizeBytes: 0, approxBytes: 1_400_000 },
    ];

    const calls = wireStatus(multiVersionStatus as any);
    render(<OcrModelsCard />);

    // By default on multi-version, PP-OCRv4 is active and selected
    expect(await screen.findByTestId('ocr-model-ppocrv4-det')).toBeInTheDocument();
    expect(screen.getByText('正在使用')).toBeInTheDocument();

    // Click on PP-OCRv5 tab
    const v5Tab = screen.getByRole('button', { name: /PP-OCRv5/i });
    fireEvent.click(v5Tab);

    // v5 models should now be shown
    expect(await screen.findByTestId('ocr-model-ppocrv5-det')).toBeInTheDocument();
    expect(screen.getByTestId('ocr-download-ppocrv5-det')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /一键下载整套/i })).toBeInTheDocument();

    // Click on PP-OCRv3 tab (instantly activates v3 since all 3 models are installed)
    const v3Tab = screen.getByRole('button', { name: /PP-OCRv3/i });
    fireEvent.click(v3Tab);

    // v3 models should now be shown and active
    expect(await screen.findByTestId('ocr-model-ppocrv3-det')).toBeInTheDocument();
    await waitFor(() => {
      expect(calls.some((c) => c.cmd === 'cmd_switch_ocr_version' && c.args?.version === 'v3')).toBe(true);
    });
  });

  it('one-click batch download triggers sequential downloads', async () => {
    const v5Status = [
      { id: 'ppocrv5-det', version: 'v5', name: 'PP-OCRv5 文本检测', fileName: 'ch_PP-OCRv5_det_infer.onnx', installed: false, sizeBytes: 0, approxBytes: 4_900_000 },
      { id: 'ppocrv5-rec', version: 'v5', name: 'PP-OCRv5 文本识别', fileName: 'ch_PP-OCRv5_rec_infer.onnx', installed: false, sizeBytes: 0, approxBytes: 11_200_000 },
      { id: 'ppocrv5-cls', version: 'v5', name: 'PP-OCR 方向分类 (180°)', fileName: 'ch_ppocr_mobile_v2.0_cls_infer.onnx', installed: false, sizeBytes: 0, approxBytes: 1_400_000 },
    ];

    const calls = wireStatus(v5Status as any);
    render(<OcrModelsCard />);

    const downloadAllBtn = await screen.findByRole('button', { name: /一键下载整套/i });
    fireEvent.click(downloadAllBtn);

    await waitFor(() => {
      expect(calls.some((c) => c.cmd === 'cmd_download_offline_model' && c.args?.id === 'ppocrv5-det')).toBe(true);
      expect(calls.some((c) => c.cmd === 'cmd_download_offline_model' && c.args?.id === 'ppocrv5-rec')).toBe(true);
      expect(calls.some((c) => c.cmd === 'cmd_download_offline_model' && c.args?.id === 'ppocrv5-cls')).toBe(true);
    });
  });

  it('switching active OCR version updates global useSettingsStore and dynamically rebinds SettingsDashboard text', async () => {
    act(() => {
      useSettingsStore.getState().setOcrVersion('v4');
    });

    const multiVersionStatus = [
      { id: 'ppocrv4-det', version: 'v4', name: 'PP-OCRv4 文本检测', fileName: 'ch_PP-OCRv4_det_infer.onnx', installed: true, sizeBytes: 4_700_000, approxBytes: 4_700_000 },
      { id: 'ppocrv4-rec', version: 'v4', name: 'PP-OCRv4 文本识别', fileName: 'ch_PP-OCRv4_rec_infer.onnx', installed: true, sizeBytes: 10_800_000, approxBytes: 10_800_000 },
      { id: 'ppocrv4-cls', version: 'v4', name: 'PP-OCR 方向分类 (180°)', fileName: 'ch_ppocr_mobile_v2.0_cls_infer.onnx', installed: true, sizeBytes: 1_400_000, approxBytes: 1_400_000 },
      { id: 'ppocrv3-det', version: 'v3', name: 'PP-OCRv3 文本检测', fileName: 'ch_PP-OCRv3_det_infer.onnx', installed: true, sizeBytes: 4_700_000, approxBytes: 4_700_000 },
      { id: 'ppocrv3-rec', version: 'v3', name: 'PP-OCRv3 文本识别', fileName: 'ch_PP-OCRv3_rec_infer.onnx', installed: true, sizeBytes: 10_800_000, approxBytes: 10_800_000 },
      { id: 'ppocrv3-cls', version: 'v3', name: 'PP-OCR 方向分类 (180°)', fileName: 'ch_ppocr_mobile_v2.0_cls_infer.onnx', installed: true, sizeBytes: 1_400_000, approxBytes: 1_400_000 },
    ];

    wireStatus(multiVersionStatus as any);
    render(
      <>
        <OcrModelsCard />
        <SettingsDashboard />
      </>
    );

    // Switch to '优先级' tab in SettingsDashboard
    const preferenceTabBtn = await screen.findByRole('button', { name: /优先级/i });
    fireEvent.click(preferenceTabBtn);

    // Initial v4 labels rendered in SettingsDashboard
    expect(await screen.findByText(/PP-OCRV4 \(推荐\)/i)).toBeInTheDocument();
    expect(await screen.findByText(/智能探测：PP-OCRV4 优先/i)).toBeInTheDocument();

    // Verify WeChat OCR option is completely absent
    expect(screen.queryByText(/微信 OCR/i)).not.toBeInTheDocument();

    // Switch to v3 (1-click activation)
    const v3Tab = screen.getByRole('button', { name: /PP-OCRv3/i });
    fireEvent.click(v3Tab);

    // Global store ocrVersion should now be v3
    await waitFor(() => {
      expect(useSettingsStore.getState().settings.ocrVersion).toBe('v3');
    });

    // SettingsDashboard cards dynamically reflect PP-OCRV3
    await waitFor(() => {
      expect(screen.getByText(/PP-OCRV3 \(推荐\)/i)).toBeInTheDocument();
      expect(screen.getByText(/智能探测：PP-OCRV3 优先/i)).toBeInTheDocument();
    });
  });
});
