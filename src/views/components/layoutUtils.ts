/**
 * Layout Utilities for React Flow Mindmap
 * Uses a custom Tidy Tree (Block Centering) algorithm.
 * Guarantees centered parents and compact subtrees.
 */
import type { Node, Edge } from '@xyflow/react';
import type { MindNode, Direction } from '../../types';

export interface LayoutOptions {
    direction: Direction;
    nodeWidth: number;          // Default minimum width
    nodeHeight: number;         // Default height
    horizontalGap: number;      // Gap between parent and child (rank separation)
    verticalGap: number;        // Gap between sibling nodes (node separation)
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
    nodeWidth: 150,
    nodeHeight: 40,
    horizontalGap: 60,  // Increased slightly for visual breathing room
    verticalGap: 10,    // Tighter vertical packing
    fontSize: 14,
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

// ----------------------------------------------------------------------------
// Internal Layout Types
// ----------------------------------------------------------------------------

interface TreeLayoutNode extends MindNode {
    // Computed layout properties
    x: number;
    y: number;
    width: number;
    height: number;

    // Geometry for the algorithm
    subtreeHeight: number; // Total vertical space required by this node and its children
    children: TreeLayoutNode[]; // Recursive typing
}

// ----------------------------------------------------------------------------
// DOM Measurement Helpers
// ----------------------------------------------------------------------------

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

function measureNode(topic: string, isImage: boolean, hasContent: boolean, options: LayoutOptions): { width: number, height: number } {
    if (isImage) {
        // For images, we might strictly obey default dimensions or 
        // ideally measuring the actual image if loaded, but for layout we stick to defaults or configuration.
        return { width: options.nodeWidth, height: options.nodeHeight };
    }

    if (typeof document === 'undefined') {
        return { width: options.nodeWidth, height: options.nodeHeight };
    }

    const container = getMeasurementContainer();
    const tempNode = document.createElement('div');

    // Mimic the MindMapNode CSS
    tempNode.style.width = 'max-content';
    tempNode.style.minWidth = 'max-content';
    tempNode.style.display = 'inline-flex';
    tempNode.style.alignItems = 'center';
    tempNode.style.boxSizing = 'border-box';
    tempNode.style.padding = '8px 12px'; // Match CSS padding
    tempNode.style.border = '1px solid transparent';

    // Font settings
    tempNode.style.fontSize = `${options.fontSize}px`;
    tempNode.style.fontFamily = options.fontFamily || 'sans-serif';

    // Simulated Content
    const content = document.createElement('div');
    content.style.display = 'flex';
    content.style.alignItems = 'center';
    content.style.gap = '6px';

    if (hasContent) {
        const indicator = document.createElement('span');
        indicator.textContent = '📝';
        indicator.style.fontSize = '12px';
        indicator.style.marginRight = '4px';
        content.appendChild(indicator);
    }

    const topicSpan = document.createElement('span');
    topicSpan.textContent = topic;
    topicSpan.style.whiteSpace = 'nowrap';
    content.appendChild(topicSpan);

    tempNode.appendChild(content);
    container.appendChild(tempNode);

    const width = Math.ceil(tempNode.offsetWidth);
    const height = Math.ceil(tempNode.offsetHeight);

    container.removeChild(tempNode);

    // Enforce Minimums
    return {
        width: Math.max(options.nodeWidth || 80, width),
        height: Math.max(options.nodeHeight || 30, height)
    };
}

// ----------------------------------------------------------------------------
// Layout Algorithm (Block Centering)
// ----------------------------------------------------------------------------

/**
 * Step 1: Post-order traversal.
 * Calculates dimensions and subtree heights.
 */
function computeSubtreeValues(node: TreeLayoutNode, options: LayoutOptions): void {
    // 1. Measure the node itself (Content Size)
    // Note: We access the raw data props via MindNode interface
    const dimensions = measureNode(
        node.topic,
        node.isImage || false,
        // We don't have direct access to 'hasContent' from MindNode here easily 
        // unless we pass the contentMap or enrich MindNode earlier. 
        // For sizing, 'hasContent' flag impact is small (icon), 
        // but let's assume worst case or just text width.
        // If we really need exact pixel perfection, we should enrich MindNode first.
        // For now, text width is the dominant factor.
        false,
        options
    );

    node.width = dimensions.width;
    node.height = dimensions.height;

    // 2. Process Children
    if (node.expanded && node.children && node.children.length > 0) {
        let maxChildrenWidth = 0;
        let childrenTotalHeight = 0;

        node.children.forEach((child, index) => {
            computeSubtreeValues(child, options);

            childrenTotalHeight += child.subtreeHeight;
            // Add vertical gap between siblings
            if (index < node.children.length - 1) {
                childrenTotalHeight += options.verticalGap;
            }
        });

        // The subtree height is the maximum of:
        // A) The node's own height
        // B) The total height of the children stack
        node.subtreeHeight = Math.max(node.height, childrenTotalHeight);
    } else {
        // Leaf node determines its own subtree height
        node.subtreeHeight = node.height;
    }
}

/**
 * Step 2: Pre-order traversal.
 * Assigns X,Y coordinates based on calculated subtree heights.
 * @param node Current node
 * @param x Absolute X position for the node
 * @param yCenter Absolute Y position for the CENTER of this node's allocated vertical space
 * @param options Layout options
 */
function assignCoordinates(node: TreeLayoutNode, x: number, yCenter: number, options: LayoutOptions): void {
    // 1. Set current node position
    node.x = x;
    // We want the node to be centered around yCenter.
    // yCenter is the midpoint of the "block" allocated to this node.
    node.y = yCenter - (node.height / 2);

    // 2. Position Children
    if (node.expanded && node.children && node.children.length > 0) {

        // Calculate the total height of the children block
        // Re-suming here is cheap, or we could have cached it.
        const childrenBlockHeight = node.children.reduce((acc, child) => acc + child.subtreeHeight, 0)
            + (node.children.length - 1) * options.verticalGap;

        // The children block should be centered around `yCenter` as well.
        // Start Y is the top of the block.
        let currentChildY = yCenter - (childrenBlockHeight / 2);

        const childX = x + node.width + options.horizontalGap;

        node.children.forEach(child => {
            // The child's center Y is: current cursor + half its subtree height
            const childCenterY = currentChildY + (child.subtreeHeight / 2);

            assignCoordinates(child, childX, childCenterY, options);

            // Advance cursor
            currentChildY += child.subtreeHeight + options.verticalGap;
        });
    }
}

// ----------------------------------------------------------------------------
// Main Exported Function
// ----------------------------------------------------------------------------

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

