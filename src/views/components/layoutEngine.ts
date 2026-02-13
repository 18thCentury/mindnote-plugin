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
    // Adding extra for handles and toggle safely (reduced in compact mode)
    const isCompact = !!options.compact;
    const toggleBuffer = hasChildren ? (isCompact ? 8 : 15) : 0;
    const widthPadding = isCompact ? 4 : 10;
    const heightPadding = isCompact ? 2 : 4;
    return {
        width: Math.max(40, width + toggleBuffer + widthPadding),
        height: Math.max(options.nodeHeight, height + heightPadding)
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
 * Branch contour: tracks the top and bottom y extents at each horizontal
 * offset from the branch root. Used for compact layout to pack sibling
 * branches tightly by comparing their shapes.
 * 
 * Key: horizontal offset (0 = branch root column, 1 = first child column, etc.)
 * Value: min/max y at that column, relative to the branch root's center y
 */
interface BranchContour {
    top: Map<number, number>;    // hOffset → minimum relative y
    bottom: Map<number, number>; // hOffset → maximum relative y
}

/**
 * Result of laying out a subtree in compact mode.
 * Contains relative positions of all descendants and the branch contour.
 */
interface CompactSubtreeResult {
    /** Relative positions of each node in this subtree (relative to subtree root center) */
    relPositions: Map<string, { dx: number, dy: number }>;
    /** Branch contour describing the shape of this subtree */
    contour: BranchContour;
    /** Total height of this subtree (for centering the root) */
    height: number;
}

/**
 * Compute how far down a lower branch must be shifted so that
 * it doesn't overlap with the upper branch at any shared horizontal offset.
 * Returns the minimum vertical distance between the two branches' centers.
 */
function computeMinShift(
    upperContour: BranchContour,
    lowerContour: BranchContour,
    minGap: number
): number {
    let maxShift = 0;

    // Check every horizontal offset that exists in both contours
    for (const [hOffset, upperBottom] of upperContour.bottom) {
        const lowerTop = lowerContour.top.get(hOffset);
        if (lowerTop !== undefined) {
            // At this horizontal offset, we need: upperBottom + gap <= lowerTop + shift
            // shift >= upperBottom - lowerTop + gap
            const needed = upperBottom - lowerTop + minGap;
            maxShift = Math.max(maxShift, needed);
        }
    }

    return maxShift;
}

/**
 * Merge two contours, where the second contour is shifted vertically by `offset`.
 */
function mergeContours(a: BranchContour, b: BranchContour, bOffset: number): BranchContour {
    const merged: BranchContour = {
        top: new Map(a.top),
        bottom: new Map(a.bottom),
    };

    for (const [hOffset, val] of b.top) {
        const shifted = val + bOffset;
        const existing = merged.top.get(hOffset);
        merged.top.set(hOffset, existing !== undefined ? Math.min(existing, shifted) : shifted);
    }

    for (const [hOffset, val] of b.bottom) {
        const shifted = val + bOffset;
        const existing = merged.bottom.get(hOffset);
        merged.bottom.set(hOffset, existing !== undefined ? Math.max(existing, shifted) : shifted);
    }

    return merged;
}

/**
 * Apply custom tree layout algorithm to position nodes
 */
function applyTreeLayout(
    nodes: Node<MindMapNodeData>[],
    edges: Edge[],
    options: LayoutOptions
): Node<MindMapNodeData>[] {
    const isCompact = !!options.compact;
    const effectiveHGap = options.horizontalGap;//isCompact ? Math.round(options.horizontalGap * 0.8) : options.horizontalGap;
    const effectiveVGap = options.verticalGap;//isCompact ? Math.round(options.verticalGap * 0.5) : options.verticalGap;

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

    const rootNodes = nodes.filter(n => n.data.isRoot);
    const finalPositions = new Map<string, { x: number, y: number }>();

    if (isCompact) {
        // ─── Compact mode: Branch-region packing ───
        // Uses contour-based algorithm to pack sibling branches tightly.
        // Each branch tracks its shape (top/bottom y at each horizontal column).
        // Sibling branches are placed as close as possible by comparing
        // contours at shared horizontal offsets.

        /**
         * Bottom-up: Layout a subtree and return its contour + relative positions.
         * hOffset is the horizontal column index relative to the subtree being built
         * by the caller (used to track contour positions correctly).
         */
        function layoutCompactSubtree(nodeId: string, hOffset: number): CompactSubtreeResult {
            const dims = nodeDims.get(nodeId)!;
            const children = parentToChildren.get(nodeId) || [];

            // Leaf node: contour is just this node's bounding box
            if (children.length === 0) {
                const contour: BranchContour = {
                    top: new Map([[hOffset, -dims.height / 2]]),
                    bottom: new Map([[hOffset, dims.height / 2]]),
                };
                return {
                    relPositions: new Map([[nodeId, { dx: 0, dy: 0 }]]),
                    contour,
                    height: dims.height,
                };
            }

            // Recursively layout each child subtree
            const childHOffset = hOffset + 1; // Children are one column to the right
            const childResults: CompactSubtreeResult[] = children.map(
                childId => layoutCompactSubtree(childId, childHOffset)
            );

            // Pack children using contour comparison
            // childCenterYs[i] = center y of child i, relative to the first child's center
            const childCenterYs: number[] = [];
            let mergedChildContour: BranchContour | null = null;

            for (let i = 0; i < childResults.length; i++) {
                if (i === 0) {
                    childCenterYs.push(0);
                    mergedChildContour = childResults[0].contour;
                } else {
                    // Compute minimum shift so child i doesn't overlap with merged contour above
                    const shift = computeMinShift(mergedChildContour!, childResults[i].contour, effectiveVGap);
                    childCenterYs.push(shift);
                    // Merge this child's contour into the accumulated contour
                    mergedChildContour = mergeContours(mergedChildContour!, childResults[i].contour, shift);
                }
            }

            // Center the children block around y=0
            // Find the bounding box of all children centers
            const minChildY = Math.min(...childCenterYs);
            const maxChildY = Math.max(...childCenterYs);
            // Account for the actual extent of first and last child subtrees
            const topExtent = minChildY + getContourMin(childResults[0].contour);
            const bottomExtent = maxChildY + getContourMax(childResults[childResults.length - 1].contour);
            const childrenBlockHeight = bottomExtent - topExtent;
            const childrenBlockCenter = (topExtent + bottomExtent) / 2;

            // Shift all children so the block is centered at y=0
            for (let i = 0; i < childCenterYs.length; i++) {
                childCenterYs[i] -= childrenBlockCenter;
            }

            // Build the combined contour for this subtree
            // Start with the current node's contour
            const selfExtentH = dims.height / 2;
            const totalHeight = Math.max(dims.height, childrenBlockHeight);

            let subtreeContour: BranchContour = {
                top: new Map([[hOffset, -selfExtentH]]),
                bottom: new Map([[hOffset, selfExtentH]]),
            };

            // Merge all children contours with their final offsets
            for (let i = 0; i < childResults.length; i++) {
                subtreeContour = mergeContours(subtreeContour, childResults[i].contour, childCenterYs[i]);
            }

            // Collect all relative positions
            const relPositions = new Map<string, { dx: number, dy: number }>();
            relPositions.set(nodeId, { dx: 0, dy: 0 });

            for (let i = 0; i < children.length; i++) {
                const childId = children[i];
                const childDims = nodeDims.get(childId)!;
                const childDx = dims.width + effectiveHGap;
                const childDy = childCenterYs[i];

                // Add child's own position
                // And merge all descendant positions with offset
                for (const [descId, descPos] of childResults[i].relPositions) {
                    relPositions.set(descId, {
                        dx: childDx + descPos.dx,
                        dy: childDy + descPos.dy,
                    });
                }
            }

            return {
                relPositions,
                contour: subtreeContour,
                height: totalHeight,
            };
        }

        /** Get minimum y across all contour entries */
        function getContourMin(contour: BranchContour): number {
            let min = Infinity;
            for (const v of contour.top.values()) min = Math.min(min, v);
            return min;
        }

        /** Get maximum y across all contour entries */
        function getContourMax(contour: BranchContour): number {
            let max = -Infinity;
            for (const v of contour.bottom.values()) max = Math.max(max, v);
            return max;
        }

        /**
         * Convert relative positions to absolute positions.
         * rootX, rootCenterY are the absolute position of the subtree root's center.
         */
        function assignCompactCoords(
            result: CompactSubtreeResult,
            rootX: number,
            rootCenterY: number
        ) {
            for (const [nodeId, rel] of result.relPositions) {
                const dims = nodeDims.get(nodeId)!;
                finalPositions.set(nodeId, {
                    x: rootX + rel.dx,
                    y: rootCenterY + rel.dy - dims.height / 2,
                });
            }
        }

        // Layout and position each root
        let currentRootY = 0;
        rootNodes.forEach((root) => {
            const result = layoutCompactSubtree(root.id, 0);
            const topExtent = getContourMin(result.contour);
            const bottomExtent = getContourMax(result.contour);
            const totalHeight = bottomExtent - topExtent;
            const rootCenterY = currentRootY - topExtent; // so top of contour aligns to currentRootY
            assignCompactCoords(result, 20, rootCenterY);
            currentRootY += totalHeight + effectiveVGap;
        });

    } else {
        // ─── Non-compact mode: Standard bounding-box layout ───

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
                    totalChildrenHeight += effectiveVGap;
                }
            });

            const h = Math.max(selfHeight, totalChildrenHeight);
            subtreeHeights.set(nodeId, h);
            return h;
        }

        rootNodes.forEach(root => calculateHeight(root.id));

        // 4. Second pass: Assign coordinates recursively
        function assignCoords(nodeId: string, x: number, yCenter: number) {
            const dims = nodeDims.get(nodeId)!;

            finalPositions.set(nodeId, {
                x,
                y: yCenter - dims.height / 2
            });

            const children = parentToChildren.get(nodeId) || [];
            if (children.length > 0) {
                const childrenX = x + dims.width + effectiveHGap;

                let totalChildrenHeight = 0;
                children.forEach((childId, index) => {
                    totalChildrenHeight += subtreeHeights.get(childId)!;
                    if (index < children.length - 1) totalChildrenHeight += effectiveVGap;
                });

                let currentY = yCenter - totalChildrenHeight / 2;

                children.forEach(childId => {
                    const childSubtreeHeight = subtreeHeights.get(childId)!;
                    const childYCenter = currentY + childSubtreeHeight / 2;
                    assignCoords(childId, childrenX, childYCenter);
                    currentY += childSubtreeHeight + effectiveVGap;
                });
            }
        }

        let currentRootY = 0;
        rootNodes.forEach((root) => {
            const rootHeight = subtreeHeights.get(root.id)!;
            assignCoords(root.id, 20, currentRootY + rootHeight / 2);
            currentRootY += rootHeight + effectiveVGap * 2;
        });
    }

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
