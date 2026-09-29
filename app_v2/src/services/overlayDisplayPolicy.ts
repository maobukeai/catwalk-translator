import type { OverlayBlock } from './types';

/** Classify prose only to format an explicitly opened reading panel. */
export function isDenseProseLayout(blocks: Pick<OverlayBlock, 'original' | 'logicalW'>[]): boolean {
  const contentRows = blocks.filter((block) =>
    block.logicalW >= 180 && block.original.replace(/\s/g, '').length >= 8,
  );
  const totalWidth = contentRows.reduce((width, row) => width + row.logicalW, 0);
  const totalCharacters = contentRows.reduce(
    (length, row) => length + row.original.replace(/\s/g, '').length, 0,
  );
  const hasLongRow = contentRows.some((row) =>
    row.logicalW >= 280 && row.original.replace(/\s/g, '').length >= 20,
  );
  return hasLongRow && (
    (contentRows.length >= 2 && totalWidth >= 600 && totalCharacters >= 32)
    || (contentRows.length === 1 && totalWidth >= 650 && totalCharacters >= 80)
  );
}
