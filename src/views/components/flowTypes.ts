/**
 * React Flow Type Definitions & Defaults for MindMap
 * Shared types used across layout engine, components, and hooks
 */
import type { Direction } from '../../types';

export interface LayoutOptions {
    direction: Direction;
    nodeWidth: number;
    nodeHeight: number;
    horizontalGap: number;
    verticalGap: number;
    fontSize?: number;
    fontFamily?: string;
    lineWidth: number;
    compact?: boolean;
}

// Add index signature to satisfy React Flow's Record<string, unknown> requirement
export interface MindMapNodeData {
    [key: string]: unknown;
    id: string;
    topic: string;
    filepath: string;
    isImage?: boolean;
    imageUrl?: string;
    hasContent?: boolean;
    expanded: boolean;
    hasChildren: boolean;
    isRoot: boolean;
    depth: number;
    onToggleExpand?: (nodeId: string) => void;
    onNodeRename?: (nodeId: string, newTopic: string) => void;
    isDragging?: boolean;
    dropZone?: 'above' | 'child' | 'below' | null;
    startEditTs?: number;
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
    direction: 1, // Right
    nodeWidth: 150, // Default minimum width
    nodeHeight: 40,
    horizontalGap: 50,
    verticalGap: 40, // Increased for safer margins
    fontSize: 14,
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    lineWidth: 1,
    compact: false,
};
