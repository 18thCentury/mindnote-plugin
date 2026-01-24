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
    verticalGap: 20,
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

function measureNodeWidth(
    topic: string,
    isImage: boolean,
    isRoot: boolean,
    hasContent: boolean,
    hasChildren: boolean,
    options: LayoutOptions
): number {
    if (isImage) return options.nodeWidth;
    if (typeof document === 'undefined') return 150; // Server-side fallback

    const container = getMeasurementContainer();
    const tempNode = document.createElement('div');

    // mimic .mindmap-node and .mindmap-node-content structure
    // We need to apply the classes that affect width/font
    tempNode.className = `mindmap-node ${isRoot ? 'mindmap-node-root' : ''}`;

    // Add inline styles to ensure it doesn't get constrained by parent width during measurement
    tempNode.style.width = 'max-content';
    tempNode.style.display = 'inline-block';
    tempNode.style.visibility = 'hidden';
    tempNode.style.position = 'absolute';

    // Create content structure similar to actual node
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

    // Measure
    const width = tempNode.offsetWidth;

    // Cleanup
    container.removeChild(tempNode);

    // Account for toggle button: right: -5px, width: 10px means it extends 5px beyond the right edge
    const toggleBuffer = hasChildren ? 5 : 0;

    // Add a small buffer for safety and consistent look
    return Math.max(80, width + toggleBuffer + 2);
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
        const width = measureNodeWidth(
            node.data.topic,
            !!node.data.isImage,
            !!node.data.isRoot,
            !!node.data.hasContent,
            !!node.data.hasChildren,
            options
        );
        g.setNode(node.id, {
            width: width,
            height: options.nodeHeight,
        });
    }

    // Add edges to the graph
    for (const edge of edges) {
        g.setEdge(edge.source, edge.target);
    }

    // Calculate layout
    dagre.layout(g);

    // Post-processing: Align siblings under the same parent to the same X coordinate.
    // We only do this for Right (LR) direction for now.
    const positionMap = new Map<string, { x: number, y: number, width: number }>();
    if (options.direction === 1) { // Right
        const edgeMap = new Map<string, string[]>(); // parentId -> childIds
        edges.forEach(edge => {
            if (!edgeMap.has(edge.source)) edgeMap.set(edge.source, []);
            edgeMap.get(edge.source)?.push(edge.target);
        });

        const visited = new Set<string>();
        const rootNodes = nodes.filter(n => n.data.isRoot);

        const alignSubtree = (parentId: string, parentX: number, parentWidth: number) => {
            const children = edgeMap.get(parentId) || [];
            if (children.length === 0) return;

            // Alignment X is strictly relative to the parent's boundaries
            const alignmentX = parentX + parentWidth + options.horizontalGap;

            // Apply this alignmentX to all siblings and recurse
            for (const childId of children) {
                if (visited.has(childId)) continue;
                visited.add(childId);

                const meta = g.node(childId);
                positionMap.set(childId, {
                    x: alignmentX,
                    y: meta.y - meta.height / 2,
                    width: meta.width
                });

                alignSubtree(childId, alignmentX, meta.width);
            }
        };

        rootNodes.forEach(root => {
            const meta = g.node(root.id);
            const rootX = meta.x - meta.width / 2;
            positionMap.set(root.id, { x: rootX, y: meta.y - meta.height / 2, width: meta.width });
            visited.add(root.id);
            alignSubtree(root.id, rootX, meta.width);
        });
    }

    // Apply calculated positions back to nodes
    return nodes.map((node) => {
        const pos = positionMap.get(node.id) || (() => {
            const meta = g.node(node.id);
            return {
                x: meta.x - meta.width / 2,
                y: meta.y - meta.height / 2,
                width: meta.width
            };
        })();

        return {
            ...node,
            position: {
                x: pos.x,
                y: pos.y,
            },
            style: {
                width: pos.width,
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