    // 1. Transform MindNode tree to TreeLayoutNode tree (deep copy to avoid mutation of original if needed, 
    //    but here we construct a parallel structure or cast if we are careful).
    //    We need a recursive mapper to attach the extra fields.

    function mapToLayoutNode(n: MindNode): TreeLayoutNode {
        return {
            ...n,
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            subtreeHeight: 0,
            // Only map children if expanded, otherwise layout treats them as non-existent
            children: (n.expanded !== false && n.children)
                ? n.children.map(mapToLayoutNode)
                : []
        };
    }

    // Safety check for empty tree
    if (!root) {
        return { nodes: [], edges: [] };
    }

    const layoutRoot = mapToLayoutNode(root);

    // 2. Perform Layout
    // Step A: Calculate sizes
    computeSubtreeValues(layoutRoot, opts);

    // Step B: Assign Coordinates
    // Start at (0, 0)
    assignCoordinates(layoutRoot, 0, 0, opts);

    // 3. Flatten to React Flow Elements
    const rfNodes: Node<MindMapNodeData>[] = [];
    const rfEdges: Edge[] = [];

    function flatten(node: TreeLayoutNode, depth: number = 0, parentId?: string) {
        const hasChildren = node.children && node.children.length > 0;
        // Check original data for accurate flags, though layoutNode copies properties
        const hasContent = contentMap.get(node.id) ?? false;

        rfNodes.push({
            id: node.id,
            type: 'mindMapNode',
            position: { x: node.x, y: node.y },
            data: {
                id: node.id,
                topic: node.topic,
                filepath: node.filepath,
                isImage: node.isImage,
                imageUrl: node.imageUrl,
                hasContent,
                expanded: node.expanded !== false,
                hasChildren: (root.id === node.id) ? (root.children && root.children.length > 0) : (node.children && node.children.length > 0), // layoutNode.children might be empty if collapsed, so we can't trust it for "hasChildren" indicator. Ideally we check the original node, but copying prop is safer.

                isRoot: depth === 0,
                depth,
                onToggleExpand: callbacks?.onToggleExpand,
                onNodeRename: callbacks?.onNodeRename,
            },
            // Explicit style width to ensure RF handles interaction area correctly
            style: {
                width: node.width,
            }
        });

        if (parentId) {
            rfEdges.push({
                id: `${parentId}-${node.id}`,
                source: parentId,
                target: node.id,
                type: 'smoothstep', // or 'bezier'
                // We can maximize edge aesthetic
            });
        }

        if (node.children) {
            node.children.forEach(child => flatten(child, depth + 1, node.id));
        }
    }

    // Fix the mapping function to preserve child existence knowledge
    function refinedMap(n: MindNode): TreeLayoutNode & { _realHasChildren: boolean } {
        const hasRealChildren = n.children && n.children.length > 0;
        return {
            ...n,
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            subtreeHeight: 0,
            children: (n.expanded !== false && n.children)
                ? n.children.map(refinedMap)
                : [],
            _realHasChildren: hasRealChildren
        };
    }

    const refinedRoot = refinedMap(root);
    computeSubtreeValues(refinedRoot, opts);
    assignCoordinates(refinedRoot, 0, 0, opts);
    flatten(refinedRoot);

    return { nodes: rfNodes, edges: rfEdges };
}

// ----------------------------------------------------------------------------
// Utility Functions (Unchanged)
// ----------------------------------------------------------------------------

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

export function addChildNode(root: MindNode, parentId: string, newNode: MindNode): MindNode {
    if (root.id === parentId) {
        return {
            ...root,
            children: [...(root.children || []), newNode],
            expanded: true,
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

export function removeNode(root: MindNode, id: string): MindNode | null {
    if (root.id === id) {
        return null;
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
