import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CheatSheetModal } from '../components/Overlay/CheatSheetModal';

describe('CheatSheetModal Component', () => {
  it('does not render when isOpen is false', () => {
    const handleClose = vi.fn();
    render(<CheatSheetModal isOpen={false} onClose={handleClose} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('快捷键速查面板')).not.toBeInTheDocument();
  });

  it('renders correctly when isOpen is true with all categories and shortcut content', () => {
    const handleClose = vi.fn();
    render(<CheatSheetModal isOpen={true} onClose={handleClose} />);

    // Check modal title & dialog role
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('快捷键速查面板')).toBeInTheDocument();

    // Check 4 categories
    expect(screen.getByText(/选区操作/)).toBeInTheDocument();
    expect(screen.getByText(/卡片操作/)).toBeInTheDocument();
    expect(screen.getByText(/模式通道/)).toBeInTheDocument();
    expect(screen.getByText(/帮助指引/)).toBeInTheDocument();

    // Check selection operations items
    expect(screen.getByText('拖拽划词')).toBeInTheDocument();
    expect(screen.getByText('Shift+拖拽多选')).toBeInTheDocument();
    expect(screen.getByText('Esc 取消选区 / 退出')).toBeInTheDocument();
    expect(screen.getByText('R 重划上次选区（结果页可用）')).toBeInTheDocument();
    expect(screen.getByText('F4开关')).toBeInTheDocument();

    // Check card operations items
    expect(screen.getByText('Ctrl+P锁定')).toBeInTheDocument();
    expect(screen.getByText('Enter/Ctrl+C复制')).toBeInTheDocument();
    expect(screen.getByText('卡片右键菜单（复制/朗读/收藏/隐藏）')).toBeInTheDocument();
    expect(screen.getByText('Space语音朗读')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+D收藏')).toBeInTheDocument();

    // Check mode & channel items
    expect(screen.getByText('M 原位覆盖/有道面板')).toBeInTheDocument();
    expect(screen.getByText('Tab切AI模型')).toBeInTheDocument();
    expect(screen.getByText('1~6切换语种')).toBeInTheDocument();

    // Check help guidance items
    expect(screen.getByText('?/F1速查')).toBeInTheDocument();

    // Check key styling badges presence (<kbd>)
    const kbds = document.querySelectorAll('kbd');
    expect(kbds.length).toBeGreaterThan(0);
  });

  it('triggers onClose when close button is clicked', () => {
    const handleClose = vi.fn();
    render(<CheatSheetModal isOpen={true} onClose={handleClose} />);

    const closeBtn = screen.getByRole('button', { name: '关闭' });
    expect(closeBtn).toBeInTheDocument();

    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('triggers onClose when Esc key is pressed', () => {
    const handleClose = vi.fn();
    render(<CheatSheetModal isOpen={true} onClose={handleClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('triggers onClose when ? key or F1 key is pressed', () => {
    const handleClose = vi.fn();
    render(<CheatSheetModal isOpen={true} onClose={handleClose} />);

    fireEvent.keyDown(window, { key: '?' });
    expect(handleClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'F1' });
    expect(handleClose).toHaveBeenCalledTimes(2);
  });

  it('triggers onClose when clicking overlay backdrop, but not inside dialog', () => {
    const handleClose = vi.fn();
    render(<CheatSheetModal isOpen={true} onClose={handleClose} />);

    const dialog = screen.getByRole('dialog');
    const overlay = screen.getByTestId('cheatsheet-modal-overlay');

    // Click inside dialog should not trigger onClose
    fireEvent.click(dialog);
    expect(handleClose).not.toHaveBeenCalled();

    // Click backdrop overlay should trigger onClose
    fireEvent.click(overlay);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
