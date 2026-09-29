import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { OcrModelsCard } from '../components/Settings/OcrModelsCard';
import { useSettingsStore } from '../stores/useSettingsStore';
import { getActiveHarness } from './harness/tauriIpcMock';

let progressHandler: ((event: { payload: any }) => void) | null = null;
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_event: string, cb: (event: { payload: any }) => void) => {
    progressHandler = cb;
    return () => { progressHandler = null; };
  }),
}));

const STATUS = [
  { id: 'ppocrv6-det', version: 'v6', name: 'PP-OCRv6 文本检测 (Small)', fileName: 'ch_PP-OCRv6_det_infer.onnx', installed: true, sizeBytes: 9_929_594, approxBytes: 9_929_594 },
  { id: 'ppocrv6-rec', version: 'v6', name: 'PP-OCRv6 文本识别 (Small)', fileName: 'ch_PP-OCRv6_rec_infer.onnx', installed: true, sizeBytes: 21_234_383, approxBytes: 21_234_383 },
  { id: 'ppocrv6-cls', version: 'v6', name: 'PP-OCR 方向分类 (180°)', fileName: 'ch_ppocr_mobile_v2.0_cls_infer.onnx', installed: true, sizeBytes: 585_532, approxBytes: 1_400_000 },
  { id: 'ppocrv6t-det', version: 'v6t', name: 'PP-OCRv6 文本检测 (Tiny)', fileName: 'ch_PP-OCRv6_tiny_det_infer.onnx', installed: true, sizeBytes: 1_829_618, approxBytes: 1_829_618 },
  { id: 'ppocrv6t-rec', version: 'v6t', name: 'PP-OCRv6 文本识别 (Tiny)', fileName: 'ch_PP-OCRv6_tiny_rec_infer.onnx', installed: false, sizeBytes: 0, approxBytes: 4_489_813 },
  { id: 'ppocrv6t-cls', version: 'v6t', name: 'PP-OCR 方向分类 (180°)', fileName: 'ch_ppocr_mobile_v2.0_cls_infer.onnx', installed: true, sizeBytes: 585_532, approxBytes: 1_400_000 },
  { id: 'ppocrv6m-det', version: 'v6m', name: 'PP-OCRv6 文本检测 (Medium)', fileName: 'ch_PP-OCRv6_medium_det_infer.onnx', installed: false, sizeBytes: 0, approxBytes: 62_119_454 },
  { id: 'ppocrv6m-rec', version: 'v6m', name: 'PP-OCRv6 文本识别 (Medium)', fileName: 'ch_PP-OCRv6_medium_rec_infer.onnx', installed: false, sizeBytes: 0, approxBytes: 76_629_984 },
  { id: 'ppocrv6m-cls', version: 'v6m', name: 'PP-OCR 方向分类 (180°)', fileName: 'ch_ppocr_mobile_v2.0_cls_infer.onnx', installed: true, sizeBytes: 585_532, approxBytes: 1_400_000 },
];

function wireStatus(installed = STATUS) {
  const calls: Array<{ cmd: string; args: any }> = [];
  (getActiveHarness()!.invokeMock as any).mockImplementation(async (cmd: string, args?: any): Promise<any> => {
    calls.push({ cmd, args });
    if (cmd === 'cmd_get_settings') return { ...useSettingsStore.getState().settings };
    if (cmd === 'cmd_save_settings') return null;
    if (cmd === 'cmd_offline_models_status') return installed.map((m) => ({ ...m }));
    if (cmd === 'cmd_get_active_ocr_version') return useSettingsStore.getState().settings.ocrVersion || 'v6';
    if (cmd === 'cmd_switch_ocr_version') return true;
    if (cmd === 'cmd_download_offline_model') return true;
    return null;
  });
  return calls;
}

