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
    nodeWidth: 150,
    nodeHeight: 40,
    horizontalGap: 50,
    verticalGap: 20,
};

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
        g.setNode(node.id, {
            width: options.nodeWidth,
            height: options.nodeHeight,
        });
    }

    // Add edges to the graph
    for (const edge of edges) {
        g.setEdge(edge.source, edge.target);
    }

    // Calculate layout
    dagre.layout(g);

    // Apply calculated positions back to nodes
    return nodes.map((node) => {
        const nodeWithPosition = g.node(node.id);
        return {
            ...node,
            position: {
                x: nodeWithPosition.x - options.nodeWidth / 2,
                y: nodeWithPosition.y - options.nodeHeight / 2,
            },
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
