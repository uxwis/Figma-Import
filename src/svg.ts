// SVG 构造工具：解析器把矢量内容统一表达为 SVG 字符串，
// 主线程用 figma.createNodeFromSvg() 还原成可编辑矢量节点。
import type { RGB } from './types';

/** 数字格式化：最多 3 位小数，去掉多余的 0，避免 SVG 字符串膨胀 */
export function n(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const r = Math.round(v * 1000) / 1000;
  return String(r);
}

export function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 拆出 #rrggbb 与不透明度——SVG 的 fill 不支持 8 位十六进制颜色 */
export function splitColor(c: RGB): { hex: string; opacity: number } {
  const to = (v: number) => {
    const x = Math.round(clamp01(v) * 255);
    return x.toString(16).padStart(2, '0');
  };
  return {
    hex: `#${to(c.r)}${to(c.g)}${to(c.b)}`,
    opacity: clamp01(c.a ?? 1),
  };
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export type Box = { minX: number; minY: number; maxX: number; maxY: number };

export function emptyBox(): Box {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function extendBox(b: Box, x: number, y: number): void {
  if (x < b.minX) b.minX = x;
  if (x > b.maxX) b.maxX = x;
  if (y < b.minY) b.minY = y;
  if (y > b.maxY) b.maxY = y;
}

export function boxWidth(b: Box): number {
  return Number.isFinite(b.minX) ? Math.max(0, b.maxX - b.minX) : 0;
}

export function boxHeight(b: Box): number {
  return Number.isFinite(b.minY) ? Math.max(0, b.maxY - b.minY) : 0;
}

/**
 * 把三次贝塞尔在单轴上的精确极值并入 box。
 * 只用控制点会得到偏大的包围盒，导致矢量图层的选择框虚胖。
 */
export function extendBoxCubic(
  box: Box,
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  p3x: number,
  p3y: number,
): void {
  extendBox(box, p0x, p0y);
  extendBox(box, p3x, p3y);
  for (const axis of [0, 1] as const) {
    const a0 = axis === 0 ? p0x : p0y;
    const a1 = axis === 0 ? p1x : p1y;
    const a2 = axis === 0 ? p2x : p2y;
    const a3 = axis === 0 ? p3x : p3y;
    // f'(t)/3 = A t^2 + B t + C
    const A = -a0 + 3 * a1 - 3 * a2 + a3;
    const B = 2 * (a0 - 2 * a1 + a2);
    const C = -a0 + a1;
    const roots: number[] = [];
    if (Math.abs(A) < 1e-12) {
      if (Math.abs(B) > 1e-12) roots.push(-C / B);
    } else {
      const disc = B * B - 4 * A * C;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        roots.push((-B + sq) / (2 * A), (-B - sq) / (2 * A));
      }
    }
    for (const t of roots) {
      if (t <= 0 || t >= 1) continue;
      const mt = 1 - t;
      const v =
        mt * mt * mt * a0 + 3 * mt * mt * t * a1 + 3 * mt * t * t * a2 + t * t * t * a3;
      if (axis === 0) {
        if (v < box.minX) box.minX = v;
        if (v > box.maxX) box.maxX = v;
      } else {
        if (v < box.minY) box.minY = v;
        if (v > box.maxY) box.maxY = v;
      }
    }
  }
}

/** 拼一个完整的 SVG 文档。body 内的坐标必须是已平移到局部原点的坐标。 */
export function svgDoc(width: number, height: number, body: string, defs = ''): string {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${n(w)}" height="${n(h)}" viewBox="0 0 ${n(w)} ${n(h)}">` +
    (defs ? `<defs>${defs}</defs>` : '') +
    body +
    `</svg>`
  );
}
