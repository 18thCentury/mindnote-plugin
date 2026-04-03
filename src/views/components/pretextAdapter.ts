import {
    prepareWithSegments,
    walkLineRanges,
    layout as pretextLayout,
    type PreparedTextWithSegments,
} from '@chenglou/pretext';

export interface PreparedText {
    prepared: PreparedTextWithSegments | null;
    text: string;
    font: string;
}

export interface LayoutResult {
    width: number;
    height: number;
    lineCount: number;
}

const preparedCache = new Map<string, PreparedText>();

function normalizeText(text: string): string {
    return text.length === 0 ? ' ' : text;
}

function fallbackLayout(text: string, lineHeight: number): LayoutResult {
    const safeText = normalizeText(text);
    const lines = safeText.split('\n');
    const estimatedWidth = Math.max(...lines.map(line => line.length * 8));
    const lineCount = Math.max(1, lines.length);
    return {
        width: estimatedWidth,
        height: lineCount * lineHeight,
        lineCount,
    };
}

export function prepare(text: string, font: string): PreparedText {
    const normalizedText = normalizeText(text);
    const cacheKey = `${font}__${normalizedText}`;
    const cached = preparedCache.get(cacheKey);
    if (cached) return cached;

    let prepared: PreparedTextWithSegments | null = null;
    try {
        prepared = prepareWithSegments(normalizedText, font);
    } catch {
        prepared = null;
    }

    const result: PreparedText = {
        prepared,
        text: normalizedText,
        font,
    };
    preparedCache.set(cacheKey, result);
    return result;
}

export function layout(prepared: PreparedText, maxWidth: number, lineHeight: number): LayoutResult {
    if (!prepared.prepared || !Number.isFinite(maxWidth) || maxWidth <= 0) {
        return fallbackLayout(prepared.text, lineHeight);
    }

    try {
        const layoutResult = pretextLayout(prepared.prepared, maxWidth, lineHeight);
        let maxLineWidth = 0;
        walkLineRanges(prepared.prepared, maxWidth, line => {
            if (line.width > maxLineWidth) {
                maxLineWidth = line.width;
            }
        });

        return {
            width: maxLineWidth,
            height: layoutResult.height,
            lineCount: layoutResult.lineCount,
        };
    } catch {
        return fallbackLayout(prepared.text, lineHeight);
    }
}

export function measureNaturalTextWidth(text: string, font: string): number {
    const prepared = prepare(text, font);
    const { width } = layout(prepared, Number.MAX_SAFE_INTEGER, 1);
    return width;
}
