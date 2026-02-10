/**
 * Layout Utilities for React Flow Mindmap
 * Uses Dagre for hierarchical tree layout with collapse/expand support
 */
import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';
import type { MindNode, Direction } from '../../types';

export interface LayoutOptions {
    direction: Direction;
    nodeWidth: number;
    nodeHeight: number;
    horizontalGap: number;
    verticalGap: number;
    fontSize?: number;
    fontFamily?: string;
    lineWidth: number;
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

const DEFAULT_OPTIONS: LayoutOptions = {
    direction: 1, // Right
    nodeWidth: 150, // Default minimum width
    nodeHeight: 40,
    horizontalGap: 50,
    verticalGap: 40, // Increased for safer margins
    fontSize: 14,
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    lineWidth: 1,
};

// Helper to get computed styles for measurement
let measurementContainer: HTMLDivElement | null = null;

function getMeasurementContainer(): HTMLDivElement {
    if (!measurementContainer) {
        measurementContainer = document.createElement('div');
        measurementContainer.style.position = 'absolute';
        measurementContainer.style.visibility = 'hidden';
        measurementContainer.style.top = '-9999px';
        measurementContainer.style.left = '-9999px';
        document.body.appendChild(measurementContainer);
    }
    return measurementContainer;
}

function measureNodeDimensions(
    topic: string,
    isImage: boolean,
    isRoot: boolean,
    hasContent: boolean,
    hasChildren: boolean,
    options: LayoutOptions
): { width: number, height: number } {
    if (isImage) {
        // Approximate image dimensions + padding. 
        // Sync these with MindMapNode.tsx/styles.css (.mindmap-node-image)
        return {
            width: Math.max(120, options.nodeWidth),
            height: 100 // 80px image max + 20px padding/margins
        };
    }

    if (typeof document === 'undefined') {
        // Fallback for non-DOM environments (like Vitest in Node)
        return {
            width: Math.max(80, topic.length * 8 + (hasContent ? 20 : 0)),
            height: 40
        };
    }

    const container = getMeasurementContainer();
    const tempNode = document.createElement('div');
    tempNode.className = `mindmap-node ${isRoot ? 'mindmap-node-root' : ''}`;
    tempNode.style.width = 'max-content';
    tempNode.style.display = 'inline-block';
    tempNode.style.visibility = 'hidden';
    tempNode.style.position = 'absolute';

    const content = document.createElement('div');
    content.className = 'mindmap-node-content';
    content.style.display = 'flex';
    content.style.alignItems = 'center';
    content.style.gap = '6px';

    if (hasContent) {
        const indicator = document.createElement('span');
        indicator.className = 'mindmap-content-indicator';
        indicator.textContent = '📝';
        content.appendChild(indicator);
    }

    const topicSpan = document.createElement('span');
    topicSpan.className = 'mindmap-node-topic';
    topicSpan.textContent = topic;

    content.appendChild(topicSpan);
    tempNode.appendChild(content);
    container.appendChild(tempNode);

    const width = tempNode.offsetWidth;
    const height = tempNode.offsetHeight;

    container.removeChild(tempNode);

    // Padding and safety margins: 
    // Sync with styles.css: padding: 8px 12px; + 6px gap
    // Adding 10px extra for handles and toggle safely
    const toggleBuffer = hasChildren ? 15 : 0;
    return {
        width: Math.max(40, width + toggleBuffer + 10),
        height: Math.max(options.nodeHeight, height + 4)
    };
}

/**
 * Convert MindNode tree to flat arrays of nodes and edges for React Flow
 * Respects expanded state for collapse/expand
 */
export function convertToFlowElements(
    root: MindNode,
    options: Partial<LayoutOptions> = {},
    contentMap: Map<string, boolean> = new Map(),
    callbacks?: {
        onToggleExpand?: (nodeId: string) => void;
        onNodeRename?: (nodeId: string, newTopic: string) => void;
        editTrigger?: { id: string; ts: number } | null;
        resolveImageUrl?: (relativePath: string) => string;
    }
): { nodes: Node<MindMapNodeData>[]; edges: Edge[] } {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const nodes: Node<MindMapNodeData>[] = [];
    const edges: Edge[] = [];

    function traverse(node: MindNode, depth: number = 0, parentId?: string): void {
        const hasChildren = node.children && node.children.length > 0;
        const hasContent = contentMap.get(node.id) ?? false;

        let imageUrl = node.imageUrl;
        if (node.isImage && node.imageUrl && callbacks?.resolveImageUrl) {
            try {
                imageUrl = callbacks.resolveImageUrl(node.imageUrl);
            } catch (e) {
                console.error('Failed to resolve image URL:', e);
            }
        }

        nodes.push({
            id: node.id,
            type: 'mindMapNode',
            position: { x: 0, y: 0 }, // Will be calculated by Dagre
            data: {
                id: node.id,
                topic: node.topic,
                filepath: node.filepath,
                isImage: node.isImage,
                imageUrl: imageUrl,
                hasContent,
                expanded: node.expanded !== false,
                hasChildren,
                isRoot: depth === 0,
                depth,
                onToggleExpand: callbacks?.onToggleExpand,
                onNodeRename: callbacks?.onNodeRename,
                startEditTs: callbacks?.editTrigger?.id === node.id ? callbacks.editTrigger.ts : undefined,
            },
        });

        if (parentId) {
            edges.push({
                id: `${parentId}-${node.id}`,
                source: parentId,
                target: node.id,
                type: 'smoothstep',
                style: { strokeWidth: opts.lineWidth },
            });
        }

        // Only traverse children if node is expanded
        if (hasChildren && node.expanded !== false) {
            for (const child of node.children) {
                traverse(child, depth + 1, node.id);
            }
        }
    }

    traverse(root);

    // Apply Dagre layout
    const layoutedNodes = applyDagreLayout(nodes, edges, opts);

    return { nodes: layoutedNodes, edges };
}

/**
 * Apply Dagre layout algorithm to position nodes
 */
function applyDagreLayout(
    nodes: Node<MindMapNodeData>[],
    edges: Edge[],
    options: LayoutOptions
): Node<MindMapNodeData>[] {
    // 1. Build parent -> children map from edges
    const parentToChildren = new Map<string, string[]>();
    edges.forEach(edge => {
        if (!parentToChildren.has(edge.source)) parentToChildren.set(edge.source, []);
        parentToChildren.get(edge.source)?.push(edge.target);
    });

    // 2. Measure all nodes and store dimensions
    const nodeDims = new Map<string, { width: number, height: number }>();
    nodes.forEach(node => {
        const dims = measureNodeDimensions(
            node.data.topic,
            !!node.data.isImage,
            !!node.data.isRoot,
            !!node.data.hasContent,
            !!node.data.hasChildren,
            options
        );
        nodeDims.set(node.id, dims);
    });

    // 3. First pass: Calculate height of each subtree recursively
    const subtreeHeights = new Map<string, number>();
    function calculateHeight(nodeId: string): number {
        const children = parentToChildren.get(nodeId) || [];
        const selfHeight = nodeDims.get(nodeId)!.height;

        if (children.length === 0) {
            subtreeHeights.set(nodeId, selfHeight);
            return selfHeight;
        }

        let totalChildrenHeight = 0;
        children.forEach((childId, index) => {
            totalChildrenHeight += calculateHeight(childId);
            if (index < children.length - 1) {
                totalChildrenHeight += options.verticalGap;
            }
        });

        // The subtree height is the total height of children, but we must ensure the parent has enough room if it's taller
        const h = Math.max(selfHeight, totalChildrenHeight);
        subtreeHeights.set(nodeId, h);
        return h;
    }

    const rootNodes = nodes.filter(n => n.data.isRoot);
    rootNodes.forEach(root => calculateHeight(root.id));

    // 4. Second pass: Assign coordinates recursively
    const finalPositions = new Map<string, { x: number, y: number }>();
    function assignCoords(nodeId: string, x: number, yCenter: number) {
        const dims = nodeDims.get(nodeId)!;
        const totalSubtreeHeight = subtreeHeights.get(nodeId)!;

        // Position current node centered vertically within its subtree space
        finalPositions.set(nodeId, {
            x,
            y: yCenter - dims.height / 2
        });

        const children = parentToChildren.get(nodeId) || [];
        if (children.length > 0) {
            const childrenX = x + dims.width + options.horizontalGap;

            // Total height of children block
            let totalChildrenHeight = 0;
            children.forEach((childId, index) => {
                totalChildrenHeight += subtreeHeights.get(childId)!;
                if (index < children.length - 1) totalChildrenHeight += options.verticalGap;
            });

            // Start positioning children at the top of their block
            let currentY = yCenter - totalChildrenHeight / 2;

            children.forEach(childId => {
                const childSubtreeHeight = subtreeHeights.get(childId)!;
                const childYCenter = currentY + childSubtreeHeight / 2;
                assignCoords(childId, childrenX, childYCenter);
                currentY += childSubtreeHeight + options.verticalGap;
            });
        }
    }

    // Start coordinate assignment
    let currentRootY = 0;
    rootNodes.forEach((root, index) => {
        const rootHeight = subtreeHeights.get(root.id)!;
        assignCoords(root.id, 20, currentRootY + rootHeight / 2);
        currentRootY += rootHeight + options.verticalGap * 2; // Extra gap between multiple roots
    });

    // Transfer final positions to nodes
    return nodes.map((node) => {
        const pos = finalPositions.get(node.id)!;
        const dims = nodeDims.get(node.id)!;

        return {
            ...node,
            position: pos,
            style: {
                width: dims.width,
            }
        };
    });
}

/**
 * Find a node by ID in the tree
 */
export function findNodeInTree(root: MindNode, id: string): MindNode | null {
    if (root.id === id) return root;
    if (root.children) {
        for (const child of root.children) {
            const found = findNodeInTree(child, id);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Toggle expanded state of a node
 */
export function toggleNodeExpanded(root: MindNode, id: string): MindNode {
    if (root.id === id) {
        return { ...root, expanded: !root.expanded };
    }
    if (root.children) {
        return {
            ...root,
            children: root.children.map((child) => toggleNodeExpanded(child, id)),
        };
    }
    return root;
}

/**
 * Add a child node to a parent
 */
export function addChildNode(root: MindNode, parentId: string, newNode: MindNode): MindNode {
    if (root.id === parentId) {
        return {
            ...root,
            children: [...(root.children || []), newNode],
            expanded: true, // Auto-expand when adding child
        };
    }
    if (root.children) {
        return {
            ...root,
            children: root.children.map((child) => addChildNode(child, parentId, newNode)),
        };
    }
    return root;
}

/**
 * Remove a node from the tree
 */
export function removeNode(root: MindNode, id: string): MindNode | null {
    if (root.id === id) {
        return null; // Remove this node
    }
    if (root.children) {
        return {
            ...root,
            children: root.children
                .map((child) => removeNode(child, id))
                .filter((child): child is MindNode => child !== null),
        };
    }
    return root;
}

/**
 * Update a node's topic
 */
export function updateNodeTopic(root: MindNode, id: string, topic: string): MindNode {
    if (root.id === id) {
        return { ...root, topic };
    }
    if (root.children) {
        return {
            ...root,
            children: root.children.map((child) => updateNodeTopic(child, id, topic)),
        };
    }
    return root;
}

// ============================================================================
// Drag and Drop Tree Operations
// ============================================================================

/**
 * Find the parent node of a given node ID
 */
export function findParentNode(root: MindNode, childId: string): MindNode | null {
    if (root.children) {
        for (const child of root.children) {
            if (child.id === childId) {
                return root;
            }
            const found = findParentNode(child, childId);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Check if a node is a descendant of another node
 */
function isDescendant(root: MindNode, ancestorId: string, descendantId: string): boolean {
    if (root.id === ancestorId) {
        return findNodeInTree(root, descendantId) !== null;
    }
    if (root.children) {
        for (const child of root.children) {
            if (isDescendant(child, ancestorId, descendantId)) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Validate if a node can be moved to a target location
 * Returns true if the move is valid, false otherwise
 */
export function canMoveNode(
    root: MindNode,
    nodeId: string,
    targetId: string,
    moveType: 'child' | 'sibling'
): boolean {
    // Cannot move root node
    if (root.id === nodeId) {
        return false;
    }

    // Cannot move to itself
    if (nodeId === targetId) {
        return false;
    }

    // Cannot move a parent into its own descendant
    if (isDescendant(root, nodeId, targetId)) {
        return false;
    }

    // For sibling moves, target must have a parent
    if (moveType === 'sibling') {
        const targetParent = findParentNode(root, targetId);
        if (!targetParent) {
            return false;
        }
    }

    return true;
}

/**
 * Move a node to become a child of the target node
 */
export function moveNodeAsChild(root: MindNode, nodeId: string, targetId: string): MindNode {
    if (!canMoveNode(root, nodeId, targetId, 'child')) {
        return root;
    }

    // Find the node to move
    const nodeToMove = findNodeInTree(root, nodeId);
    if (!nodeToMove) return root;

    // Remove node from its current location
    const treeWithoutNode = removeNode(root, nodeId);
    if (!treeWithoutNode) return root;

    // Add node as child of target
    return addChildNode(treeWithoutNode, targetId, nodeToMove);
}

/**
 * Move a node to become a sibling above the target node
 */
export function moveNodeAsSiblingAbove(root: MindNode, nodeId: string, targetId: string): MindNode {
    if (!canMoveNode(root, nodeId, targetId, 'sibling')) {
        return root;
    }

    // Find the node to move
    const nodeToMove = findNodeInTree(root, nodeId);
    if (!nodeToMove) return root;

    // Find target's parent
    const targetParent = findParentNode(root, targetId);
    if (!targetParent) return root;

    // Remove node from its current location
    const treeWithoutNode = removeNode(root, nodeId);
    if (!treeWithoutNode) return root;

    // Insert node above target in parent's children array
    const parentId = targetParent.id;
    const safeTree: MindNode = treeWithoutNode;
    function insertAbove(node: MindNode): MindNode {
        if (node.id === parentId) {
            const targetIndex = node.children.findIndex(child => child.id === targetId);
            if (targetIndex === -1) return node;

            const newChildren = [...node.children];
            newChildren.splice(targetIndex, 0, nodeToMove!);

            return {
                ...node,
                children: newChildren,
            };
        }

        if (node.children) {
            return {
                ...node,
                children: node.children.map(child => insertAbove(child)),
            };
        }

        return node;
    }

    return insertAbove(safeTree);
}

/**
 * Move a node to become a sibling below the target node
 */
export function moveNodeAsSiblingBelow(root: MindNode, nodeId: string, targetId: string): MindNode {
    if (!canMoveNode(root, nodeId, targetId, 'sibling')) {
        return root;
    }

    // Find the node to move
    const nodeToMove = findNodeInTree(root, nodeId);
    if (!nodeToMove) return root;

    // Find target's parent
    const targetParent = findParentNode(root, targetId);
    if (!targetParent) return root;

    // Remove node from its current location
    const treeWithoutNode = removeNode(root, nodeId);
    if (!treeWithoutNode) return root;

    // Insert node below target in parent's children array
    const parentId = targetParent.id;
    const safeTree: MindNode = treeWithoutNode;
    function insertBelow(node: MindNode): MindNode {
        if (node.id === parentId) {
            const targetIndex = node.children.findIndex(child => child.id === targetId);
            if (targetIndex === -1) return node;

            const newChildren = [...node.children];
            newChildren.splice(targetIndex + 1, 0, nodeToMove!);

            return {
                ...node,
                children: newChildren,
            };
        }

        if (node.children) {
            return {
                ...node,
                children: node.children.map(child => insertBelow(child)),
            };
        }

        return node;
    }

    return insertBelow(safeTree);
}

/**
 * Add a sibling node
 */
export function addSiblingNode(root: MindNode, siblingId: string, newNode: MindNode, direction: 'above' | 'below'): MindNode {
    // 1. Traverse to find parent of siblingId
    function traverse(node: MindNode): MindNode {
        if (node.children) {
            const index = node.children.findIndex(c => c.id === siblingId);
            if (index !== -1) {
                // Found parent!
                const newChildren = [...node.children];
                if (direction === 'above') {
                    newChildren.splice(index, 0, newNode);
                } else {
                    newChildren.splice(index + 1, 0, newNode);
                }
                return { ...node, children: newChildren };
            }
            // Continue search
            return {
                ...node,
                children: node.children.map(traverse)
            };
        }
        return node;
    }

    // Check if root is sibling (cannot add sibling to root usually, unless forest, but here single tree)
    if (root.id === siblingId) return root;

    return traverse(root);
}
