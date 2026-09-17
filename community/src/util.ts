// 通用小工具：颜色、警告收集。
import type { RGB } from './types';

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function rgba255(r: number, g: number, b: number, a = 255): RGB {
  return { r: r / 255, g: g / 255, b: b / 255, a: a / 255 };
}

/** 按 key 去重的警告收集器，避免同一类问题在几百个图层上刷屏 */
export type Warns = {
  warn(key: string, message: string): void;
  list: string[];
};

export function createWarns(limit = 24): Warns {
  const seen = new Set<string>();
  const list: string[] = [];
  return {
    list,
    warn(key: string, message: string) {
      if (seen.has(key) || list.length >= limit) return;
      seen.add(key);
      list.push(message);
    },
  };
}
