// 解析器统一入口：根据文件扩展名 / 内容分发
import type { ParseResult, ParseOptions } from '../types';
import { parseAIorEPS } from './aiEps';
import { parsePSD } from './psd';

export type FileKind = 'ai' | 'eps' | 'psd';

export function detectKind(fileName: string, data: ArrayBuffer): FileKind | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.ai')||lower.endsWith('.pdf')) return 'ai';
  if (lower.endsWith('.eps') || lower.endsWith('.ps')) return 'eps';
  if (lower.endsWith('.psd') || lower.endsWith('.psb')) return 'psd';

  // 内容嗅探
  const bytes = new Uint8Array(data);
  const header = new TextDecoder('latin1').decode(bytes.subarray(0, 64));
  if (header.startsWith('8BPS')) return 'psd';
  if (header.includes('%PDF')) return 'ai';
  if (header.startsWith('%!PS')) return 'eps';
  return null;
}

export async function parseFile(
  fileName: string,
  data: ArrayBuffer,
  onProgress?: (percent: number, msg: string) => void,
  options: ParseOptions = {},
): Promise<ParseResult> {
  const kind = detectKind(fileName, data);
  if (!kind) {
    throw new Error('不支持的文件格式：请选择 PDF / AI / EPS / PS / PSD / PSB 文件');
  }

  switch (kind) {
    case 'ai':
    case 'eps':
      return parseAIorEPS(data, onProgress, options);
    case 'psd':
      return parsePSD(data, onProgress, options);
    default:
      throw new Error('不支持的格式');
  }
}
