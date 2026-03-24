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
    const widthPadding = isCompact ? 4 : 10;
    const heightPadding = isCompact ? 2 : 4;
    return {
        width: Math.max(40, width + widthPadding),
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
                fileType: node.fileType,
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
 * Irregular branch contour represented as orthogonal polygon strips.
 * Each segment covers [xStart, xEnd) with top/bottom bounds in subtree-root
 * relative coordinates. This allows compacting by real occupied area instead
 * of rectangular subtree bounds.
 */
interface ContourSegment {
    xStart: number;
    xEnd: number;
    top: number;
    bottom: number;
}

interface BranchContour {
    segments: ContourSegment[];
}

/**
 * Result of laying out a subtree in compact mode.
 * Contains relative positions of all descendants and the branch contour.
 */
interface CompactSubtreeResult {
    /** Relative positions of each node in this subtree (relative to subtree root center) */
    relPositions: Map<string, { dx: number, dy: number }>;
    /** Branch contour describing the irregular occupied region of this subtree */
    contour: BranchContour;
}

function getContourBandAt(contour: BranchContour, x: number): { top: number, bottom: number } | null {
    for (const seg of contour.segments) {
        if (x >= seg.xStart && x < seg.xEnd) {
            return { top: seg.top, bottom: seg.bottom };
        }
    }
    return null;
}

function getContourMin(contour: BranchContour): number {
    return Math.min(...contour.segments.map(seg => seg.top));
}

function getContourMax(contour: BranchContour): number {
    return Math.max(...contour.segments.map(seg => seg.bottom));
}

function shiftContour(contour: BranchContour, dx: number, dy: number): BranchContour {
    return {
        segments: contour.segments.map(seg => ({
            xStart: seg.xStart + dx,
            xEnd: seg.xEnd + dx,
            top: seg.top + dy,
            bottom: seg.bottom + dy,
        })),
    };
}

/**
 * Compute how far down a lower branch must be shifted so that
 * it doesn't overlap with the upper branch across every shared horizontal band.
 */
function computeMinShift(
    upperContour: BranchContour,
    lowerContour: BranchContour,
    minGap: number
): number {
    const boundaries = new Set<number>();
    for (const seg of upperContour.segments) {
        boundaries.add(seg.xStart);
        boundaries.add(seg.xEnd);
    }
    for (const seg of lowerContour.segments) {
        boundaries.add(seg.xStart);
        boundaries.add(seg.xEnd);
    }

    const sorted = [...boundaries].sort((a, b) => a - b);
    let maxShift = 0;

    for (let i = 0; i < sorted.length - 1; i++) {
        const xStart = sorted[i];
        const xEnd = sorted[i + 1];
        if (xEnd <= xStart) continue;
        const xMid = (xStart + xEnd) / 2;

        const upperBand = getContourBandAt(upperContour, xMid);
        const lowerBand = getContourBandAt(lowerContour, xMid);
        if (!upperBand || !lowerBand) continue;

        const needed = upperBand.bottom - lowerBand.top + minGap;
        maxShift = Math.max(maxShift, needed);
    }

    return maxShift;
}

/**
 * Merge two contours. The second contour is pre-shifted by caller when needed.
 */
function mergeContours(a: BranchContour, b: BranchContour): BranchContour {
    const boundaries = new Set<number>();
    for (const seg of a.segments) {
        boundaries.add(seg.xStart);
        boundaries.add(seg.xEnd);
    }
    for (const seg of b.segments) {
        boundaries.add(seg.xStart);
        boundaries.add(seg.xEnd);
    }

    const sorted = [...boundaries].sort((x, y) => x - y);
    const merged: ContourSegment[] = [];

    for (let i = 0; i < sorted.length - 1; i++) {
        const xStart = sorted[i];
        const xEnd = sorted[i + 1];
        if (xEnd <= xStart) continue;

        const xMid = (xStart + xEnd) / 2;
        const aBand = getContourBandAt(a, xMid);
        const bBand = getContourBandAt(b, xMid);
        if (!aBand && !bBand) continue;

        const top = aBand && bBand ? Math.min(aBand.top, bBand.top) : (aBand ?? bBand)!.top;
        const bottom = aBand && bBand ? Math.max(aBand.bottom, bBand.bottom) : (aBand ?? bBand)!.bottom;

        const prev = merged[merged.length - 1];
        if (prev && prev.xEnd === xStart && prev.top === top && prev.bottom === bottom) {
            prev.xEnd = xEnd;
        } else {
            merged.push({ xStart, xEnd, top, bottom });
        }
    }

    return { segments: merged };
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
    // Compact mode intentionally tightens both axes so branch contours can
    // "interlock" more aggressively (similar to XMind compact layout).
    const effectiveHGap = isCompact
        ? Math.max(20, Math.round(options.horizontalGap * 0.7))
        : options.horizontalGap;
    const effectiveVGap = isCompact
        ? Math.max(10, Math.round(options.verticalGap * 0.6))
        : options.verticalGap;

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
         * Bottom-up recursive compact layout.
         * Every subtree is packed recursively, and sibling subtrees are then
         * compacted using irregular contour overlap checks.
         */
        function layoutCompactSubtree(nodeId: string): CompactSubtreeResult {
            const dims = nodeDims.get(nodeId)!;
            const children = parentToChildren.get(nodeId) || [];

            // Contour starts with this node rectangle itself.
            const selfContour: BranchContour = {
                segments: [{
                    xStart: 0,
                    xEnd: dims.width,
                    top: -dims.height / 2,
                    bottom: dims.height / 2,
                }],
            };

            if (children.length === 0) {
                return {
                    relPositions: new Map([[nodeId, { dx: 0, dy: 0 }]]),
                    contour: selfContour,
                };
            }

            const childResults: CompactSubtreeResult[] = children.map(
                childId => layoutCompactSubtree(childId)
            );

            // First pack children in child-local coordinates (all child roots share x=0).
            const childCenterYs: number[] = [];
            let packedChildrenContour: BranchContour | null = null;

            for (let i = 0; i < childResults.length; i++) {
                if (i === 0) {
                    childCenterYs.push(0);
                    packedChildrenContour = childResults[0].contour;
                } else {
                    const shift = computeMinShift(packedChildrenContour!, childResults[i].contour, effectiveVGap);
                    childCenterYs.push(shift);
                    packedChildrenContour = mergeContours(
                        packedChildrenContour!,
                        shiftContour(childResults[i].contour, 0, shift)
                    );
                }
            }

            // Recenter children around current node center.
            const childrenTop = getContourMin(packedChildrenContour!);
            const childrenBottom = getContourMax(packedChildrenContour!);
            const childrenBlockCenter = (childrenTop + childrenBottom) / 2;
            for (let i = 0; i < childCenterYs.length; i++) {
                childCenterYs[i] -= childrenBlockCenter;
            }

            // Merge node and all compacted child contours into this subtree contour.
            const childDx = dims.width + effectiveHGap;
            let subtreeContour = selfContour;
            for (let i = 0; i < childResults.length; i++) {
                // Reserve a slim connector corridor between parent and child.
                // Without this, compact packing can place another branch's node
                // directly over the bend/segment of an edge in compact mode.
                const connectorHalfHeight = Math.max(4, Math.ceil(options.lineWidth * 2));
                const connectorContour: BranchContour = {
                    segments: [{
                        xStart: dims.width,
                        xEnd: childDx,
                        top: childCenterYs[i] - connectorHalfHeight,
                        bottom: childCenterYs[i] + connectorHalfHeight,
                    }],
                };

                subtreeContour = mergeContours(
                    subtreeContour,
                    connectorContour
                );

                subtreeContour = mergeContours(
                    subtreeContour,
                    shiftContour(childResults[i].contour, childDx, childCenterYs[i])
                );
            }

            const relPositions = new Map<string, { dx: number, dy: number }>();
            relPositions.set(nodeId, { dx: 0, dy: 0 });

            for (let i = 0; i < children.length; i++) {
                const childDy = childCenterYs[i];
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
            };
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
            const result = layoutCompactSubtree(root.id);
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
