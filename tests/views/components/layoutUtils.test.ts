/**
 * Tests for layoutUtils
 */
import { describe, it, expect } from 'vitest';
import {
    convertToFlowElements,
    findNodeInTree,
    toggleNodeExpanded,
    addChildNode,
    removeNode,
    updateNodeTopic,
} from '../../../src/views/components/layoutUtils';
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
});
