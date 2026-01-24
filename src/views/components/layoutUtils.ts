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

function measureNodeWidth(topic: string, isImage: boolean, options: LayoutOptions): number {
    if (isImage) return options.nodeWidth; // Use default node width for images or separate config
    if (typeof document === 'undefined') return 150; // Server-side fallback

    const container = getMeasurementContainer();
    const tempNode = document.createElement('div');

    // mimic .mindmap-node and .mindmap-node-content structure
    // We need to apply the classes that affect width/font
    tempNode.className = 'mindmap-node';

    // Add inline styles to ensure it doesn't get constrained by parent width during measurement
    tempNode.style.width = 'max-content';
    tempNode.style.display = 'inline-block';

    // Create content structure similar to actual node
    // Padding and borders are on .mindmap-node
    // Text content is inside .mindmap-node-content -> .mindmap-node-topic
    const content = document.createElement('div');
    content.className = 'mindmap-node-content';

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

    // Add a small buffer for safety and consistent look
    return Math.max(80, width + 10);
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
        const width = measureNodeWidth(node.data.topic, !!node.data.isImage, options);
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

    // Post-processing: Compact X coordinates to fix "wide sibling" gap issue
    // We keep Dagre's Y-coordinates (rank separation) but manually calculate X based on parent-child chain
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const edgeMap = new Map<string, string[]>(); // parentId -> childIds

    edges.forEach(edge => {
        const source = edge.source;
        const target = edge.target;
        if (!edgeMap.has(source)) edgeMap.set(source, []);
        edgeMap.get(source)?.push(target);
    });

    const visited = new Set<string>();
    const rootNodes = nodes.filter(n => n.data.isRoot);

    // Helper to get measured dimensions from Dagre graph
    const getNodeMeta = (id: string) => g.node(id);

    function compactCoordinates(nodeId: string, parentX?: number, parentWidth?: number) {
        if (visited.has(nodeId)) return;
        visited.add(nodeId);

        const nodeMeta = getNodeMeta(nodeId);
        const node = nodeMap.get(nodeId);

        if (!node || !nodeMeta) return;

        // Calculate new X
        let newX = nodeMeta.x; // Fallback to Dagre's center X

        if (parentX !== undefined && parentWidth !== undefined) {
            // Compact logic: Parent Left + Parent Width + Gap
            // Note: nodeMeta.width is the full width. 
            // Position in React Flow makes 'x' the left-top corner.
            // But here we are calculating specific positions. 
            // Let's standardize on calculating the LEFT edge (React Flow 'x').

            // parentX is the parent's LEFT edge.
            newX = parentX + parentWidth + options.horizontalGap;
        } else {
            // Root node or detached: convert Dagre center-X to Left-X
            newX = nodeMeta.x - nodeMeta.width / 2;
        }

        // Store the calculated LEFT X in the node wrapper for now (or directly update)
        // We can't mutate 'node' directly safely if it's reused, but here 'nodes' is a fresh array from convertToFlowElements.
        // We will store it in a map or just update a temporary structure. 
        // Let's use a position map.
        positionMap.set(nodeId, { x: newX, y: nodeMeta.y - nodeMeta.height / 2, width: nodeMeta.width });

        // Recurse children
        const children = edgeMap.get(nodeId) || [];
        for (const childId of children) {
            compactCoordinates(childId, newX, nodeMeta.width);
        }
    }

    const positionMap = new Map<string, { x: number, y: number, width: number }>();

    // Start traversal from roots
    rootNodes.forEach(root => compactCoordinates(root.id));

    // Handle any disconnected nodes that weren't reached (fallback to safe Dagre values)
    nodes.forEach(node => {
        if (!visited.has(node.id)) {
            const meta = getNodeMeta(node.id);
            positionMap.set(node.id, {
                x: meta.x - meta.width / 2,
                y: meta.y - meta.height / 2,
                width: meta.width
            });
        }
    });

    // Apply calculated positions back to nodes
    return nodes.map((node) => {
        const pos = positionMap.get(node.id)!;
        return {
            ...node,
            position: {
                x: pos.x,
                y: pos.y,
            },
            style: {
                // Explicitly set width in style to ensure React Flow knows it, 
                // though MindMapNode component handles sizing mostly. 
                // Setting width here helps RF handle handles correctly if needed.
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
