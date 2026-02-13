/**
 * Layout Engine for React Flow Mindmap
 * Uses custom tree layout algorithm for hierarchical positioning with collapse/expand support
 */
import type { Node, Edge } from '@xyflow/react';
import type { MindNode } from '../../types';
import type { LayoutOptions, MindMapNodeData } from './flowTypes';
import { DEFAULT_LAYOUT_OPTIONS } from './flowTypes';

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
    const opts = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
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
            position: { x: 0, y: 0 }, // Will be calculated by layout
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

    // Apply layout
    const layoutedNodes = applyTreeLayout(nodes, edges, opts);

    return { nodes: layoutedNodes, edges };
}

/**
 * Apply custom tree layout algorithm to position nodes
 */
function applyTreeLayout(
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
    rootNodes.forEach((root) => {
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
