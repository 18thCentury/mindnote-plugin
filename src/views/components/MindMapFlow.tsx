/**
 * MindMapFlow - Main React Flow component for the mindmap
 * Handles rendering, interactions, and clipboard operations
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    useNodesState,
    useEdgesState,
    ReactFlowProvider,
    type Node,
    type Edge,
    type NodeMouseHandler,
    SelectionMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { MindMapNode } from './MindMapNode';
import {
    convertToFlowElements,
    findNodeInTree,
    type MindMapNodeData,
    type LayoutOptions,
} from './layoutUtils';
import type { MindNode, MindMapData, Direction } from '../../types';

import { useMindMapTree } from './hooks/useMindMapTree';
import { useNodeDrag } from './hooks/useNodeDrag';
import { useClipboard } from './hooks/useClipboard';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

// Register custom node types
const nodeTypes = {
    mindMapNode: MindMapNode,
};

export interface MindMapFlowProps {
    mapData: MindMapData;
    settings: {
        direction: Direction;
        horizontalGap: number;
        verticalGap: number;
        theme: 'primary' | 'dark' | 'auto';
        lineWidth: number;
    };
    contentMap: Map<string, boolean>;
    onNodeSelect?: (node: MindNode) => void;
    onNodeCreate?: (node: MindNode, parentId: string) => void;
    onNodeDelete?: (node: MindNode) => void;
    onNodeRename?: (node: MindNode, oldTopic: string) => void;
    onMapDataChange?: (data: MindMapData) => void;
    onDrop?: (files: FileList, targetNodeId: string | null) => void;
    onPaste?: (files: File[], targetNodeId: string | null) => void;
    resolveImageUrl?: (relativePath: string) => string;
}

function MindMapFlowInner({
    mapData,
    settings,
    contentMap,
    onNodeSelect,
    onNodeCreate,
    onNodeDelete,
    onNodeRename,
    onMapDataChange,
    onDrop,
    onPaste,
    resolveImageUrl,
}: MindMapFlowProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState<Node<MindMapNodeData>>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const containerRef = useRef<HTMLDivElement>(null);

    // 1. Tree State & Operations
    const {
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
    } = useMindMapTree({
        mapData,
        onMapDataChange,
        onNodeRename,
        onNodeCreate,
        onNodeDelete,
    });

    // 2. Drag & Drop
    const {
        dragState,
        handleNodeDragStart,
        handleNodeDrag,
        handleNodeDragStop,
    } = useNodeDrag({
        treeDataRef,
        selectedNodeIds,
        setSelectedNodeIds,
        setTreeData,
        onMapDataChange,
    });

    // 3. Clipboard
    const {
        copyNode,
        cutNode,
        pasteNode,
    } = useClipboard({
        treeDataRef,
        selectedNodeIds,
        setTreeData,
        onMapDataChange,
        onNodeCreate,
        onPaste,
        generateId,
    });

    // 4. Keyboard Shortcuts
    useKeyboardShortcuts({
        selectedNodeIds,
        copyNode,
        cutNode,
        pasteNode,
        addSibling,
        deleteSelected,
        addChild,
        setEditTrigger,
        handleToggleExpand,
    });

    // Layout options from settings
    const layoutOptions: Partial<LayoutOptions> = useMemo(() => ({
        direction: settings.direction,
        horizontalGap: settings.horizontalGap,
        verticalGap: settings.verticalGap,
        lineWidth: settings.lineWidth,
    }), [settings]);

    // Convert tree to flow elements whenever tree changes
    useEffect(() => {
        // Process image URLs for display
        const { nodes: newNodes, edges: newEdges } = convertToFlowElements(
            treeData,
            layoutOptions,
            contentMap,
            {
                onToggleExpand: handleToggleExpand,
                onNodeRename: handleNodeRename,
                editTrigger: editTrigger,
                resolveImageUrl: resolveImageUrl,
            }
        );

        // Add drag state and selection state to nodes
        const nodesWithState = newNodes.map(node => ({
            ...node,
            selected: selectedNodeIds.has(node.id),
            data: {
                ...node.data,
                isDragging: false,
                dropZone: null,
            },
        }));

        setNodes(nodesWithState);
        setEdges(newEdges);
    }, [
        treeData,
        layoutOptions,
        contentMap,
        setNodes,
        setEdges,
        resolveImageUrl,
        handleToggleExpand,
        handleNodeRename,
        editTrigger,
        selectedNodeIds
    ]);

    // Update node drag states separately (without regenerating layout)
    useEffect(() => {
        setNodes(nds => nds.map(node => ({
            ...node,
            data: {
                ...node.data,
                isDragging: dragState.draggedNodeId === node.id,
                dropZone: dragState.targetNodeId === node.id ? dragState.dropZone : null,
            },
        })));
    }, [dragState, setNodes]);

    // Handle node selection click
    const handleNodeClick: NodeMouseHandler = useCallback((event, node) => {
        const isMultiSelect = event.shiftKey || event.ctrlKey || event.metaKey;

        setSelectedNodeIds(prev => {
            const next = new Set(isMultiSelect ? prev : []);
            if (isMultiSelect && prev.has(node.id)) {
                next.delete(node.id);
            } else {
                next.add(node.id);
            }
            return next;
        });

        // Use ref to get current tree data (avoids stale closure)
        const currentTree = treeDataRef.current;
        const mindNode = findNodeInTree(currentTree, node.id);
        if (mindNode) {
            onNodeSelect?.(mindNode);
        }
    }, [onNodeSelect, treeDataRef, setSelectedNodeIds]);

    const handlePaneClick = useCallback(() => {
        setSelectedNodeIds(new Set());
    }, [setSelectedNodeIds]);

    return (
        <div style={{ width: '100%', height: '100%' }} ref={containerRef}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                onNodeClick={handleNodeClick}
                onPaneClick={handlePaneClick}
                onNodeDragStart={handleNodeDragStart}
                onNodeDrag={handleNodeDrag}
                onNodeDragStop={handleNodeDragStop}
                fitView
                selectionMode={SelectionMode.Partial}
                minZoom={0.1}
                maxZoom={2}
                nodesDraggable={true}
                nodesConnectable={false}
                proOptions={{ hideAttribution: true }}
            >
                <Background />
                <Controls />
                <MiniMap />
            </ReactFlow>
        </div>
    );
}

export function MindMapFlow(props: MindMapFlowProps) {
    return (
        <ReactFlowProvider>
            <MindMapFlowInner {...props} />
        </ReactFlowProvider>
    );
}
