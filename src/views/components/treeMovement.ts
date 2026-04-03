/**
 * Tree Movement Operations — Drag & drop move logic
 * Validates and executes node moves within the tree
 */
import type { MindNode } from '../../types';
import { addChildNode, addSiblingNode, findNodeInTree, findParentNode, removeNode } from './treeOperations';

/**
 * Check if a node is a descendant of another node
 */
function isDescendant(root: MindNode, ancestorId: string, descendantId: string): boolean {
    const ancestorNode = findNodeInTree(root, ancestorId);
    if (!ancestorNode) {
        return false;
    }

    return findNodeInTree(ancestorNode, descendantId) !== null;
}

/**
 * Validate if a node can be moved to a target location
 * Returns true if the move is valid, false otherwise
 */
export function canMoveNode(
    root: MindNode,
    nodeId: string,
    targetId: string,
    moveType: 'child' | 'sibling'
): boolean {
    // Cannot move root node
    if (root.id === nodeId) {
        return false;
    }

    // Cannot move to itself
    if (nodeId === targetId) {
        return false;
    }

    // Cannot move a parent into its own descendant
    if (isDescendant(root, nodeId, targetId)) {
        return false;
    }

    // For sibling moves, target must have a parent
    if (moveType === 'sibling') {
        const targetParent = findParentNode(root, targetId);
        if (!targetParent) {
            return false;
        }
    }

    return true;
}

/**
 * Move a node to become a child of the target node
 */
export function moveNodeAsChild(root: MindNode, nodeId: string, targetId: string): MindNode {
    if (!canMoveNode(root, nodeId, targetId, 'child')) {
        return root;
    }

    // Find the node to move
    const nodeToMove = findNodeInTree(root, nodeId);
    if (!nodeToMove) return root;

    // Remove node from its current location
    const treeWithoutNode = removeNode(root, nodeId);
    if (!treeWithoutNode) return root;

    // Add node as child of target
    return addChildNode(treeWithoutNode, targetId, nodeToMove);
}

function moveNodeAsSibling(root: MindNode, nodeId: string, targetId: string, direction: 'above' | 'below'): MindNode {
    if (!canMoveNode(root, nodeId, targetId, 'sibling')) {
        return root;
    }

    const nodeToMove = findNodeInTree(root, nodeId);
    if (!nodeToMove) {
        return root;
    }

    const treeWithoutNode = removeNode(root, nodeId);
    if (!treeWithoutNode) {
        return root;
    }

    return addSiblingNode(treeWithoutNode, targetId, nodeToMove, direction);
}

/**
 * Move a node to become a sibling above the target node
 */
export function moveNodeAsSiblingAbove(root: MindNode, nodeId: string, targetId: string): MindNode {
    return moveNodeAsSibling(root, nodeId, targetId, 'above');
}

/**
 * Move a node to become a sibling below the target node
 */
export function moveNodeAsSiblingBelow(root: MindNode, nodeId: string, targetId: string): MindNode {
    return moveNodeAsSibling(root, nodeId, targetId, 'below');
}
