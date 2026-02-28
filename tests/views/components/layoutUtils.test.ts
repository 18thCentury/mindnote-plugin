/**
 * Tests for tree operations and layout engine
 */
import { describe, it, expect } from 'vitest';
import {
    findNodeInTree,
    toggleNodeExpanded,
    addChildNode,
    removeNode,
    updateNodeTopic,
    addSiblingNode,
} from '../../../src/views/components/treeOperations';
import { convertToFlowElements } from '../../../src/views/components/layoutEngine';
import type { MindNode } from '../../../src/types';

// Sample tree for testing
const createSampleTree = (): MindNode => ({
    id: 'root',
    topic: 'Root Node',
    filepath: 'root.md',
    children: [
        {
            id: 'child1',
            topic: 'Child 1',
            filepath: 'child1.md',
            children: [
                {
                    id: 'grandchild1',
                    topic: 'Grandchild 1',
                    filepath: 'grandchild1.md',
                    children: [],
                    expanded: true,
                },
            ],
            expanded: true,
        },
        {
            id: 'child2',
            topic: 'Child 2',
            filepath: 'child2.md',
            children: [],
            expanded: true,
        },
    ],
    expanded: true,
});

describe('layoutUtils', () => {
    describe('convertToFlowElements', () => {
        it('should convert a tree to nodes and edges', () => {
            const tree = createSampleTree();
            const { nodes, edges } = convertToFlowElements(tree);

            expect(nodes).toHaveLength(4); // root + child1 + child2 + grandchild1
            expect(edges).toHaveLength(3); // root->child1, root->child2, child1->grandchild1
        });

        it('should mark root node correctly', () => {
            const tree = createSampleTree();
            const { nodes } = convertToFlowElements(tree);

            const rootNode = nodes.find(n => n.id === 'root');
            expect(rootNode?.data.isRoot).toBe(true);
            expect(rootNode?.data.depth).toBe(0);
        });

        it('should set correct depth for child nodes', () => {
            const tree = createSampleTree();
            const { nodes } = convertToFlowElements(tree);

            const child1 = nodes.find(n => n.id === 'child1');
            const grandchild1 = nodes.find(n => n.id === 'grandchild1');

            expect(child1?.data.depth).toBe(1);
            expect(grandchild1?.data.depth).toBe(2);
        });

        it('should respect collapsed state', () => {
            const tree: MindNode = {
                ...createSampleTree(),
                children: [
                    {
                        id: 'child1',
                        topic: 'Child 1',
                        filepath: 'child1.md',
                        children: [
                            {
                                id: 'grandchild1',
                                topic: 'Grandchild 1',
                                filepath: 'grandchild1.md',
                                children: [],
                                expanded: true,
                            },
                        ],
                        expanded: false, // Collapsed
                    },
                ],
            };

            const { nodes } = convertToFlowElements(tree);

            // grandchild1 should not be included because child1 is collapsed
            expect(nodes).toHaveLength(2); // root + child1
            expect(nodes.find(n => n.id === 'grandchild1')).toBeUndefined();
        });

        it('should set hasChildren flag correctly', () => {
            const tree = createSampleTree();
            const { nodes } = convertToFlowElements(tree);

            const rootNode = nodes.find(n => n.id === 'root');
            const child2 = nodes.find(n => n.id === 'child2');

            expect(rootNode?.data.hasChildren).toBe(true);
            expect(child2?.data.hasChildren).toBe(false);
        });

        it('should use contentMap for hasContent flag', () => {
            const tree = createSampleTree();
            const contentMap = new Map([
                ['root', true],
                ['child1', false],
            ]);

            const { nodes } = convertToFlowElements(tree, {}, contentMap);

            const rootNode = nodes.find(n => n.id === 'root');
            const child1 = nodes.find(n => n.id === 'child1');

            expect(rootNode?.data.hasContent).toBe(true);
            expect(child1?.data.hasContent).toBe(false);
        });

        it('should pass callbacks through node data', () => {
            const tree = createSampleTree();
            const onToggleExpand = () => { };
            const onNodeRename = () => { };

            const { nodes } = convertToFlowElements(tree, {}, new Map(), {
                onToggleExpand,
                onNodeRename,
            });

            expect(nodes[0].data.onToggleExpand).toBe(onToggleExpand);
            expect(nodes[0].data.onNodeRename).toBe(onNodeRename);
        });

        it('should left-align nodes in the same rank', () => {
            const tree: MindNode = {
                id: 'root',
                topic: 'Short',
                filepath: 'root.md',
                children: [
                    {
                        id: 'child1',
                        topic: 'Very Long Topic Name That Increases Width',
                        filepath: 'child1.md',
                        children: [],
                        expanded: true,
                    },
                    {
                        id: 'child2',
                        topic: 'Short',
                        filepath: 'child2.md',
                        children: [],
                        expanded: true,
                    },
                ],
                expanded: true,
            };

            const { nodes } = convertToFlowElements(tree);
            const child1 = nodes.find(n => n.id === 'child1');
            const child2 = nodes.find(n => n.id === 'child2');

            // Both children are in the same rank, so their X should be equal
            expect(child1?.position.x).toBe(child2?.position.x);
        });

        it('should align sibling groups independently', () => {
            const tree: MindNode = {
                id: 'root',
                topic: 'Root',
                filepath: 'root.md',
                children: [
                    {
                        id: 'parentA',
                        topic: 'Very Very Very Long Parent A Name',
                        filepath: 'a.md',
                        children: [
                            { id: 'childA1', topic: 'Short', filepath: 'a1.md', children: [], expanded: true },
                            { id: 'childA2', topic: 'Very Very Very Long Sibling Topic', filepath: 'a2.md', children: [], expanded: true }
                        ],
                        expanded: true,
                    },
                    {
                        id: 'parentB',
                        topic: 'Parent B',
                        filepath: 'b.md',
                        children: [
                            { id: 'childB1', topic: 'Short', filepath: 'b1.md', children: [], expanded: true }
                        ],
                        expanded: true,
                    },
                ],
                expanded: true,
            };

            const { nodes } = convertToFlowElements(tree);
            const childA1 = nodes.find(n => n.id === 'childA1');
            const childB1 = nodes.find(n => n.id === 'childB1');

            // Both childA1 and childB1 are in the same rank (column).
            // childA1 has a very wide sibling (childA2) in the same rank.
            // Our logic should align childA1 to childA2's left edge.
            // childB1 however is a sibling of childB1 (self) only, so it stays centered (locally left-aligned).
            // This proves that alignment is scoped to sibling groups.

            expect(childA1?.position.x).not.toBe(childB1?.position.x);
        });

        it('should maintain consistent horizontal gaps', () => {
            const horizontalGap = 60;
            const tree: MindNode = {
                id: 'root',
                topic: 'Root',
                filepath: 'root.md',
                children: [
                    {
                        id: 'p1',
                        topic: 'Parent 1 (Longer Topic Name)',
                        filepath: 'p1.md',
                        children: [
                            {
                                id: 'c1',
                                topic: 'Child 1',
                                filepath: 'c1.md',
                                children: [
                                    { id: 'gc1', topic: 'GC1', filepath: 'gc1.md', children: [], expanded: true }
                                ],
                                expanded: true
                            }
                        ],
                        expanded: true,
                    },
                ],
                expanded: true,
            };

            const { nodes } = convertToFlowElements(tree, { horizontalGap });

            const root = nodes.find(n => n.id === 'root')!;
            const p1 = nodes.find(n => n.id === 'p1')!;
            const c1 = nodes.find(n => n.id === 'c1')!;
            const gc1 = nodes.find(n => n.id === 'gc1')!;

            const rootWidth = root.style!.width as number;
            const p1Width = p1.style!.width as number;
            const c1Width = c1.style!.width as number;

            // Verify gaps: child.left - (parent.left + parent.width) === gap
            expect(p1.position.x - (root.position.x + rootWidth)).toBe(horizontalGap);
            expect(c1.position.x - (p1.position.x + p1Width)).toBe(horizontalGap);
            expect(gc1.position.x - (c1.position.x + c1Width)).toBe(horizontalGap);
        });

        it('should produce smaller vertical gaps in compact mode', () => {
            const tree = createSampleTree();
            const normalResult = convertToFlowElements(tree, { verticalGap: 40 });
            const compactResult = convertToFlowElements(tree, { verticalGap: 40, compact: true });

            const normalChild1 = normalResult.nodes.find(n => n.id === 'child1')!;
            const normalChild2 = normalResult.nodes.find(n => n.id === 'child2')!;
            const compactChild1 = compactResult.nodes.find(n => n.id === 'child1')!;
            const compactChild2 = compactResult.nodes.find(n => n.id === 'child2')!;

            const normalVerticalSpan = Math.abs(normalChild2.position.y - normalChild1.position.y);
            const compactVerticalSpan = Math.abs(compactChild2.position.y - compactChild1.position.y);

            expect(compactVerticalSpan).toBeLessThan(normalVerticalSpan);
        });

        it('should produce smaller horizontal gaps in compact mode', () => {
            const horizontalGap = 60;
            const tree: MindNode = {
                id: 'root',
                topic: 'Root',
                filepath: 'root.md',
                children: [
                    { id: 'child1', topic: 'Child 1', filepath: 'c1.md', children: [], expanded: true },
                ],
                expanded: true,
            };

            const normalResult = convertToFlowElements(tree, { horizontalGap });
            const compactResult = convertToFlowElements(tree, { horizontalGap, compact: true });

            const normalRoot = normalResult.nodes.find(n => n.id === 'root')!;
            const normalChild = normalResult.nodes.find(n => n.id === 'child1')!;
            const compactRoot = compactResult.nodes.find(n => n.id === 'root')!;
            const compactChild = compactResult.nodes.find(n => n.id === 'child1')!;

            const normalHGap = normalChild.position.x - normalRoot.position.x;
            const compactHGap = compactChild.position.x - compactRoot.position.x;

            expect(compactHGap).toBeLessThan(normalHGap);
        });

        it('should still respect collapsed state in compact mode', () => {
            const tree: MindNode = {
                ...createSampleTree(),
                children: [
                    {
                        id: 'child1',
                        topic: 'Child 1',
                        filepath: 'child1.md',
                        children: [
                            {
                                id: 'grandchild1',
                                topic: 'Grandchild 1',
                                filepath: 'grandchild1.md',
                                children: [],
                                expanded: true,
                            },
                        ],
                        expanded: false, // Collapsed
                    },
                ],
            };

            const { nodes } = convertToFlowElements(tree, { compact: true });
            expect(nodes).toHaveLength(2); // root + child1 only
            expect(nodes.find(n => n.id === 'grandchild1')).toBeUndefined();
        });

        it('should pack leaf sibling alongside tall sibling children in compact mode', () => {
            // Tree: root -> [A(->A1,A2), B(->B1,B2,B3), C(leaf)]
            // C should nestle up alongside B's children because C has no depth-2 content
            const tree: MindNode = {
                id: 'root',
                topic: 'Root',
                filepath: 'root.md',
                children: [
                    {
                        id: 'A', topic: 'A', filepath: 'a.md',
                        children: [
                            { id: 'A1', topic: 'A1', filepath: 'a1.md', children: [], expanded: true },
                            { id: 'A2', topic: 'A2', filepath: 'a2.md', children: [], expanded: true },
                        ],
                        expanded: true,
                    },
                    {
                        id: 'B', topic: 'B', filepath: 'b.md',
                        children: [
                            { id: 'B1', topic: 'B1', filepath: 'b1.md', children: [], expanded: true },
                            { id: 'B2', topic: 'B2', filepath: 'b2.md', children: [], expanded: true },
                            { id: 'B3', topic: 'B3', filepath: 'b3.md', children: [], expanded: true },
                        ],
                        expanded: true,
                    },
                    {
                        id: 'C', topic: 'C', filepath: 'c.md',
                        children: [],
                        expanded: true,
                    },
                ],
                expanded: true,
            };

            const compactResult = convertToFlowElements(tree, { compact: true });
            const normalResult = convertToFlowElements(tree);

            const compactC = compactResult.nodes.find(n => n.id === 'C')!;
            const compactB3 = compactResult.nodes.find(n => n.id === 'B3')!;
            const normalC = normalResult.nodes.find(n => n.id === 'C')!;
            const normalB3 = normalResult.nodes.find(n => n.id === 'B3')!;

            // In compact mode, C should be closer to B3 than in normal mode
            // because C can slide up alongside B's children
            const compactGap = compactC.position.y - compactB3.position.y;
            const normalGap = normalC.position.y - normalB3.position.y;
            expect(compactGap).toBeLessThan(normalGap);
        });


        it('should compact nested sub-branches recursively in compact mode', () => {
            // root -> A(A1[A11,A12],A2) and B(B1[long branch],B2)
            // Recursive compact should reduce total span compared with normal mode,
            // not only at top-level siblings but also in depth-2 sibling groups.
            const tree: MindNode = {
                id: 'root',
                topic: 'Root',
                filepath: 'root.md',
                children: [
                    {
                        id: 'A', topic: 'A', filepath: 'a.md',
                        children: [
                            {
                                id: 'A1', topic: 'A1', filepath: 'a1.md',
                                children: [
                                    { id: 'A11', topic: 'A11', filepath: 'a11.md', children: [], expanded: true },
                                    { id: 'A12', topic: 'A12', filepath: 'a12.md', children: [], expanded: true },
                                ],
                                expanded: true,
                            },
                            { id: 'A2', topic: 'A2', filepath: 'a2.md', children: [], expanded: true },
                        ],
                        expanded: true,
                    },
                    {
                        id: 'B', topic: 'B', filepath: 'b.md',
                        children: [
                            {
                                id: 'B1', topic: 'B1', filepath: 'b1.md',
                                children: [
                                    { id: 'B11', topic: 'B11', filepath: 'b11.md', children: [], expanded: true },
                                    { id: 'B12', topic: 'B12', filepath: 'b12.md', children: [], expanded: true },
                                    { id: 'B13', topic: 'B13', filepath: 'b13.md', children: [], expanded: true },
                                ],
                                expanded: true,
                            },
                            { id: 'B2', topic: 'B2', filepath: 'b2.md', children: [], expanded: true },
                        ],
                        expanded: true,
                    },
                ],
                expanded: true,
            };

            const normalResult = convertToFlowElements(tree);
            const compactResult = convertToFlowElements(tree, { compact: true });

            const getSpan = (nodes: typeof normalResult.nodes) => {
                const ys = nodes.map(n => n.position.y);
                return Math.max(...ys) - Math.min(...ys);
            };

            expect(getSpan(compactResult.nodes)).toBeLessThan(getSpan(normalResult.nodes));
        });

        it('should produce shorter total height for asymmetric trees in compact mode', () => {
            // One deep branch + one shallow branch
            const tree: MindNode = {
                id: 'root',
                topic: 'Root',
                filepath: 'root.md',
                children: [
                    {
                        id: 'deep', topic: 'Deep', filepath: 'deep.md',
                        children: [
                            { id: 'd1', topic: 'D1', filepath: 'd1.md', children: [], expanded: true },
                            { id: 'd2', topic: 'D2', filepath: 'd2.md', children: [], expanded: true },
                            { id: 'd3', topic: 'D3', filepath: 'd3.md', children: [], expanded: true },
                            { id: 'd4', topic: 'D4', filepath: 'd4.md', children: [], expanded: true },
                        ],
                        expanded: true,
                    },
                    {
                        id: 'shallow', topic: 'Shallow', filepath: 'shallow.md',
                        children: [],
                        expanded: true,
                    },
                ],
                expanded: true,
            };

            const normalResult = convertToFlowElements(tree);
            const compactResult = convertToFlowElements(tree, { compact: true });

            // Compute total height span (max y - min y across all nodes)
            const getSpan = (nodes: typeof normalResult.nodes) => {
                const ys = nodes.map(n => n.position.y);
                return Math.max(...ys) - Math.min(...ys);
            };

            expect(getSpan(compactResult.nodes)).toBeLessThan(getSpan(normalResult.nodes));
        });

        it('should not produce vertical overlap at the same depth in compact mode', () => {
            const tree: MindNode = {
                id: 'root',
                topic: 'Root',
                filepath: 'root.md',
                children: [
                    {
                        id: 'A', topic: 'A', filepath: 'a.md',
                        children: [
                            { id: 'A1', topic: 'A1', filepath: 'a1.md', children: [], expanded: true },
                        ],
                        expanded: true,
                    },
                    {
                        id: 'B', topic: 'B', filepath: 'b.md',
                        children: [
                            { id: 'B1', topic: 'B1', filepath: 'b1.md', children: [], expanded: true },
                            { id: 'B2', topic: 'B2', filepath: 'b2.md', children: [], expanded: true },
                        ],
                        expanded: true,
                    },
                    {
                        id: 'C', topic: 'C', filepath: 'c.md',
                        children: [
                            { id: 'C1', topic: 'C1', filepath: 'c1.md', children: [], expanded: true },
                        ],
                        expanded: true,
                    },
                ],
                expanded: true,
            };

            const { nodes } = convertToFlowElements(tree, { compact: true });

            // Group nodes by depth
            const byDepth = new Map<number, typeof nodes>();
            for (const n of nodes) {
                const depth = n.data.depth;
                if (!byDepth.has(depth)) byDepth.set(depth, []);
                byDepth.get(depth)!.push(n);
            }

            // At each depth, verify no two nodes overlap vertically
            for (const [depth, depthNodes] of byDepth) {
                const sorted = [...depthNodes].sort((a, b) => a.position.y - b.position.y);
                for (let i = 1; i < sorted.length; i++) {
                    const prevBottom = sorted[i - 1].position.y + (sorted[i - 1].style?.height as number ?? 40);
                    const currTop = sorted[i].position.y;
                    expect(currTop).toBeGreaterThanOrEqual(prevBottom);
                }
            }
        });
    });

    describe('findNodeInTree', () => {
        it('should find root node', () => {
            const tree = createSampleTree();
            const found = findNodeInTree(tree, 'root');
            expect(found?.id).toBe('root');
        });

        it('should find nested node', () => {
            const tree = createSampleTree();
            const found = findNodeInTree(tree, 'grandchild1');
            expect(found?.id).toBe('grandchild1');
        });

        it('should return null for non-existent node', () => {
            const tree = createSampleTree();
            const found = findNodeInTree(tree, 'nonexistent');
            expect(found).toBeNull();
        });
    });

    describe('toggleNodeExpanded', () => {
        it('should toggle expanded state', () => {
            const tree = createSampleTree();
            const toggled = toggleNodeExpanded(tree, 'child1');

            const child1 = findNodeInTree(toggled, 'child1');
            expect(child1?.expanded).toBe(false);
        });

        it('should not mutate original tree', () => {
            const tree = createSampleTree();
            toggleNodeExpanded(tree, 'child1');

            const original = findNodeInTree(tree, 'child1');
            expect(original?.expanded).toBe(true);
        });
    });

    describe('addChildNode', () => {
        it('should add child to specified parent', () => {
            const tree = createSampleTree();
            const newNode: MindNode = {
                id: 'newchild',
                topic: 'New Child',
                filepath: 'newchild.md',
                children: [],
                expanded: true,
            };

            const updated = addChildNode(tree, 'child1', newNode);
            const child1 = findNodeInTree(updated, 'child1');

            expect(child1?.children).toHaveLength(2);
            expect(child1?.children[1].id).toBe('newchild');
        });

        it('should auto-expand parent when adding child', () => {
            const tree: MindNode = {
                id: 'root',
                topic: 'Root',
                filepath: 'root.md',
                children: [],
                expanded: false,
            };
            const newNode: MindNode = {
                id: 'child',
                topic: 'Child',
                filepath: 'child.md',
                children: [],
                expanded: true,
            };

            const updated = addChildNode(tree, 'root', newNode);
            expect(updated.expanded).toBe(true);
        });
    });

    describe('removeNode', () => {
        it('should remove node from tree', () => {
            const tree = createSampleTree();
            const updated = removeNode(tree, 'child2');

            expect(updated?.children).toHaveLength(1);
            expect(findNodeInTree(updated!, 'child2')).toBeNull();
        });

        it('should remove nested node', () => {
            const tree = createSampleTree();
            const updated = removeNode(tree, 'grandchild1');

            const child1 = findNodeInTree(updated!, 'child1');
            expect(child1?.children).toHaveLength(0);
        });

        it('should return null when removing root', () => {
            const tree = createSampleTree();
            const updated = removeNode(tree, 'root');
            expect(updated).toBeNull();
        });
    });

    describe('updateNodeTopic', () => {
        it('should update node topic', () => {
            const tree = createSampleTree();
            const updated = updateNodeTopic(tree, 'child1', 'Updated Topic');

            const child1 = findNodeInTree(updated, 'child1');
            expect(child1?.topic).toBe('Updated Topic');
        });

        it('should not mutate original tree', () => {
            const tree = createSampleTree();
            updateNodeTopic(tree, 'child1', 'Updated Topic');

            const original = findNodeInTree(tree, 'child1');
            expect(original?.topic).toBe('Child 1');
        });
    });
    describe('addSiblingNode', () => {
        it('should add sibling below', () => {
            const tree = createSampleTree();
            const newNode: MindNode = {
                id: 'sibling',
                topic: 'New Sibling',
                filepath: 'sibling.md',
                children: [],
                expanded: true,
            };

            const updated = addSiblingNode(tree, 'child1', newNode, 'below');
            const root = findNodeInTree(updated, 'root');

            expect(root?.children).toHaveLength(3);
            expect(root?.children![1].id).toBe('sibling');
            expect(root?.children![0].id).toBe('child1');
        });

        it('should add sibling above', () => {
            const tree = createSampleTree();
            const newNode: MindNode = {
                id: 'sibling',
                topic: 'New Sibling',
                filepath: 'sibling.md',
                children: [],
                expanded: true,
            };

            const updated = addSiblingNode(tree, 'child1', newNode, 'above');
            const root = findNodeInTree(updated, 'root');

            expect(root?.children).toHaveLength(3);
            expect(root?.children![0].id).toBe('sibling');
            expect(root?.children![1].id).toBe('child1');
        });
    });
});
