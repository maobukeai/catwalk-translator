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
