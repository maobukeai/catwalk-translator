import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { CloseConfirmModal } from '../components/CloseConfirmModal';
import { useSettingsStore } from '../stores/useSettingsStore';
import * as tauriService from '../services/tauri';

vi.mock('../services/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/tauri')>();
  return {
    ...actual,
    isTauri: vi.fn().mockReturnValue(false),
    cmdExitApp: vi.fn().mockResolvedValue(undefined),
    cmdSaveSettings: vi.fn().mockResolvedValue(undefined),
  };
});

describe('Close Action and CloseConfirmModal Test Suite', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        closeAction: 'ask',
        miniWindowCloseAction: 'hide',
      },
    });
    vi.clearAllMocks();
  });

  it('renders close confirmation modal with title, prompt, checkbox and action buttons', () => {
    const handleClose = vi.fn();
    render(<CloseConfirmModal isOpen={true} onClose={handleClose} />);

    expect(screen.getByText('关闭窗口')).toBeInTheDocument();
    expect(screen.getByText('关闭窗口时希望做什么？')).toBeInTheDocument();
    expect(screen.getByText('记住选择')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '退出程序' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最小化到托盘' })).toBeInTheDocument();
  });

  it('clicking 退出程序 with 记住选择 saves closeAction: exit and exits', async () => {
    const handleClose = vi.fn();
    render(<CloseConfirmModal isOpen={true} onClose={handleClose} />);

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    const exitBtn = screen.getByRole('button', { name: '退出程序' });
    fireEvent.click(exitBtn);

    await waitFor(() => {
      expect(handleClose).toHaveBeenCalled();
    });
    expect(useSettingsStore.getState().settings.closeAction).toBe('exit');
  });

  it('clicking 最小化到托盘 with 记住选择 saves closeAction: minimize and hides', async () => {
    const handleClose = vi.fn();
    render(<CloseConfirmModal isOpen={true} onClose={handleClose} />);

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    const minimizeBtn = screen.getByRole('button', { name: '最小化到托盘' });
    fireEvent.click(minimizeBtn);

    await waitFor(() => {
      expect(handleClose).toHaveBeenCalled();
    });
    expect(useSettingsStore.getState().settings.closeAction).toBe('minimize');
  });

  it('updates closeAction and miniWindowCloseAction in useSettingsStore', () => {
    useSettingsStore.getState().setCloseAction('minimize');
    expect(useSettingsStore.getState().settings.closeAction).toBe('minimize');

    useSettingsStore.getState().setMiniWindowCloseAction('minimize');
    expect(useSettingsStore.getState().settings.miniWindowCloseAction).toBe('minimize');
  });
});
