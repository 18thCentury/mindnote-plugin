/**
 * Tree Movement Operations — Drag & drop move logic
 * Validates and executes node moves within the tree
 */
import type { MindNode } from '../../types';
import { findNodeInTree, findParentNode, removeNode, addChildNode } from './treeOperations';

/**
 * Check if a node is a descendant of another node
 */
function isDescendant(root: MindNode, ancestorId: string, descendantId: string): boolean {
    if (root.id === ancestorId) {
        return findNodeInTree(root, descendantId) !== null;
    }
    if (root.children) {
        for (const child of root.children) {
            if (isDescendant(child, ancestorId, descendantId)) {
                return true;
            }
        }
    }
    return false;
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

/**
 * Move a node to become a sibling above the target node
 */
export function moveNodeAsSiblingAbove(root: MindNode, nodeId: string, targetId: string): MindNode {
    if (!canMoveNode(root, nodeId, targetId, 'sibling')) {
        return root;
    }

    // Find the node to move
    const nodeToMove = findNodeInTree(root, nodeId);
    if (!nodeToMove) return root;

    // Find target's parent
    const targetParent = findParentNode(root, targetId);
    if (!targetParent) return root;

    // Remove node from its current location
    const treeWithoutNode = removeNode(root, nodeId);
    if (!treeWithoutNode) return root;

    // Insert node above target in parent's children array
    const parentId = targetParent.id;
    const safeTree: MindNode = treeWithoutNode;
    function insertAbove(node: MindNode): MindNode {
        if (node.id === parentId) {
            const targetIndex = node.children.findIndex(child => child.id === targetId);
            if (targetIndex === -1) return node;

            const newChildren = [...node.children];
            newChildren.splice(targetIndex, 0, nodeToMove!);

            return {
                ...node,
                children: newChildren,
            };
        }

        if (node.children) {
            return {
                ...node,
                children: node.children.map(child => insertAbove(child)),
            };
        }

        return node;
    }

    return insertAbove(safeTree);
}

/**
 * Move a node to become a sibling below the target node
 */
export function moveNodeAsSiblingBelow(root: MindNode, nodeId: string, targetId: string): MindNode {
    if (!canMoveNode(root, nodeId, targetId, 'sibling')) {
        return root;
    }

    // Find the node to move
    const nodeToMove = findNodeInTree(root, nodeId);
    if (!nodeToMove) return root;

    // Find target's parent
    const targetParent = findParentNode(root, targetId);
    if (!targetParent) return root;

    // Remove node from its current location
    const treeWithoutNode = removeNode(root, nodeId);
    if (!treeWithoutNode) return root;

    // Insert node below target in parent's children array
    const parentId = targetParent.id;
    const safeTree: MindNode = treeWithoutNode;
    function insertBelow(node: MindNode): MindNode {
        if (node.id === parentId) {
            const targetIndex = node.children.findIndex(child => child.id === targetId);
            if (targetIndex === -1) return node;

            const newChildren = [...node.children];
            newChildren.splice(targetIndex + 1, 0, nodeToMove!);

            return {
                ...node,
                children: newChildren,
            };
        }

        if (node.children) {
            return {
                ...node,
                children: node.children.map(child => insertBelow(child)),
            };
        }

        return node;
    }

    return insertBelow(safeTree);
}
