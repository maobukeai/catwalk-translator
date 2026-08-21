import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AboutPanel } from '../components/MainWindow/AboutPanel';

describe('AboutPanel Component Test Suite', () => {
  it('renders software information, author, and architecture details', () => {
    render(<AboutPanel />);

    expect(screen.getByText(/猫步翻译 \(Maobu Translator\)/)).toBeInTheDocument();
    expect(screen.getAllByText(/v\d+\.\d+\.\d+/).length).toBeGreaterThan(0);
    expect(screen.getByText('猫步可爱')).toBeInTheDocument();
    expect(screen.getByText('软件技术架构')).toBeInTheDocument();
    expect(screen.getByText(/前端展示层/)).toBeInTheDocument();
    expect(screen.getByText(/桌面后端层/)).toBeInTheDocument();
    expect(screen.getByText(/本地离线引擎/)).toBeInTheDocument();
    expect(screen.getByText(/智能多引擎中继/)).toBeInTheDocument();
  });

  it('renders core service cards and compatibility matrix', () => {
    render(<AboutPanel />);

    expect(screen.getByText('应用更新检查')).toBeInTheDocument();
    expect(screen.getByText('离线模型与词库')).toBeInTheDocument();
    expect(screen.getByText('开源项目主页')).toBeInTheDocument();
    expect(screen.getByText('翻译引擎与服务兼容性')).toBeInTheDocument();

    expect(screen.getByText('本地离线 OCR')).toBeInTheDocument();
    expect(screen.getByText('CG 离线专业词库')).toBeInTheDocument();
    expect(screen.getByText('微软 Bing 翻译')).toBeInTheDocument();
    expect(screen.getByText('Google 翻译')).toBeInTheDocument();
    expect(screen.getByText('DeepL 极速通道')).toBeInTheDocument();
    expect(screen.getAllByText(/AI 深度翻译/).length).toBeGreaterThan(0);
  });

  it('handles check update button click and displays update status', async () => {
    render(<AboutPanel />);

    const checkUpdateBtn = screen.getByRole('button', { name: /检查更新/ });
    expect(checkUpdateBtn).toBeInTheDocument();

    fireEvent.click(checkUpdateBtn);
    expect(await screen.findByText(/最新版|发现新版本|检查失败|检查更新/)).toBeInTheDocument();
  });

  it('opens and closes contact and sponsor QR modals', () => {
    render(<AboutPanel />);

    // Open Contact Modal
    const contactBtn = screen.getByText('联系方式');
    fireEvent.click(contactBtn);
    expect(screen.getByText(/联系作者 · 微信二维码/)).toBeInTheDocument();

    // Close Modal
    const closeBtns = screen.getAllByRole('button');
    const modalCloseBtn = closeBtns.find((btn) => btn.querySelector('svg.lucide-x'));
    expect(modalCloseBtn).toBeDefined();
    if (modalCloseBtn) fireEvent.click(modalCloseBtn);
    expect(screen.queryByText(/联系作者 · 微信二维码/)).toBeNull();

    // Open Sponsor Modal
    const sponsorBtn = screen.getByText('赞助支持');
    fireEvent.click(sponsorBtn);
    expect(screen.getByText(/赞助支持 · 赞赏码/)).toBeInTheDocument();
  });
});
