import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UpdateModal } from '../components/UpdateModal';
import { PreferencePanel } from '../components/Settings/panels/PreferencePanel';
import { useSettingsStore } from '../stores/useSettingsStore';
import * as tauriServices from '../services/tauri';
import type { UpdateInfo } from '../services/types';

describe('Auto Update and Progress Suite', () => {
  const mockUpdateInfo: UpdateInfo = {
    version: '0.4.0',
    release_date: '2026-09-12',
    download_url: 'https://github.com/maobukeai/catwalk-translator/releases/tag/v0.4.0',
    sha256: null,
    release_notes: '1. 支持全自动静默无感安装\n2. 实时流式下载进度条',
    assets: [
      {
        name: 'MaobuTranslator_0.4.0_x64-setup.exe',
        url: 'https://github.com/maobukeai/catwalk-translator/releases/download/v0.4.0/MaobuTranslator_0.4.0_x64-setup.exe',
        size: 15728640, // 15 MB
        sha256: null,
      },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        autoCheckUpdate: true,
        autoSilentUpdate: false,
      },
    });
  });

  it('renders UpdateModal with version, release notes and action buttons', () => {
    const handleClose = vi.fn();
    render(
      <UpdateModal
        isOpen={true}
        onClose={handleClose}
        updateInfo={mockUpdateInfo}
      />
    );

    expect(screen.getByText('发现新版本可用')).toBeInTheDocument();
    expect(screen.getByText('v0.4.0')).toBeInTheDocument();
    expect(screen.getByText(/全自动静默无感安装/)).toBeInTheDocument();
    expect(screen.getByTestId('update-modal-install-btn')).toBeInTheDocument();
    expect(screen.getByTestId('update-modal-cancel-btn')).toBeInTheDocument();
  });

  it('toggles silent update mode checkbox in UpdateModal', () => {
    render(
      <UpdateModal
        isOpen={true}
        onClose={vi.fn()}
        updateInfo={mockUpdateInfo}
      />
    );

    const checkbox = screen.getByTestId('update-modal-silent-checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    expect(useSettingsStore.getState().settings.autoSilentUpdate).toBe(true);

    // Button text adapts to silent mode
    expect(screen.getByText('极速静默升级')).toBeInTheDocument();
  });

  it('triggers cmdDownloadAndInstallUpdate with silent parameter on button click', async () => {
    const downloadSpy = vi.spyOn(tauriServices, 'cmdDownloadAndInstallUpdate').mockResolvedValue('success.exe');

    render(
      <UpdateModal
        isOpen={true}
        onClose={vi.fn()}
        updateInfo={mockUpdateInfo}
      />
    );

    const installBtn = screen.getByTestId('update-modal-install-btn');
    fireEvent.click(installBtn);

    await waitFor(() => {
      expect(downloadSpy).toHaveBeenCalledWith(
        mockUpdateInfo.assets[0].url,
        false
      );
    });
  });

  it('displays real-time download progress and speed when progress events arrive', async () => {
    let progressCallback: ((p: any) => void) | null = null;
    vi.spyOn(tauriServices, 'onUpdateDownloadProgress').mockImplementation(async (cb) => {
      progressCallback = cb;
      return () => {};
    });

    vi.spyOn(tauriServices, 'cmdDownloadAndInstallUpdate').mockImplementation(() => new Promise(() => {}));

    render(
      <UpdateModal
        isOpen={true}
        onClose={vi.fn()}
        updateInfo={mockUpdateInfo}
      />
    );

    const installBtn = screen.getByTestId('update-modal-install-btn');
    fireEvent.click(installBtn);

    // Simulate progress event from Rust backend
    if (progressCallback) {
      (progressCallback as any)({
        percentage: 45.5,
        downloadedBytes: 7150000,
        totalBytes: 15728640,
        speedBytesPerSec: 3500000,
        stage: 'downloading',
      });
    }

    await waitFor(() => {
      expect(screen.getByText('45.5%')).toBeInTheDocument();
      expect(screen.getByText(/3.3 MB\/s/)).toBeInTheDocument();
    });
  });

  it('renders automatic update switches in PreferencePanel and toggles them', async () => {
    render(<PreferencePanel />);

    const autoCheckToggle = screen.getByTestId('auto-check-update-toggle') as HTMLInputElement;
    const autoSilentToggle = screen.getByTestId('auto-silent-update-toggle') as HTMLInputElement;

    expect(autoCheckToggle).toBeInTheDocument();
    expect(autoSilentToggle).toBeInTheDocument();
    expect(autoCheckToggle.checked).toBe(true);
    expect(autoSilentToggle.checked).toBe(false);

    fireEvent.click(autoCheckToggle);
    expect(useSettingsStore.getState().settings.autoCheckUpdate).toBe(false);

    fireEvent.click(autoSilentToggle);
    expect(useSettingsStore.getState().settings.autoSilentUpdate).toBe(true);
  });
});
