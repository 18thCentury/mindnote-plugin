/**
 * MindMapFlow - Main React Flow component for the mindmap
 * Handles rendering, interactions, and clipboard operations
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ReactFlow,
    Background,
    Controls,
    ControlButton,
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
import { convertToFlowElements } from './layoutEngine';
import { findNodeInTree } from './treeOperations';
import type { MindMapNodeData, LayoutOptions } from './flowTypes';
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
        compact: boolean;
    };
    contentMap: Map<string, boolean>;
    onNodeSelect?: (node: MindNode) => void;
    onNodeCreate?: (node: MindNode, parentId: string, fileType?: 'markdown' | 'canvas') => void;
    onNodeDelete?: (node: MindNode) => void;
    onNodeRename?: (node: MindNode, oldTopic: string) => void;
    onNodeMove?: (node: MindNode, oldParentId: string, newParentId: string) => void;
    onMapDataChange?: (data: MindMapData) => void;
    onDrop?: (files: FileList, targetNodeId: string | null) => void;
    onPaste?: (files: File[], targetNodeId: string | null) => void;
    resolveImageUrl?: (relativePath: string) => string;
    onUndo?: () => void;
    onRedo?: () => void;
}

function MindMapFlowInner({
    mapData,
    settings,
    contentMap,
    onNodeSelect,
    onNodeCreate,
    onNodeDelete,
    onNodeRename,
    onNodeMove,
    onMapDataChange,
    onDrop,
    onPaste,
    resolveImageUrl,
    onUndo,
    onRedo,
}: MindMapFlowProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState<Node<MindMapNodeData>>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [liveTopicMap, setLiveTopicMap] = useState<Map<string, string>>(new Map());
    const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null);
    const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);

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
        onNodeMove,
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
        containerElement,
        selectedNodeIds,
        copyNode,
        cutNode,
        pasteNode,
        addSibling,
        deleteSelected,
        addChild,
        setEditTrigger,
        handleToggleExpand,
        undo: () => onUndo?.(),
        redo: () => onRedo?.(),
    });

    // Local compact state (allows in-view toggle, initialized from settings)
    const [isCompact, setIsCompact] = useState(settings.compact);

    // Sync local state when settings change externally
    useEffect(() => {
        setIsCompact(settings.compact);
    }, [settings.compact]);

    // Layout options from settings
    const layoutOptions: Partial<LayoutOptions> = useMemo(() => ({
        direction: settings.direction,
        horizontalGap: settings.horizontalGap,
        verticalGap: settings.verticalGap,
        lineWidth: settings.lineWidth,
        compact: isCompact,
    }), [settings, isCompact]);

    const handleEditTopicChange = useCallback((nodeId: string, draftTopic?: string) => {
        setLiveTopicMap(prev => {
            const next = new Map(prev);
            if (typeof draftTopic === 'string') {
                next.set(nodeId, draftTopic);
            } else {
                next.delete(nodeId);
            }
            return next;
        });
    }, []);

    // Convert tree to flow elements whenever tree changes
    useEffect(() => {
        // Process image URLs for display
        const { nodes: newNodes, edges: newEdges } = convertToFlowElements(
            treeData,
            layoutOptions,
            contentMap,
            liveTopicMap,
            {
                onToggleExpand: handleToggleExpand,
                onNodeRename: handleNodeRename,
                onEditTopicChange: handleEditTopicChange,
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
        liveTopicMap,
        setNodes,
        setEdges,
        resolveImageUrl,
        handleToggleExpand,
        handleNodeRename,
        handleEditTopicChange,
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
        setContextMenu(null);
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
        setContextMenu(null);
        setSelectedNodeIds(new Set());
    }, [setSelectedNodeIds]);

    const handleNodeContextMenu: NodeMouseHandler = useCallback((event, node) => {
        event.preventDefault();
        event.stopPropagation();
        setSelectedNodeIds(new Set([node.id]));
        setContextMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
    }, [setSelectedNodeIds]);

    useEffect(() => {
        if (!contextMenu) return;

        const closeMenu = () => setContextMenu(null);
        const handleEsc = (event: KeyboardEvent) => {
            if (event.key === 'Escape') closeMenu();
        };
        document.addEventListener('click', closeMenu);
        document.addEventListener('contextmenu', closeMenu);
        document.addEventListener('keydown', handleEsc);
        return () => {
            document.removeEventListener('click', closeMenu);
            document.removeEventListener('contextmenu', closeMenu);
            document.removeEventListener('keydown', handleEsc);
        };
    }, [contextMenu]);

    const triggerEditSelectedNode = useCallback(() => {
        const targetId = contextMenu?.nodeId;
        if (!targetId) return;
        setSelectedNodeIds(new Set([targetId]));
        setEditTrigger({ id: targetId, ts: Date.now() });
        setContextMenu(null);
    }, [contextMenu?.nodeId, setEditTrigger, setSelectedNodeIds]);

    const handleCreateChildFromContext = useCallback((fileType: 'markdown' | 'canvas') => {
        const targetId = contextMenu?.nodeId;
        if (!targetId) return;
        setSelectedNodeIds(new Set([targetId]));
        addChild(fileType, targetId);
        setContextMenu(null);
    }, [addChild, contextMenu?.nodeId, setSelectedNodeIds]);

    const handleDeleteFromContext = useCallback(() => {
        const targetId = contextMenu?.nodeId;
        if (!targetId) return;
        setSelectedNodeIds(new Set([targetId]));
        deleteSelected(new Set([targetId]));
        setContextMenu(null);
    }, [contextMenu?.nodeId, deleteSelected, setSelectedNodeIds]);

    const handleDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    }, []);

    const handleDrop = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
            // TODO: Better target detection using elementFromPoint if needed
            // For now, dropping on the canvas defaults to no target (root or context sensitive)
            onDrop?.(event.dataTransfer.files, null);
        }
    }, [onDrop]);

    return (
        <div
            style={{ width: '100%', height: '100%' }}
            ref={setContainerElement}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                onNodeClick={handleNodeClick}
                onNodeContextMenu={handleNodeContextMenu}
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
                <Controls showInteractive={false}>
                    <ControlButton
                        className={`mindnote-compact-toggle ${isCompact ? 'active' : ''}`}
                        onClick={() => setIsCompact(v => !v)}
                        aria-label={isCompact ? 'Switch to normal layout' : 'Switch to compact layout'}
                        title={isCompact ? 'Normal layout' : 'Compact layout'}
                    >
                        {isCompact ? '⊟' : '⊞'}
                    </ControlButton>
                </Controls>
                <MiniMap />

            </ReactFlow>
            {contextMenu && (
                <div
                    className="mindnote-context-menu menu"
                    style={{ left: contextMenu.x, top: contextMenu.y, position: 'fixed' }}
                    onClick={(event) => event.stopPropagation()}
                    role="menu"
                    aria-label="Node context menu"
                >
                    <button className="menu-item" type="button" onClick={() => handleCreateChildFromContext('markdown')}>
                        <span className="menu-item-title">新建子节点</span>
                    </button>
                    <button className="menu-item" type="button" onClick={() => handleCreateChildFromContext('canvas')}>
                        <span className="menu-item-title">新建 Canvas 子节点</span>
                    </button>
                    <button className="menu-item" type="button" onClick={triggerEditSelectedNode}>
                        <span className="menu-item-title">重命名节点</span>
                    </button>
                    <div className="menu-separator" />
                    <button className="menu-item" type="button" onClick={handleDeleteFromContext}>
                        <span className="menu-item-title">删除节点</span>
                    </button>
                </div>
            )}
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
