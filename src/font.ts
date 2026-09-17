// PostScript 字体名 → Figma 字体（family / style）的映射。
// PSD 与 PDF 里存的都是 PostScript 名（如 "ABCDEF+HelveticaNeue-BoldItalic"），
// Figma 需要 family + style 两段，且各字体的 style 命名并不统一，
// 所以这里产出「候选 family 列表 + 猜测的 style」，由主线程对着
// figma.listAvailableFontsAsync() 的结果做实际匹配与降级。

const SUBSET_PREFIX = /^[A-Za-z]{6}\+/;

/** 常见 PostScript family 名 → 桌面字体注册名 */
const FAMILY_ALIASES: Record<string, string> = {
  arialmt: 'Arial',
  arial: 'Arial',
  helveticaneue: 'Helvetica Neue',
  helvetica: 'Helvetica',
  timesnewromanpsmt: 'Times New Roman',
  timesnewroman: 'Times New Roman',
  pingfangsc: 'PingFang SC',
  pingfangtc: 'PingFang TC',
  pingfanghk: 'PingFang HK',
  microsoftyahei: 'Microsoft YaHei',
  microsoftyaheiui: 'Microsoft YaHei UI',
  simhei: 'SimHei',
  simsun: 'SimSun',
  notosanssc: 'Noto Sans SC',
  notosanstc: 'Noto Sans TC',
  notosanscjksc: 'Noto Sans CJK SC',
  sourcehansanscn: 'Source Han Sans CN',
  sourcehansanssc: 'Source Han Sans SC',
  sourcehanserifcn: 'Source Han Serif CN',
  sfprotext: 'SF Pro Text',
  sfprodisplay: 'SF Pro Display',
  sfuitext: 'SF UI Text',
  sfuidisplay: 'SF UI Display',
  roboto: 'Roboto',
  inter: 'Inter',
};

const WEIGHT_PATTERNS: Array<[RegExp, string]> = [
  [/extrablack|ultrablack/i, 'Black'],
  [/extrabold|ultrabold/i, 'Extra Bold'],
  [/semibold|demibold/i, 'Semi Bold'],
  [/extralight|ultralight/i, 'Extra Light'],
  [/black|heavy/i, 'Black'],
  [/bold|fett/i, 'Bold'],
  [/thin|hairline/i, 'Thin'],
  [/semilight|demilight/i, 'Light'],
  [/light|mager/i, 'Light'],
  [/medium/i, 'Medium'],
];

const ITALIC_RE = /italic|oblique|kursiv/i;

export type FontRef = {
  /** 去掉子集前缀与 style 后缀的原始 family 名 */
  raw: string;
  /** 依优先级排列的候选 family 名 */
  candidates: string[];
  /** 猜测的 Figma style 名 */
  style: string;
  bold: boolean;
  italic: boolean;
};

/** "HelveticaNeue" → "Helvetica Neue"（CJK 字体名不受影响，因为不含 ASCII 驼峰） */
function spacedCamelCase(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
}

export function parseFontName(name: string | undefined | null): FontRef {
  if (!name) {
    return { raw: '', candidates: [], style: 'Regular', bold: false, italic: false };
  }

  const cleaned = name.replace(SUBSET_PREFIX, '').trim();
  const dash = cleaned.lastIndexOf('-');
  const familyPart = dash >= 0 ? cleaned.slice(0, dash) : cleaned;
  const stylePart = dash >= 0 ? cleaned.slice(dash + 1) : '';

  // Adobe 的 PostScript 名常带 MT / PS / PSMT 这类实现后缀
  const normStyle = stylePart.replace(/(PSMT|PS|MT)$/g, '');
  const normFamily = familyPart.replace(/(PSMT|PS|MT)$/g, '');

  const bold = WEIGHT_PATTERNS.some(([re]) => re.test(normStyle)) && /bold|black|heavy|fett/i.test(normStyle);
  const italic = ITALIC_RE.test(normStyle);

  let style = 'Regular';
  for (const [re, label] of WEIGHT_PATTERNS) {
    if (re.test(normStyle)) {
      style = label;
      break;
    }
  }
  if (italic) style = style === 'Regular' ? 'Italic' : `${style} Italic`;

  const alias = FAMILY_ALIASES[normFamily.toLowerCase().replace(/[^a-z0-9]/g, '')];

  const candidates: string[] = [];
  const push = (v: string | undefined) => {
    const t = (v || '').trim();
    if (t && !candidates.includes(t)) candidates.push(t);
  };
  push(alias);
  push(spacedCamelCase(normFamily));
  push(normFamily);
  push(spacedCamelCase(cleaned));

  return { raw: normFamily, candidates, style, bold, italic };
}

/** fauxBold / fauxItalic（PSD 的「仿粗体/仿斜体」）会让实际需要的 style 升级 */
export function applyFaux(ref: FontRef, fauxBold?: boolean, fauxItalic?: boolean): FontRef {
  const bold = ref.bold || !!fauxBold;
  const italic = ref.italic || !!fauxItalic;
  if (bold === ref.bold && italic === ref.italic) return ref;

  const weight = fauxBold && !ref.bold ? 'Bold' : (ref.style.replace(/ ?Italic$/, '') || 'Regular');
  const style = italic ? (weight === 'Regular' ? 'Italic' : `${weight} Italic`) : weight;
  return { ...ref, bold, italic, style };
}
