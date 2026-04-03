import { describe, expect, it } from 'vitest';
import type { MindNode } from '../../../src/types';
import {
    canMoveNode,
    moveNodeAsChild,
    moveNodeAsSiblingAbove,
    moveNodeAsSiblingBelow,
} from '../../../src/views/components/treeMovement';

const createTree = (): MindNode => ({
    id: 'root',
    topic: 'Root',
    filepath: 'root.md',
    expanded: true,
    children: [
        {
            id: 'a',
            topic: 'A',
            filepath: 'a.md',
            expanded: true,
            children: [
                {
                    id: 'a1',
                    topic: 'A1',
                    filepath: 'a1.md',
                    expanded: true,
                    children: [],
                },
            ],
        },
        {
            id: 'b',
            topic: 'B',
            filepath: 'b.md',
            expanded: true,
            children: [],
        },
        {
            id: 'c',
            topic: 'C',
            filepath: 'c.md',
            expanded: true,
            children: [],
        },
    ],
});

describe('treeMovement', () => {
    describe('canMoveNode', () => {
        it('rejects moving root', () => {
            expect(canMoveNode(createTree(), 'root', 'a', 'child')).toBe(false);
        });

        it('rejects moving a node under itself', () => {
            expect(canMoveNode(createTree(), 'a', 'a', 'child')).toBe(false);
        });

        it('rejects moving a node into its descendant', () => {
            expect(canMoveNode(createTree(), 'a', 'a1', 'child')).toBe(false);
        });

        it('accepts normal move', () => {
            expect(canMoveNode(createTree(), 'b', 'a', 'child')).toBe(true);
        });
    });

    it('moves node as child', () => {
        const updated = moveNodeAsChild(createTree(), 'b', 'a');
        const aNode = updated.children[0];
        expect(aNode.children.map((child) => child.id)).toEqual(['a1', 'b']);
        expect(updated.children.map((child) => child.id)).toEqual(['a', 'c']);
    });

    it('moves node as sibling above', () => {
        const updated = moveNodeAsSiblingAbove(createTree(), 'c', 'a');
        expect(updated.children.map((child) => child.id)).toEqual(['c', 'a', 'b']);
    });

    it('moves node as sibling below', () => {
        const updated = moveNodeAsSiblingBelow(createTree(), 'a', 'c');
        expect(updated.children.map((child) => child.id)).toEqual(['b', 'c', 'a']);
    });

    it('returns original tree for invalid sibling move', () => {
        const tree = createTree();
        expect(moveNodeAsSiblingAbove(tree, 'a', 'a1')).toEqual(tree);
    });
});