describe('OcrModelsCard (v6 Small / Tiny / Medium)', () => {
  beforeEach(() => {
    (window as any).__TAURI_INTERNALS__ = {};
    act(() => useSettingsStore.getState().setOcrVersion('v6'));
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    progressHandler = null;
    delete (window as any).__TAURI_INTERNALS__;
  });

  it('shows all v6 variants with honest installed states', async () => {
    wireStatus([
      ...STATUS,
      { id: 'ppocrv4-det', version: 'v4', name: '旧模型', fileName: 'ch_PP-OCRv4_det_infer.onnx', installed: true, sizeBytes: 4_745_517, approxBytes: 4_745_517 },
    ]);
    render(<OcrModelsCard />);
    fireEvent.click(screen.getByRole('button', { name: /PP-OCRv6 Small/i }));
    expect(await screen.findByTestId('ocr-model-ppocrv6-det')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /PP-OCRv6 Tiny/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /PP-OCRv6 Medium/i })).toBeInTheDocument();
    for (const legacy of ['PP-OCRv3', 'PP-OCRv4', 'PP-OCRv5']) {
      expect(screen.queryByRole('button', { name: new RegExp(legacy, 'i') })).not.toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: /PP-OCRv6 Tiny/i }));
    expect(await screen.findByTestId('ocr-model-ppocrv6t-rec')).toBeInTheDocument();
    expect(screen.getByTestId('ocr-status-ppocrv6t-rec').textContent).toContain('未下载');
    expect(screen.queryByTestId('ocr-model-ppocrv4-det')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /PP-OCRv6 Medium/i }));
    expect(await screen.findByTestId('ocr-model-ppocrv6m-rec')).toBeInTheDocument();
    expect(screen.getByText(/CPU 速度明显慢/)).toBeInTheDocument();
  });

  it('streams Tiny download progress and refreshes status', async () => {
    let installed = STATUS.map((m) => ({ ...m }));
    let finishDownload!: (v: boolean) => void;
    const calls: Array<{ cmd: string; args: any }> = [];
    (getActiveHarness()!.invokeMock as any).mockImplementation(async (cmd: string, args?: any): Promise<any> => {
      calls.push({ cmd, args });
      if (cmd === 'cmd_offline_models_status') return installed.map((m) => ({ ...m }));
      if (cmd === 'cmd_get_active_ocr_version') return 'v6';
      if (cmd === 'cmd_download_offline_model') {
        return new Promise<boolean>((resolve) => {
          finishDownload = resolve;
          progressHandler?.({ payload: { modelId: 'ppocrv6t-rec', received: 2_244_906, total: 4_489_813 } });
        });
      }
      return null;
    });
    render(<OcrModelsCard />);
    fireEvent.click(screen.getByRole('button', { name: /PP-OCRv6 Tiny/i }));
    fireEvent.click(await screen.findByTestId('ocr-download-ppocrv6t-rec'));
    await waitFor(() => expect(screen.getByTestId('ocr-progress-ppocrv6t-rec').style.width).toBe('50%'));
    installed = installed.map((m) => m.id === 'ppocrv6t-rec' ? { ...m, installed: true, sizeBytes: 4_489_813 } : m);
    finishDownload(true);
    await waitFor(() => expect(screen.getByTestId('ocr-status-ppocrv6t-rec').textContent).toContain('已安装'));
    expect(calls.some((c) => c.cmd === 'cmd_download_offline_model' && c.args?.id === 'ppocrv6t-rec')).toBe(true);
  });

  it('reports download errors', async () => {
    (getActiveHarness()!.invokeMock as any).mockImplementation(async (cmd: string): Promise<any> => {
      if (cmd === 'cmd_offline_models_status') return STATUS;
      if (cmd === 'cmd_get_active_ocr_version') return 'v6';
      if (cmd === 'cmd_download_offline_model') throw new Error('所有镜像均下载失败：404');
      return null;
    });
    render(<OcrModelsCard />);
    fireEvent.click(screen.getByRole('button', { name: /PP-OCRv6 Tiny/i }));
    fireEvent.click(await screen.findByTestId('ocr-download-ppocrv6t-rec'));
    expect((await screen.findByTestId('ocr-models-error')).textContent).toContain('下载失败');
  });

  it('switches between installed variants including Medium', async () => {
    const calls = wireStatus(STATUS.map((m) => ({ ...m, installed: true })));
    act(() => useSettingsStore.getState().setOcrEngine('winrt'));
    render(<OcrModelsCard />);
    fireEvent.click(await screen.findByRole('button', { name: /PP-OCRv6 Tiny/i }));
    expect(calls.some((c) => c.cmd === 'cmd_switch_ocr_version')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /设为默认并启用/i }));
    await waitFor(() => expect(calls.some((c) => c.cmd === 'cmd_switch_ocr_version' && c.args?.version === 'v6t')).toBe(true));
    await waitFor(() => expect(useSettingsStore.getState().settings.ocrVersion).toBe('v6t'));
    expect(useSettingsStore.getState().settings.ocrEngine).toBe('auto');
    fireEvent.click(screen.getByRole('button', { name: /PP-OCRv6 Medium/i }));
    fireEvent.click(screen.getByRole('button', { name: /设为默认并启用/i }));
    await waitFor(() => expect(calls.some((c) => c.cmd === 'cmd_switch_ocr_version' && c.args?.version === 'v6m')).toBe(true));
    await waitFor(() => expect(useSettingsStore.getState().settings.ocrVersion).toBe('v6m'));
  });

  it('can re-enable the already selected model when WinRT was forced', async () => {
    const calls = wireStatus(STATUS.map((m) => ({ ...m, installed: true })));
    act(() => {
      useSettingsStore.getState().setOcrVersion('v6');
      useSettingsStore.getState().setOcrEngine('winrt');
    });
    render(<OcrModelsCard />);
    fireEvent.click(await screen.findByRole('button', { name: /设为默认并启用/i }));
    await waitFor(() => expect(calls.some((c) => c.cmd === 'cmd_switch_ocr_version' && c.args?.version === 'v6')).toBe(true));
    await waitFor(() => expect(useSettingsStore.getState().settings.ocrEngine).toBe('auto'));
  });
});
