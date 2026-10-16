/** Scene v2: source units, bottom-to-top paint order. Group matrices transform
 * the entire child space; leaf matrices transform local geometry. */
export type RGB = { r: number; g: number; b: number; a?: number };
export type Matrix = [number, number, number, number, number, number];
export type Fidelity = 'editable' | 'outlined-text' | 'original-image' | 'rasterized' | 'unsupported';
export type Diagnostic = { sourceId: string; name: string; status: Fidelity; code: string; message: string; nodeId?: string; recovery?: boolean;
  issues?: {code:string;message:string}[]; strokeAppearance?: 'unchanged'|'needs-review' };
export type Paint = {
  type: 'SOLID' | 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR' | 'GRADIENT_DIAMOND';
  color?: RGB; opacity?: number; blendMode?: string;
  stops?: { position: number; color: RGB }[];
  /** Local geometry -> gradient unit square. */ transform?: Matrix;
};
export type Effect = { type: 'DROP_SHADOW' | 'INNER_SHADOW' | 'LAYER_BLUR';
  color?: RGB; offset?: { x: number; y: number }; radius: number; spread?: number; blendMode?: string };
export type Common = {
  name: string; sourceId?: string; sourceType?: string; sourceAssetId?: string;
  opacity?: number; visible?: boolean; blendMode?: string; transform?: Matrix;
  effects?: Effect[]; overlays?: Paint[]; fidelity?: Fidelity; issues?: { code: string; message: string }[];
  /** Opaque normal PSD overlay on native vector paths; reference pixels -> parent space. */
  vectorOverlay?: {paints:Paint[];reference:Matrix};
  recovery?: boolean;
  /** Proven against a fixed opaque white artboard backdrop; original paints stay in source data. */
  whiteBackdropBlend?: { sourceMode: 'hard mix'; artboardId: string };
  sourceData?: Record<string,unknown>;
};
export type PathPart = { data: string; windingRule: 'EVENODD' | 'NONZERO';
  operation?: 'combine' | 'subtract' | 'intersect' | 'exclude' };
export type ParsedVector = Common & {
  kind: 'vector'; svg?: string; paths?: PathPart[];
  x: number; y: number; width: number; height: number;
  fills?: Paint[]; strokes?: Paint[]; strokeWidth?: number;
  strokeAlign?: 'CENTER' | 'INSIDE' | 'OUTSIDE';
  strokeCap?: 'NONE' | 'ROUND' | 'SQUARE'; strokeJoin?: 'MITER' | 'ROUND' | 'BEVEL';
  dashPattern?: number[]; miterLimit?: number;
};
export type ParsedImage = Common & { kind: 'image'; bytes?: Uint8Array; resourceId?: string;
  x: number; y: number; width: number; height: number };
export type ParsedFont = { candidates: string[]; style: string; postScriptName?: string };
export type PdfTextPaints={fills:Paint[];strokes:Paint[];strokeWidth:number;reference:Matrix};
export type ParsedTextStyleRun = { length: number; fontSize?: number; font?: ParsedFont;
  color?: RGB; tracking?: number; leading?: number; paragraphIndent?:number; pdfFills?:Paint[];pdfReference?:Matrix };
export type ParsedText = Common & {
  textOverlay?: {paints:Paint[];reference:Matrix};
  pdfTextPaints?: PdfTextPaints;
  pdfLayout?:{object:number;span:number;tag?:string;vertical?:boolean;advance:number;
    bounds?:{x:number;y:number;width:number;height:number};paragraph?:boolean;lineCount?:number;sourceIds?:string[]};
  kind: 'text'; characters: string; x: number; y: number; width?: number; height?: number;
  fontSize?: number; font?: ParsedFont; color?: RGB; fillOpacity?: number; tracking?: number; leading?: number;
  align?: 'left' | 'center' | 'right'; box?: boolean; styleRuns?: ParsedTextStyleRun[];
  inkBounds?: { x: number; y: number; width: number; height: number };
  baseline?: number; fallback?: ParsedImage | ParsedVector;
};
export type ParsedGroup = Common & { kind: 'group'; children: ParsedNode[] };
export type ParsedFrame = Common & { kind: 'frame'; x: number; y: number; width: number;
  height: number; children: ParsedNode[]; fills?: Paint[]; clip: boolean; artboard?: boolean };
export type ParsedMask = Common & { kind: 'mask'; mask: ParsedNode; maskType: 'VECTOR' | 'ALPHA' | 'LUMINANCE'; children: ParsedNode[] };
export type ParsedNode = ParsedGroup | ParsedFrame | ParsedMask | ParsedVector | ParsedImage | ParsedText;
export type ParseStats = { groups: number; vectors: number; images: number; texts: number;
  artboards: number; masks: number; outlinedTexts: number; rasterized: number; unsupported: number };
export type ParseResult = { version: 2; width: number; height: number; nodes: ParsedNode[];
  warnings: string[]; diagnostics: Diagnostic[]; resources: Record<string, Uint8Array>;
  stats: ParseStats; reference?: string };
export type ParseOptions = { signal?: { readonly aborted: boolean }; depth?: number; ancestry?: string[]; batchPaths?:boolean };
export function emptyStats(): ParseStats {
  return { groups: 0, vectors: 0, images: 0, texts: 0, artboards: 0, masks: 0, outlinedTexts: 0, rasterized: 0, unsupported: 0 };
}
export function childrenOf(n: ParsedNode): ParsedNode[] {
  return n.kind === 'mask' ? [n.mask, ...n.children] : 'children' in n ? n.children : [];
}
export function countStats(nodes: ParsedNode[], stats = emptyStats()): ParseStats {
  for (const n of nodes) {
    if (n.recovery) continue;
    if (n.kind === 'group' || n.kind === 'frame') stats.groups++;
    if (n.kind === 'frame' && n.artboard) stats.artboards++;
    if (n.kind === 'mask') stats.masks++;
    if (n.kind === 'vector') stats.vectors++;
    if (n.kind === 'text') stats.texts++;
    if (n.kind === 'image') stats.images++;
    if (n.fidelity === 'outlined-text') stats.outlinedTexts++;
    if (n.fidelity === 'rasterized') stats.rasterized++;
    if (n.fidelity === 'unsupported') stats.unsupported++;
    countStats(childrenOf(n), stats);
  }
  return stats;
}

