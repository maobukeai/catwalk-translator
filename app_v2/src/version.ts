// 应用版本唯一来源：package.json（发布时与 tauri.conf.json / Cargo.toml 保持同步）。
// 前端任何地方需要展示/比较版本号都必须从这里取，禁止再硬编码字符串。
import pkg from '../package.json';

export const APP_VERSION: string = pkg.version;

/** 语义化版本比较：>0 表示 a 更新，<0 表示 b 更新，0 表示相同。 */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^[vV]/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^[vV]/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}
