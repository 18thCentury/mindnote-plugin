/**
 * MindNote Core Types
 * Defines all interfaces and types used across the plugin
 */

// ============================================================================
// Node & Map Data Structures
// ============================================================================

/**
 * Represents a single node in the mindmap
 */
export interface MindNode {
    id: string;
    topic: string;
    filepath: string;       // Relative path under md/ (e.g., "topic.md" or "Parent/topic.md")
    children: MindNode[];
    expanded: boolean;
    isImage?: boolean;      // True if this is an image node
    imageUrl?: string;      // Relative path to image in img/ folder
}

/**
 * Root structure of map.mn file
 */
export interface MindMapData {
    nodeData: MindNode;
}

// ============================================================================
// Settings
// ============================================================================

export type Direction = 0 | 1 | 2;  // 0:Left, 1:Right, 2:Both
export type Theme = 'primary' | 'dark' | 'auto';

export interface MindNoteSettings {
    direction: Direction;
    theme: Theme;
    horizontalGap: number;      // --node-gap-x
    verticalGap: number;        // --node-gap-y
    mainHorizontalGap: number;  // --main-gap-x
    mainVerticalGap: number;    // --main-gap-y
    topicPadding: number;       // --topic-padding
    nodeRadius: number;         // --main-radius
    rootRadius: number;         // --root-radius
    lineWidth: number;          // stroke-width
    caseSensitiveFilenames: boolean;
    compact: boolean;           // compact layout mode
}

export const DEFAULT_SETTINGS: MindNoteSettings = {
    direction: 1,
    theme: 'primary',
    horizontalGap: 10,
    verticalGap: 5,
    mainHorizontalGap: 5,
    mainVerticalGap: 5,
    topicPadding: 5,
    nodeRadius: 3,
    rootRadius: 3,
    lineWidth: 1,
    caseSensitiveFilenames: false,
    compact: false,
};

// ============================================================================
// Transaction & Queue Types
// ============================================================================

export type FileOperationType = 'create' | 'rename' | 'delete';

export interface FileOperation {
    type: FileOperationType;
    originalPath?: string;
    newPath?: string;
    originalContent?: string;
}

export interface TransactionContext {
    id: string;
    mapSnapshot: string;
    fileOperations: FileOperation[];
    status: 'pending' | 'committed' | 'rolledback';
}

export interface QueuedOperation {
    id: string;
    type: 'create' | 'rename' | 'delete' | 'move';
    nodeId: string;
    data: unknown;
    timestamp: number;
}

// ============================================================================
// History Types
// ============================================================================

export type HistoryActionType = 'CREATE' | 'DELETE' | 'RENAME' | 'MOVE' | 'EDIT';

export interface ResourceSnapshot {
    path: string;
    content: ArrayBuffer | string;
}

export interface HistoryEntry {
    type: HistoryActionType;
    timestamp: number;
    nodeData: MindNode;
    previousState?: unknown;
    resources?: ResourceSnapshot[];
}

// ============================================================================
// View Constants
// ============================================================================

export const VIEW_TYPE_MINDNOTE = 'mindnote-view';
export const FILE_EXTENSION_MN = '.mn';
export const MAP_FILE_NAME = 'map.mn';
