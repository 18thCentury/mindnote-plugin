/**
 * Tree Operations — Pure functions for MindNode tree CRUD
 * No React Flow or DOM dependencies
 */
import type { MindNode } from '../../types';

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

/**
 * Find the parent node of a given node ID
 */
export function findParentNode(root: MindNode, childId: string): MindNode | null {
    if (root.children) {
        for (const child of root.children) {
            if (child.id === childId) {
                return root;
            }
            const found = findParentNode(child, childId);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Add a sibling node
 */
export function addSiblingNode(root: MindNode, siblingId: string, newNode: MindNode, direction: 'above' | 'below'): MindNode {
    // 1. Traverse to find parent of siblingId
    function traverse(node: MindNode): MindNode {
        if (node.children) {
            const index = node.children.findIndex(c => c.id === siblingId);
            if (index !== -1) {
                // Found parent!
                const newChildren = [...node.children];
                if (direction === 'above') {
                    newChildren.splice(index, 0, newNode);
                } else {
                    newChildren.splice(index + 1, 0, newNode);
                }
                return { ...node, children: newChildren };
            }
            // Continue search
            return {
                ...node,
                children: node.children.map(traverse)
            };
        }
        return node;
    }

    // Check if root is sibling (cannot add sibling to root usually, unless forest, but here single tree)
    if (root.id === siblingId) return root;

    return traverse(root);
}
