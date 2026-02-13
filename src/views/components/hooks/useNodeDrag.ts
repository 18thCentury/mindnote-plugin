import { useState, useCallback } from 'react';
import type { NodeMouseHandler, OnNodeDrag } from '@xyflow/react';
import { findParentNode } from '../treeOperations';
import {
    moveNodeAsChild,
    moveNodeAsSiblingAbove,
    moveNodeAsSiblingBelow,
} from '../treeMovement';
import type { MindNode, MindMapData } from '../../../types';

export interface UseNodeDragProps {
    treeDataRef: React.MutableRefObject<MindNode>;
    selectedNodeIds: Set<string>;
    setSelectedNodeIds: React.Dispatch<React.SetStateAction<Set<string>>>;
    setTreeData: React.Dispatch<React.SetStateAction<MindNode>>;
    onMapDataChange?: (data: MindMapData) => void;
}

export function useNodeDrag({
    treeDataRef,
    selectedNodeIds,
    setSelectedNodeIds,
    setTreeData,
    onMapDataChange,
}: UseNodeDragProps) {
    const [dragState, setDragState] = useState<{
        draggedNodeId: string | null;
        targetNodeId: string | null;
        dropZone: 'above' | 'child' | 'below' | null;
        isExternalFileDrag: boolean;
    }>({
        draggedNodeId: null,
        targetNodeId: null,
        dropZone: null,
        isExternalFileDrag: false,
    });

    const handleNodeDragStart: NodeMouseHandler = useCallback((event, node) => {
        const isSelected = selectedNodeIds.has(node.id);
        const isModifier = event.shiftKey || event.ctrlKey || event.metaKey;

        if (!isSelected && !isModifier) {
            setSelectedNodeIds(new Set([node.id]));
        } else if (!isSelected && isModifier) {
            setSelectedNodeIds(prev => new Set([...prev, node.id]));
        }

        setDragState({
            draggedNodeId: node.id,
            targetNodeId: null,
            dropZone: null,
            isExternalFileDrag: false,
        });
    }, [selectedNodeIds, setSelectedNodeIds]);

    const handleNodeDrag: OnNodeDrag = useCallback((event, node, nodes) => {
        const draggedId = node.id;
        const mouseEvent = event as React.MouseEvent;
        const mouseX = mouseEvent.clientX;
        const mouseY = mouseEvent.clientY;

        const elements = document.elementsFromPoint(mouseX, mouseY);

        let targetNodeId: string | null = null;
        let dropZone: 'above' | 'child' | 'below' | null = null;

        for (const el of elements) {
            const nodeEl = el.closest('.react-flow__node');
            if (nodeEl) {
                const id = nodeEl.getAttribute('data-id');
                if (id && id !== draggedId) {
                    targetNodeId = id;

                    const rect = nodeEl.getBoundingClientRect();
                    const relativeY = (mouseY - rect.top) / rect.height;

                    if (relativeY < 0.25) {
                        dropZone = 'above';
                    } else if (relativeY > 0.75) {
                        dropZone = 'below';
                    } else {
                        dropZone = 'child';
                    }
                    break;
                }
            }
        }

        setDragState(prev => {
            if (prev.targetNodeId === targetNodeId && prev.dropZone === dropZone) {
                return prev;
            }
            return {
                ...prev,
                targetNodeId: targetNodeId!,
                dropZone,
            };
        });
    }, []);

    const handleNodeDragStop: NodeMouseHandler = useCallback(() => {
        const { draggedNodeId, targetNodeId, dropZone } = dragState;

        if (!draggedNodeId || !targetNodeId || !dropZone) {
            setDragState({
                draggedNodeId: null,
                targetNodeId: null,
                dropZone: null,
                isExternalFileDrag: false,
            });
            setTreeData(prev => ({ ...prev }));
            return;
        }

        const currentTree = treeDataRef.current;
        let newTree = currentTree;

        const nodesToMove = selectedNodeIds.has(draggedNodeId)
            ? Array.from(selectedNodeIds)
            : [draggedNodeId];

        const independentNodesToMove = nodesToMove.filter(id => {
            let walker = findParentNode(currentTree, id);
            while (walker) {
                if (nodesToMove.includes(walker.id)) return false;
                walker = findParentNode(currentTree, walker.id);
            }
            return true;
        });

        let changed = false;

        for (const nodeId of independentNodesToMove) {
            if (nodeId === targetNodeId) continue;

            let treeAfterMove = newTree;

            switch (dropZone) {
                case 'child':
                    treeAfterMove = moveNodeAsChild(newTree, nodeId, targetNodeId);
                    break;
                case 'above':
                    treeAfterMove = moveNodeAsSiblingAbove(newTree, nodeId, targetNodeId);
                    break;
                case 'below':
                    treeAfterMove = moveNodeAsSiblingBelow(newTree, nodeId, targetNodeId);
                    break;
            }

            if (treeAfterMove !== newTree) {
                newTree = treeAfterMove;
                changed = true;
            }
        }

        if (changed) {
            setTreeData(newTree);
            onMapDataChange?.({ nodeData: newTree });
        } else {
            setTreeData(prev => ({ ...prev }));
        }

        setDragState({
            draggedNodeId: null,
            targetNodeId: null,
            dropZone: null,
            isExternalFileDrag: false,
        });
    }, [dragState, onMapDataChange, selectedNodeIds, treeDataRef, setTreeData]);

    return {
        dragState,
        setDragState,
        handleNodeDragStart,
        handleNodeDrag,
        handleNodeDragStop,
    };
}
