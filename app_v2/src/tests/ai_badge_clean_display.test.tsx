import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OverlayBlockCard } from '../components/Overlay/OverlayBlockCard';
import { SnippingToolbar } from '../components/Overlay/SnippingToolbar';
import type { OverlayBlock } from '../services/types';

describe('AI Refinement Badge - Clean Display without Per-Line Pollution', () => {
  it('OverlayBlockCard does NOT render any per-line sparkle badge even if sourceTier has ✨', () => {
    const mockBlock: OverlayBlock = {
      original: 'Roughness',
      translated: '粗糙度',
      sourceTier: 'DeepSeek AI 精翻 ✨',
      logicalX: 100,
      logicalY: 100,
      logicalW: 120,
      logicalH: 24,
      bgCss: 'rgb(30, 30, 30)',
      fgCss: '#ffffff',
    };

    render(
      <OverlayBlockCard
        block={mockBlock}
        blockIndex={0}
        onClose={vi.fn()}
        isPinned={false}
        onTogglePin={vi.fn()}
      />
    );

    // Translated text must be in the document
    expect(screen.getByText('粗糙度')).toBeInTheDocument();

    // But NO per-card ✨ badge should be rendered
    expect(screen.queryByText('✨')).not.toBeInTheDocument();
  });

  it('SnippingToolbar renders a single, non-intrusive badge when isAiRefined is true', () => {
    const { rerender } = render(
      <SnippingToolbar
        activeTool={null}
        onSelectTool={vi.fn()}
        onTranslate={vi.fn()}
        onOcr={vi.fn()}
        onUndo={vi.fn()}
        canUndo={false}
        onPin={vi.fn()}
        isPinned={false}
        onSave={vi.fn()}
        onCopy={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        isAiRefined={false}
      />
    );

    // Not refined yet -> no badge
    expect(screen.queryByTestId('ai-refined-badge')).not.toBeInTheDocument();

    // AI Refined -> single badge appears in toolbar
    rerender(
      <SnippingToolbar
        activeTool={null}
        onSelectTool={vi.fn()}
        onTranslate={vi.fn()}
        onOcr={vi.fn()}
        onUndo={vi.fn()}
        canUndo={false}
        onPin={vi.fn()}
        isPinned={false}
        onSave={vi.fn()}
        onCopy={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        isAiRefined={true}
        aiEngineName="DeepSeek"
      />
    );

    const badge = screen.getByTestId('ai-refined-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('✨');
    expect(badge).toHaveTextContent('DeepSeek 精翻');
  });

  it('SnippingToolbar displays refining state while background AI polish is in flight', () => {
    render(
      <SnippingToolbar
        activeTool={null}
        onSelectTool={vi.fn()}
        onTranslate={vi.fn()}
        onOcr={vi.fn()}
        onUndo={vi.fn()}
        canUndo={false}
        onPin={vi.fn()}
        isPinned={false}
        onSave={vi.fn()}
        onCopy={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        isAiRefining={true}
      />
    );

    expect(screen.getByText('AI 润色中…')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-refined-badge')).not.toBeInTheDocument();
  });
});
