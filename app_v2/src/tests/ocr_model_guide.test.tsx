import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { OcrModelGuideModal, hasAnyCompleteModelSet } from '../components/OcrModelGuideModal';
import { getActiveHarness } from './harness/tauriIpcMock';
import type { OfflineModelStatus } from '../services/types';

const stub = (id: string, version: string, installed: boolean): OfflineModelStatus => ({
  id,
  version,
  name: id,
  fileName: `${id}.onnx`,
  installed,
  sizeBytes: 0,
  approxBytes: 1_000_000,
});

/** 注入 cmd_offline_models_status 的返回值；版本带完整三件套时引导不出现。 */
function wireStatus(list: OfflineModelStatus[]) {
  (getActiveHarness()!.invokeMock as any).mockImplementation(async (cmd: string): Promise<any> => {
    if (cmd === 'cmd_offline_models_status') return list.map((m) => ({ ...m }));
    return null;
  });
}

describe('OcrModelGuideModal', () => {
  beforeAll(() => {
    (window as any).__TAURI_INTERNALS__ = {};
  });
  beforeEach(() => {
    (window as any).__TAURI_INTERNALS__ = {};
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (window as any).__TAURI_INTERNALS__;
  });

  it('shows guidance when no model set is installed, then dismisses for the session', async () => {
    wireStatus([]);
    render(<OcrModelGuideModal onGoDownload={() => {}} />);

    expect(await screen.findByTestId('ocr-model-guide')).toBeInTheDocument();
    expect(screen.getByText(/尚未安装本地 OCR 识别模型/i)).toBeInTheDocument();
    expect(screen.getByText(/PP-OCRv6 Tiny/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('ocr-guide-dismiss'));
    expect(screen.queryByTestId('ocr-model-guide')).not.toBeInTheDocument();

    // 同一次挂载期内重渲染也不会再次弹出（会话级只提示一次）
    const { rerender } = render(<OcrModelGuideModal onGoDownload={() => {}} />);
    rerender(<OcrModelGuideModal onGoDownload={() => {}} />);
    expect(screen.queryByTestId('ocr-model-guide')).not.toBeInTheDocument();
  });

  it('remains closed when at least one full model set is installed', async () => {
    wireStatus([
      stub('ppocrv6t-det', 'v6t', true),
      stub('ppocrv6t-rec', 'v6t', true),
      stub('ppocrv6t-cls', 'v6t', true),
    ]);
    render(<OcrModelGuideModal onGoDownload={() => {}} />);
    await new Promise((r) => setTimeout(r, 60));
    expect(screen.queryByTestId('ocr-model-guide')).not.toBeInTheDocument();
  });

  it('remains closed for a partially installed set (missing cls)', async () => {
    wireStatus([
      stub('ppocrv6t-det', 'v6t', true),
      stub('ppocrv6t-rec', 'v6t', true),
    ]);
    render(<OcrModelGuideModal onGoDownload={() => {}} />);
    // 等待探测完成（此时应弹出）
    expect(await screen.findByTestId('ocr-model-guide')).toBeInTheDocument();
  });

  it('never shows again after checking 不再提示 and clicking 稍后再说', async () => {
    wireStatus([]);
    const { unmount } = render(<OcrModelGuideModal onGoDownload={() => {}} />);
    expect(await screen.findByTestId('ocr-model-guide')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByTestId('ocr-guide-dismiss'));
    expect(window.localStorage.getItem('catwalk.ocrGuideDismissed')).toBe('1');
    unmount();

    render(<OcrModelGuideModal onGoDownload={() => {}} />);
    await new Promise((r) => setTimeout(r, 60));
    expect(screen.queryByTestId('ocr-model-guide')).not.toBeInTheDocument();
  });

  it('去下载 triggers the navigation callback', async () => {
    wireStatus([]);
    const onGoDownload = vi.fn();
    render(<OcrModelGuideModal onGoDownload={onGoDownload} />);
    fireEvent.click(await screen.findByTestId('ocr-guide-download'));
    expect(onGoDownload).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('ocr-model-guide')).not.toBeInTheDocument();
  });

  it('hasAnyCompleteModelSet treats partial installs as not complete', () => {
    expect(hasAnyCompleteModelSet([])).toBe(false);
    expect(
      hasAnyCompleteModelSet([
        stub('ppocrv6t-det', 'v6t', true),
        stub('ppocrv6t-rec', 'v6t', true),
      ])
    ).toBe(false); // 缺 cls
    expect(
      hasAnyCompleteModelSet([
        stub('ppocrv4-det', 'v4', true),
        stub('ppocrv4-rec', 'v4', true),
        stub('ppocrv4-cls', 'v4', true),
      ])
    ).toBe(true);
  });
});
