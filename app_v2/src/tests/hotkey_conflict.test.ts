import { describe, it, expect } from 'vitest';
import { normalizeHotkeyForCompare } from '../services/hotkeys';

describe('快捷键冲突归一化比较 (normalizeHotkeyForCompare)', () => {
  it('大小写与修饰键顺序不影响判等', () => {
    expect(normalizeHotkeyForCompare('Ctrl+Shift+C')).toBe(normalizeHotkeyForCompare('shift+ctrl+c'));
    expect(normalizeHotkeyForCompare('Alt+Space')).toBe(normalizeHotkeyForCompare('alt + SPACE'));
  });

  it('meta/cmd/super 归一为 win', () => {
    expect(normalizeHotkeyForCompare('Meta+E')).toBe(normalizeHotkeyForCompare('Win+E'));
    expect(normalizeHotkeyForCompare('Cmd+E')).toBe(normalizeHotkeyForCompare('win+e'));
  });

  it('不同组合不相等', () => {
    expect(normalizeHotkeyForCompare('Ctrl+Shift+C')).not.toBe(normalizeHotkeyForCompare('Ctrl+Shift+V'));
    expect(normalizeHotkeyForCompare('F4')).not.toBe(normalizeHotkeyForCompare('Alt+Q'));
  });

  it('单键与带修饰键的组合不相等', () => {
    // 裸 F4 不应与 Ctrl+F4 判等（按键强度不同）
    expect(normalizeHotkeyForCompare('F4')).not.toBe(normalizeHotkeyForCompare('Ctrl+F4'));
  });
});
