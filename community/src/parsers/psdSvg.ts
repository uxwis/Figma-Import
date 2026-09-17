// PSD 矢量内容 → SVG。
//
// ag-psd 的关键数据结构（踩过坑，务必按这个来）：
//   BezierKnot.points = [inX, inY, anchorX, anchorY, outX, outY]
//     坐标已乘过文档宽高，是**文档绝对坐标**。
//   BezierPath.fillRule = 'non-zero' | 'even-odd'
//   BezierPath.operation = 'combine' | 'subtract' | 'intersect' | 'exclude'
//   layer.vectorFill / layer.vectorStroke.content = VectorContent
//     = {type:'color'} | {type:'solid'|'noise', colorStops, opacityStops, style, angle, scale, offset}
//       | {type:'pattern'}
import type { RGB } from '../types';
import type { BezierPath } from 'ag-psd';
import {
  n,
  splitColor,
  clamp01,
  emptyBox,
  extendBox,
  extendBoxCubic,
  boxWidth,
  boxHeight,
  type Box,
} from '../svg';
import type { Warns } from '../util';

type Knot = {
  ix: number;
  iy: number;
  ox: number;
  oy: number;
  cx: number;
  cy: number;
};

// ---------- 颜色 ----------

/** ag-psd 的 Color 有多种色彩空间，统一转成 0-1 的 RGB */
export function colorToRgb(color: any): RGB | undefined {
  if (!color || typeof color !== 'object') return undefined;
  if ('fr' in color) {
    return { r: clamp01(color.fr), g: clamp01(color.fg), b: clamp01(color.fb), a: 1 };
  }
  if ('r' in color && 'g' in color && 'b' in color) {
    return {
      r: color.r / 255,
      g: color.g / 255,
      b: color.b / 255,
      a: color.a === undefined ? 1 : color.a / 255,
    };
  }
  if ('c' in color && 'm' in color && 'y' in color && 'k' in color) {
    const [c, m, y, k] = [color.c, color.m, color.y, color.k].map((v: number) => v / 255);
    return { r: (1 - c) * (1 - k), g: (1 - m) * (1 - k), b: (1 - y) * (1 - k), a: 1 };
  }
  if ('h' in color && 's' in color && 'b' in color) {
    return hsbToRgb(color.h / 360, color.s, color.b);
  }
  if ('gray' in color) {
    const g = clamp01(color.gray);
    return { r: g, g, b: g, a: 1 };
  }
  if ('k' in color && typeof color.k === 'number') {
    // Grayscale：k 是 0-255 的灰阶
    const g = clamp01(color.k / 255);
    return { r: g, g, b: g, a: 1 };
  }
  return undefined;
}

function hsbToRgb(h: number, s: number, v: number): RGB {
  const hh = ((h % 1) + 1) % 1;
  const i = Math.floor(hh * 6);
  const f = hh * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][i % 6];
  return { r: clamp01(r), g: clamp01(g), b: clamp01(b), a: 1 };
}

// ---------- 路径 ----------

function toKnot(points: number[]): Knot {
  return {
    ix: points[0],
    iy: points[1],
    ox: points[4],
    oy: points[5],
    cx: points[2],
    cy: points[3],
  };
}

/** 反向遍历子路径：交换进出控制点，使 nonzero 填充下形成镂空 */
function reversedKnots(knots: Knot[]): Knot[] {
  const out: Knot[] = [];
  for (let i = knots.length - 1; i >= 0; i--) {
    const k = knots[i];
    out.push({ cx: k.cx, cy: k.cy, ix: k.ox, iy: k.oy, ox: k.ix, oy: k.iy });
  }
  return out;
}

export type ShapePath = {
  /** 文档绝对坐标下的 SVG path data */
  d: string;
  box: Box;
  fillRule: 'nonzero' | 'evenodd';
};

const EPS = 1e-6;

function samePoint(ax: number, ay: number, bx: number, by: number): boolean {
  return Math.abs(ax - bx) < EPS && Math.abs(ay - by) < EPS;
}

/**
 * 把 vectorMask.paths 合成一条 SVG path。
 * nonzero 填充下，subtract/exclude 的子路径要反向才能挖洞；
 * evenodd 填充与方向无关，直接拼接。
 *
 * dx/dy 用于把文档绝对坐标平移成 SVG 局部坐标——Figma 的 SVG 导入
 * 对 viewBox="0 0 w h" 是可靠的，对带偏移的 viewBox 未经验证，所以
 * 一律平移坐标而不是移动 viewBox 原点。返回的 box 同样已平移。
 */
export function buildShapePath(paths: BezierPath[], dx = 0, dy = 0): ShapePath | null {
  if (!paths || paths.length === 0) return null;

  const anyEvenOdd = paths.some((p) => p && p.fillRule === 'even-odd');
  const fillRule: 'nonzero' | 'evenodd' = anyEvenOdd ? 'evenodd' : 'nonzero';
  const box = emptyBox();
  let d = '';

  for (const path of paths) {
    const raw = (path?.knots || []).filter(k => Array.isArray(k?.points) && k.points.length === 6 && k.points.every(Number.isFinite));
    if (raw.length === 0) continue;

    const op = path.operation;
    const needReverse =
      fillRule === 'nonzero' && (op === 'subtract' || op === 'exclude');
    const knots = needReverse ? reversedKnots(raw.map(k => toKnot(k.points))) : raw.map(k => toKnot(k.points));

    const closed = !path.open;
    extendBox(box, knots[0].cx + dx, knots[0].cy + dy);
    d += `M${n(knots[0].cx + dx)} ${n(knots[0].cy + dy)}`;

    const segCount = closed ? knots.length : knots.length - 1;
    for (let i = 0; i < segCount; i++) {
      const from = knots[i];
      const to = knots[(i + 1) % knots.length];
      const straight =
        samePoint(from.ox, from.oy, from.cx, from.cy) && samePoint(to.ix, to.iy, to.cx, to.cy);
      if (straight) {
        d += `L${n(to.cx + dx)} ${n(to.cy + dy)}`;
      } else {
        d += `C${n(from.ox + dx)} ${n(from.oy + dy)} ${n(to.ix + dx)} ${n(to.iy + dy)} ${n(to.cx + dx)} ${n(to.cy + dy)}`;
      }
      extendBoxCubic(
        box,
        from.cx + dx,
        from.cy + dy,
        from.ox + dx,
        from.oy + dy,
        to.ix + dx,
        to.iy + dy,
        to.cx + dx,
        to.cy + dy,
      );
    }
    if (closed) d += 'Z';
    d += ' ';
  }

  if (!d.trim() || !Number.isFinite(box.minX)) return null;
  return { d: d.trim(), box, fillRule };
}

