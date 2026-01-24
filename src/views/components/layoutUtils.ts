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
}

const DEFAULT_OPTIONS: LayoutOptions = {
    direction: 1, // Right
    nodeWidth: 150, // Default minimum width
    nodeHeight: 40,
    horizontalGap: 50,
    verticalGap: 40, // Increased for safer margins
    fontSize: 14,
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
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

    if (typeof document === 'undefined') return { width: 150, height: 40 };

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

    const toggleBuffer = hasChildren ? 5 : 0;
    return {
        width: Math.max(80, width + toggleBuffer + 2),
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
    }
): { nodes: Node<MindMapNodeData>[]; edges: Edge[] } {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const nodes: Node<MindMapNodeData>[] = [];
    const edges: Edge[] = [];

    function traverse(node: MindNode, depth: number = 0, parentId?: string): void {
        const hasChildren = node.children && node.children.length > 0;
        const hasContent = contentMap.get(node.id) ?? false;

        nodes.push({
            id: node.id,
            type: 'mindMapNode',
            position: { x: 0, y: 0 }, // Will be calculated by Dagre
            data: {
                id: node.id,
                topic: node.topic,
                filepath: node.filepath,
                isImage: node.isImage,
                imageUrl: node.imageUrl,
                hasContent,
                expanded: node.expanded !== false,
                hasChildren,
                isRoot: depth === 0,
                depth,
                onToggleExpand: callbacks?.onToggleExpand,
                onNodeRename: callbacks?.onNodeRename,
            },
        });

        if (parentId) {
            edges.push({
                id: `${parentId}-${node.id}`,
                source: parentId,
                target: node.id,
                type: 'smoothstep',
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
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));

    // Determine direction: 0=Left (RL), 1=Right (LR), 2=Both (LR with alternating)
    const rankdir = options.direction === 0 ? 'RL' : 'LR';

    g.setGraph({
        rankdir,
        nodesep: options.verticalGap,
        ranksep: options.horizontalGap,
        marginx: 20,
        marginy: 20,
    });

    // Add nodes to the graph
    for (const node of nodes) {
        const dims = measureNodeDimensions(
            node.data.topic,
            !!node.data.isImage,
            !!node.data.isRoot,
            !!node.data.hasContent,
            !!node.data.hasChildren,
            options
        );
        g.setNode(node.id, {
            width: dims.width,
            height: dims.height,
        });
    }

    // Add edges to the graph
    for (const edge of edges) {
        g.setEdge(edge.source, edge.target);
    }

    // Calculate layout
    dagre.layout(g);

    // Post-processing: Align siblings and clear parents via "Shift" strategy.
    // This preserves Dagre's non-overlap guarantees because we NEVER move nodes to the left.
    const positionMap = new Map<string, { x: number, y: number, width: number }>();
    if (options.direction === 1) { // Right
        const edgeMap = new Map<string, string[]>(); // parentId -> childIds
        edges.forEach(edge => {
            if (!edgeMap.has(edge.source)) edgeMap.set(edge.source, []);
            edgeMap.get(edge.source)?.push(edge.target);
        });

        const visited = new Set<string>();
        const rootNodes = nodes.filter(n => n.data.isRoot);

        // Map to store current calculated LEFT X for each node
        const currentXMap = new Map<string, number>();

        // 1. Initialize with Dagre's default "left" positions
        nodes.forEach(node => {
            const meta = g.node(node.id);
            currentXMap.set(node.id, meta.x - meta.width / 2);
        });

        const shiftSubtree = (nodeId: string, shift: number) => {
            currentXMap.set(nodeId, (currentXMap.get(nodeId) || 0) + shift);
            const children = edgeMap.get(nodeId) || [];
            children.forEach(childId => shiftSubtree(childId, shift));
        };

        const alignSubtrees = (parentId: string) => {
            const children = edgeMap.get(parentId) || [];
            if (children.length === 0) return;

            const parentMeta = g.node(parentId);
            const parentX = currentXMap.get(parentId)!;

            // Target alignment X for children. 
            // Must clear the parent AND be at least as far right as the right-most Dagre suggested start.
            let targetX = parentX + parentMeta.width + options.horizontalGap;

            for (const childId of children) {
                targetX = Math.max(targetX, currentXMap.get(childId)!);
            }

            // Apply shifts
            for (const childId of children) {
                const currentChildX = currentXMap.get(childId)!;
                if (targetX > currentChildX) {
                    shiftSubtree(childId, targetX - currentChildX);
                }
                alignSubtrees(childId);
            }
        };

        rootNodes.forEach(root => alignSubtrees(root.id));

        // Transfer final positions to positionMap
        nodes.forEach(node => {
            const meta = g.node(node.id);
            positionMap.set(node.id, {
                x: currentXMap.get(node.id)!,
                y: meta.y - meta.height / 2,
                width: meta.width
            });
        });
    }

    // Apply calculated positions back to nodes
    return nodes.map((node) => {
        const meta = g.node(node.id);
        const customPos = positionMap.get(node.id);

        return {
            ...node,
            position: {
                // Use custom X if available (Right direction), otherwise Dagre default
                x: customPos ? customPos.x : (meta.x - meta.width / 2),
                // Use Dagre default Y for ALL nodes
                y: meta.y - meta.height / 2,
            },
            style: {
                width: meta.width,
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
