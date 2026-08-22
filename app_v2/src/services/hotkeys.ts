/**
 * Shared hotkey string matching ("Ctrl+Alt+D", "Alt+Space", "F4", ...).
 * Used by both the App-level browser fallback listener and the CaptureOverlay
 * key handler so a single physical keypress is handled exactly once.
 */
export function matchesHotkey(e: KeyboardEvent, hotkeyStr?: string): boolean {
  if (!hotkeyStr) return false;
  const parts = hotkeyStr.split('+').map((p) => p.trim().toUpperCase());

  const needCtrl = parts.includes('CTRL') || parts.includes('CONTROL');
  const needAlt = parts.includes('ALT');
  const needShift = parts.includes('SHIFT');
  const needWin = parts.includes('WIN') || parts.includes('META');

  if (e.ctrlKey !== needCtrl) return false;
  if (e.altKey !== needAlt) return false;
  if (e.shiftKey !== needShift) return false;
  if (e.metaKey !== needWin) return false;

  const keyParts = parts.filter((p) => !['CTRL', 'CONTROL', 'ALT', 'SHIFT', 'WIN', 'META'].includes(p));
  if (keyParts.length === 0) return false;

  const targetKey = keyParts[0];
  let pressedKey = e.key.toUpperCase();
  if (e.code.startsWith('Key')) pressedKey = e.code.replace('Key', '');
  else if (e.code.startsWith('Digit')) pressedKey = e.code.replace('Digit', '');

  return pressedKey === targetKey || e.key.toUpperCase() === targetKey;
}

/**
 * 归一化快捷键字符串用于冲突比较：统一小写、修饰键排序、
 * meta/cmd/super 归一为 win，使 "Ctrl+Shift+C" 与 "shift+ctrl+c" 判等。
 */
export function normalizeHotkeyForCompare(hk: string): string {
  const MODS = ['ctrl', 'alt', 'shift', 'win'];
  return hk
    .split('+')
    .map((k) => k.trim().toLowerCase())
    .map((k) => (['meta', 'cmd', 'super'].includes(k) ? 'win' : k))
    .filter(Boolean)
    .sort((a, b) => {
      const ai = MODS.indexOf(a);
      const bi = MODS.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return 0;
    })
    .join('+');
}
