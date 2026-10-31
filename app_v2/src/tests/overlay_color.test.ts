import { describe, expect, it } from 'vitest';
import { getCardTextColor } from '../components/Overlay/OverlayBlockCard';

describe('in-place sampled text color', () => {
  it.each([
    // Actual green status line from windows_terminal_dense.png.
    ['rgb(12,12,12)', 'rgb(21,180,12)'],
    ['#0c0c0c', '#56d9dc'],
    ['#ffffff', '#176be8'],
    // Actual large title from password_dialog_dense.png.
    ['rgb(233,238,246)', 'rgb(64,65,66)'],
    ['#fff', '#333'],
  ])('keeps readable source ink %s / %s instead of forcing monochrome', (background, foreground) => {
    expect(getCardTextColor(background, foreground)).toBe(foreground);
  });

  it.each([
    ['#0c0c0c', '#000000', '#ffffff'],
    ['#ffffff', '#eeeeee', '#000000'],
    // A brightness-only dark/light cutoff chooses white on this mid-gray,
    // even though black has more contrast.
    ['#888888', '#999999', '#000000'],
    ['#0c0c0c', 'rgba(255,255,255,0.05)', '#ffffff'],
    ['#0c0c0c', '#fff0', '#ffffff'],
    ['#fff', '#00000008', '#000000'],
  ])('repairs unreadable or translucent ink %s / %s', (background, foreground, expected) => {
    expect(getCardTextColor(background, foreground)).toBe(expected);
  });

  it('evaluates foreground opacity against the actual opaque erase background', () => {
    expect(getCardTextColor('rgba(0,0,0,0.3)', 'rgba(255,255,255,0.9)')).toBe('rgba(255,255,255,0.9)');
    expect(getCardTextColor('#ffffff80', '#222222')).toBe('#222222');
  });

  it('uses a safe known color for missing or unsupported ink', () => {
    expect(getCardTextColor('#ffffff', 'transparent')).toBe('#000000');
    expect(getCardTextColor('#0c0c0c', 'not-a-color')).toBe('#ffffff');
    expect(getCardTextColor('#ffffff', undefined)).toBe('#000000');
    expect(getCardTextColor(undefined, undefined)).toBe('#ffffff');
    expect(getCardTextColor(undefined, '#000000')).toBe('#000000');
  });
});
