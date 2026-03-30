/**
 * Lightweight pretext-compatible adapter used by MindNote.
 *
 * Why adapter instead of direct dependency:
 * - runtime environment currently cannot fetch npm/github packages reliably
 * - keep an API shape close to @chenglou/pretext (prepare + layout hot path)
 *
 * Scope of this adapter:
 * - supports node-label measurement (single-line + hard breaks)
 * - exposes pure arithmetic layout over prepared cached widths
 */

export interface PreparedText {
    text: string;
    font: string;
    graphemes: string[];
    graphemeWidths: number[];
    totalWidth: number;
}

export interface LayoutResult {
    width: number;
    height: number;
    lineCount: number;
}

let measurementCanvasContext: CanvasRenderingContext2D | null = null;
const graphemeWidthCache = new Map<string, number>();
const preparedCache = new Map<string, PreparedText>();

function getMeasurementContext(): CanvasRenderingContext2D | null {
    if (measurementCanvasContext) return measurementCanvasContext;
    if (typeof document === 'undefined') return null;

    const canvas = document.createElement('canvas');
    measurementCanvasContext = canvas.getContext('2d');
    return measurementCanvasContext;
}

function splitGraphemes(text: string): string[] {
    const intlWithSegmenter = Intl as typeof Intl & { Segmenter?: any };
    if (typeof Intl !== 'undefined' && intlWithSegmenter.Segmenter) {
        const segmenter = new intlWithSegmenter.Segmenter(undefined, { granularity: 'grapheme' });
        return Array.from(segmenter.segment(text), s => s.segment);
    }
    return Array.from(text);
}

function measureGrapheme(ctx: CanvasRenderingContext2D | null, grapheme: string, font: string): number {
    if (!ctx) return grapheme.length * 8;
    const cacheKey = `${font}::${grapheme}`;
    const cached = graphemeWidthCache.get(cacheKey);
    if (cached !== undefined) return cached;

    ctx.font = font;
    const measured = ctx.measureText(grapheme).width;
    graphemeWidthCache.set(cacheKey, measured);
    return measured;
}

export function prepare(text: string, font: string): PreparedText {
    const normalizedText = text || ' ';
    const cacheKey = `${font}__${normalizedText}`;
    const cached = preparedCache.get(cacheKey);
    if (cached) return cached;

    const ctx = getMeasurementContext();
    const graphemes = splitGraphemes(normalizedText);
    const graphemeWidths = graphemes.map(g => measureGrapheme(ctx, g, font));
    const totalWidth = graphemeWidths.reduce((sum, w) => sum + w, 0);

    const prepared: PreparedText = {
        text: normalizedText,
        font,
        graphemes,
        graphemeWidths,
        totalWidth,
    };
    preparedCache.set(cacheKey, prepared);
    return prepared;
}

/**
 * Similar to pretext layout hot path: pure arithmetic line breaking over prepared widths.
 */
export function layout(prepared: PreparedText, maxWidth: number, lineHeight: number): LayoutResult {
    if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
        return { width: prepared.totalWidth, height: lineHeight, lineCount: 1 };
    }

    let lineWidth = 0;
    let maxLineWidth = 0;
    let lineCount = 1;

    for (let i = 0; i < prepared.graphemes.length; i++) {
        const g = prepared.graphemes[i];
        const w = prepared.graphemeWidths[i];

        if (g === '\n') {
            maxLineWidth = Math.max(maxLineWidth, lineWidth);
            lineWidth = 0;
            lineCount += 1;
            continue;
        }

        if (lineWidth + w > maxWidth && lineWidth > 0) {
            maxLineWidth = Math.max(maxLineWidth, lineWidth);
            lineWidth = w;
            lineCount += 1;
            continue;
        }

        lineWidth += w;
    }

    maxLineWidth = Math.max(maxLineWidth, lineWidth);
    return {
        width: maxLineWidth,
        height: lineCount * lineHeight,
        lineCount,
    };
}
