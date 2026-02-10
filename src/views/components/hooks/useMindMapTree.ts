import { useState, useRef, useEffect, useCallback } from 'react';
import {
    addChildNode,
    removeNode,
    addSiblingNode,
    updateNodeTopic,
    findNodeInTree,
    toggleNodeExpanded,
} from '../layoutUtils';
import type { MindNode, MindMapData } from '../../../types';

export interface UseMindMapTreeProps {
    mapData: MindMapData;
    onMapDataChange?: (data: MindMapData) => void;
    onNodeRename?: (node: MindNode, oldTopic: string) => void;
    onNodeCreate?: (node: MindNode, parentId: string) => void;
    onNodeDelete?: (node: MindNode) => void;
}

export function useMindMapTree({
    mapData,
    onMapDataChange,
    onNodeRename,
    onNodeCreate,
    onNodeDelete,
}: UseMindMapTreeProps) {
    const [treeData, setTreeData] = useState<MindNode>(mapData.nodeData);
    const [editTrigger, setEditTrigger] = useState<{ id: string; ts: number } | null>(null);
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());

    // Track the last data we pushed via onMapDataChange to distinguish
    // external changes from our own updates (prevents delete revert bug)
    const lastPushedDataRef = useRef<MindNode>(mapData.nodeData);

    // Use a ref to always have current treeData in callbacks (avoids stale closure)
    const treeDataRef = useRef<MindNode>(treeData);

    // Keep ref in sync with state
    useEffect(() => {
        treeDataRef.current = treeData;
    }, [treeData]);

    // Update tree when mapData prop changes externally
    useEffect(() => {
        // Only sync when mapData was changed externally (not by our own push)
        if (mapData.nodeData !== lastPushedDataRef.current) {
            setTreeData(mapData.nodeData);
            lastPushedDataRef.current = mapData.nodeData;
        }
    }, [mapData]);

    // Generate unique ID
    const generateId = useCallback(() => {
        return Math.random().toString(16).slice(2, 18);
    }, []);

    // Handle collapse/expand toggle
    const handleToggleExpand = useCallback((nodeId: string) => {
        setTreeData(prev => {
            const newTree = toggleNodeExpanded(prev, nodeId);
            lastPushedDataRef.current = newTree;
            onMapDataChange?.({ nodeData: newTree });
            return newTree;
        });
    }, [onMapDataChange]);

    // Handle node rename
    const handleNodeRename = useCallback((nodeId: string, newTopic: string) => {
        setTreeData(prev => {
            const oldNode = findNodeInTree(prev, nodeId);
            if (oldNode && oldNode.topic !== newTopic) {
                const newTree = updateNodeTopic(prev, nodeId, newTopic);
                lastPushedDataRef.current = newTree;
                onMapDataChange?.({ nodeData: newTree });

                const newNode = findNodeInTree(newTree, nodeId);
                if (newNode) {
                    onNodeRename?.(newNode, oldNode.topic);
                }
                return newTree;
            }
            return prev;
        });
    }, [onMapDataChange, onNodeRename]);

    // Add sibling
    const addSibling = useCallback((direction: 'above' | 'below') => {
        const currentTree = treeDataRef.current;
        if (selectedNodeIds.size === 0) return;

        const targetId = Array.from(selectedNodeIds)[selectedNodeIds.size - 1];
        if (targetId === currentTree.id) return; // Root cannot have sibling

        const newNode: MindNode = {
            id: generateId(),
            topic: 'New Sibling',
            filepath: '',
            children: [],
            expanded: true,
        };

        const newTree = addSiblingNode(currentTree, targetId, newNode, direction);
        setTreeData(newTree);
        lastPushedDataRef.current = newTree;
        onMapDataChange?.({ nodeData: newTree });

        setSelectedNodeIds(new Set([newNode.id]));
        setTimeout(() => {
            setEditTrigger({ id: newNode.id, ts: Date.now() });
        }, 50);

    }, [selectedNodeIds, generateId, onMapDataChange]);

    // Add child to selected node
    const addChild = useCallback(() => {
        const currentTree = treeDataRef.current;
        const targetId = selectedNodeIds.size > 0
            ? Array.from(selectedNodeIds)[selectedNodeIds.size - 1]
            : currentTree.id;

        const parentId = targetId || currentTree.id;
        const newNode: MindNode = {
            id: generateId(),
            topic: 'New Node',
            filepath: '',
            children: [],
            expanded: true,
        };

        const newTree = addChildNode(currentTree, parentId, newNode);
        setTreeData(newTree);
        lastPushedDataRef.current = newTree;
        onMapDataChange?.({ nodeData: newTree });
        onNodeCreate?.(newNode, parentId);

        setSelectedNodeIds(new Set([newNode.id]));
        setTimeout(() => {
            setEditTrigger({ id: newNode.id, ts: Date.now() });
        }, 50);
    }, [selectedNodeIds, generateId, onMapDataChange, onNodeCreate]);

    // Delete selected node
    const deleteSelected = useCallback(() => {
        const currentTree = treeDataRef.current;
        if (selectedNodeIds.size === 0) return;

        let newTree = currentTree;
        const deletedNodes: MindNode[] = [];

        selectedNodeIds.forEach(id => {
            if (id === currentTree.id) return; // Can't delete root
            const nodeToDelete = findNodeInTree(newTree, id);
            if (nodeToDelete) {
                const updatedTree = removeNode(newTree, id);
                if (updatedTree) {
                    newTree = updatedTree;
                    deletedNodes.push(nodeToDelete);
                }
            }
        });

        if (newTree !== currentTree) {
            setTreeData(newTree);
            lastPushedDataRef.current = newTree;
            onMapDataChange?.({ nodeData: newTree });
            deletedNodes.forEach(n => onNodeDelete?.(n));
            setSelectedNodeIds(new Set());
        }
    }, [selectedNodeIds, onMapDataChange, onNodeDelete]);

    return {
        treeData,
        setTreeData,
        treeDataRef,
        selectedNodeIds,
        setSelectedNodeIds,
        editTrigger,
        setEditTrigger,
        handleToggleExpand,
        handleNodeRename,
        addSibling,
        addChild,
        deleteSelected,
        generateId,
    };
}