// ---------- 填充 / 描边 ----------

export type SvgPaint = {
  /** fill="..." / stroke="..." 的取值 */
  ref: string;
  /** fill-opacity / stroke-opacity */
  opacity: number;
  /** 需要放进 <defs> 的内容 */
  defs: string;
};

function solidPaint(c: RGB): SvgPaint {
  const { hex, opacity } = splitColor(c);
  return { ref: hex, opacity, defs: '' };
}

function sampleOpacity(stops: { offset: number; opacity: number }[], at: number): number {
  if (stops.length === 0) return 1;
  if (at <= stops[0].offset) return stops[0].opacity;
  const last = stops[stops.length - 1];
  if (at >= last.offset) return last.opacity;
  for (let i = 1; i < stops.length; i++) {
    if (at <= stops[i].offset) {
      const a = stops[i - 1];
      const b = stops[i];
      const span = b.offset - a.offset;
      const t = span > EPS ? (at - a.offset) / span : 0;
      return a.opacity + (b.opacity - a.opacity) * t;
    }
  }
  return 1;
}

/**
 * VectorContent → SVG paint。渐变用 gradientUnits="userSpaceOnUse"，
 * 因为 Figma 的 SVG 导入不支持 objectBoundingBox。
 * box 必须是已平移到 SVG 局部坐标的包围盒（见 buildShapePath 的 dx/dy）。
 */
export function paintToSvg(
  content: any,
  box: Box,
  id: string,
  warns: Warns,
): SvgPaint | null {
  if (!content) return null;

  if (content.type === 'color') {
    const c = colorToRgb(content.color);
    return c ? solidPaint(c) : null;
  }

  if (content.type === 'pattern') {
    warns.warn('pattern-fill', '图案填充无法转为矢量，已忽略（可改用原始位图图层）');
    return null;
  }

  if (content.type !== 'solid') {
    warns.warn('noise-gradient', '杂色渐变无法转为矢量，已忽略');
    return null;
  }

  const stops: { offset: number; color: RGB; opacity: number }[] = [];
  const opStops = (content.opacityStops || [])
    .map((s: any) => ({ offset: clamp01(s.location), opacity: clamp01(s.opacity) }))
    .sort((a: any, b: any) => a.offset - b.offset);

  for (const s of content.colorStops || []) {
    const c = colorToRgb(s.color);
    if (!c) continue;
    const offset = content.reverse ? 1 - clamp01(s.location) : clamp01(s.location);
    stops.push({ offset, color: c, opacity: sampleOpacity(opStops, clamp01(s.location)) });
  }
  if (stops.length < 2) return null;
  stops.sort((a, b) => a.offset - b.offset);

  const w = boxWidth(box);
  const h = boxHeight(box);
  const scale = content.scale ?? 1;
  const cx = box.minX + w * (0.5 + (content.offset?.x ?? 0));
  const cy = box.minY + h * (0.5 + (content.offset?.y ?? 0));

  const stopXml = stops
    .map((s) => {
      const { hex, opacity } = splitColor(s.color);
      const a = opacity * s.opacity;
      return `<stop offset="${n(s.offset)}" stop-color="${hex}"${a < 1 ? ` stop-opacity="${n(a)}"` : ''}/>`;
    })
    .join('');

  const style = content.style || 'linear';
  if (style === 'radial') {
    const rx = Math.max(EPS, (w / 2) * scale);
    const ry = Math.max(EPS, (h / 2) * scale);
    const squash = ry / rx;
    return {
      ref: `url(#${id})`,
      opacity: 1,
      defs:
        `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
        `cx="${n(cx)}" cy="${n(cy)}" r="${n(rx)}" ` +
        `gradientTransform="translate(${n(cx)} ${n(cy)}) scale(1 ${n(squash)}) translate(${n(-cx)} ${n(-cy)})">` +
        `${stopXml}</radialGradient>`,
    };
  }

  if (style !== 'linear') {
    warns.warn(`gradient-${style}`, `「${style}」渐变 Figma/SVG 不支持，已按线性渐变近似`);
  }

  // Photoshop 角度：0° 为从左到右，逆时针为正；屏幕坐标 y 向下所以取负
  const rad = ((content.angle ?? 0) * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = -Math.sin(rad);
  const len = Math.max(EPS, (Math.abs(w * ux) + Math.abs(h * uy)) * scale);
  return {
    ref: `url(#${id})`,
    opacity: 1,
    defs:
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
      `x1="${n(cx - (ux * len) / 2)}" y1="${n(cy - (uy * len) / 2)}" ` +
      `x2="${n(cx + (ux * len) / 2)}" y2="${n(cy + (uy * len) / 2)}">` +
      `${stopXml}</linearGradient>`,
  };
}
