// 共享的 canvas / PNG 工具。
// PSD 与 AI/EPS 两个解析器都要把位图像素压到 figma.createImage() 的上限内，
// 逻辑完全一样，放在这里避免各写一份。
import type { Warns } from './util';

/** figma.createImage() 的硬上限：宽/高最大 4096px，超了会直接抛异常 */
export const MAX_IMAGE_DIM = 4096;

export const DOWNSCALE_WARNING = `有位图超过 Figma 单图 ${MAX_IMAGE_DIM}px 上限，像素已等比缩小（图层显示尺寸保持不变）`;

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export async function toPng(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  try {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b: Blob | null) => resolve(b), 'image/png'),
    );
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * 超过 Figma 单图上限就等比缩小像素。
 * 只缩像素，不缩显示尺寸——调用方仍然按原始 width/height 摆放图层。
 */
export function downscaleToLimit(
  canvas: HTMLCanvasElement,
  warns: Warns,
  key = 'downscale',
): HTMLCanvasElement {
  const maxDim = Math.max(canvas.width, canvas.height);
  if (maxDim <= MAX_IMAGE_DIM) return canvas;
  const k = MAX_IMAGE_DIM / maxDim;
  const out = createCanvas(canvas.width * k, canvas.height * k);
  const octx = out.getContext('2d');
  if (!octx) return canvas;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(canvas, 0, 0, out.width, out.height);
  warns.warn(key, DOWNSCALE_WARNING);
  return out;
}
