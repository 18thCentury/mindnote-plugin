/**
 * MindMapFlow - Main React Flow component for the mindmap
 * Handles rendering, interactions, and clipboard operations
 */
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    useNodesState,
    useEdgesState,
    type Node,
    type Edge,
    type NodeMouseHandler,
    SelectionMode,
    ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { MindMapNode } from './MindMapNode';
import {
    convertToFlowElements,
    toggleNodeExpanded,
    addChildNode,
    removeNode,
    updateNodeTopic,
    findNodeInTree,
    type MindMapNodeData,
    type LayoutOptions,
} from './layoutUtils';
import type { MindNode, MindMapData, Direction } from '../../types';

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
    };
    contentMap: Map<string, boolean>;
    onNodeSelect?: (node: MindNode) => void;
    onNodeCreate?: (node: MindNode, parentId: string) => void;
    onNodeDelete?: (node: MindNode) => void;
    onNodeRename?: (node: MindNode, oldTopic: string) => void;
    onMapDataChange?: (data: MindMapData) => void;
    onDrop?: (files: FileList) => void;
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
    resolveImageUrl,
}: MindMapFlowProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState<Node<MindMapNodeData>>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [copiedNode, setCopiedNode] = useState<MindNode | null>(null);
    const [cutNodeId, setCutNodeId] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Store current tree state internally for mutations
    const [treeData, setTreeData] = useState<MindNode>(mapData.nodeData);
    // Use a ref to always have current treeData in callbacks (avoids stale closure)
    const treeDataRef = useRef<MindNode>(treeData);

    // Keep ref in sync with state
    useEffect(() => {
        treeDataRef.current = treeData;
    }, [treeData]);

    // Update tree when mapData prop changes (only if it's a NEW map, not internal updates)
    useEffect(() => {
        // Only update if the root node ID changed (different map loaded)
        if (mapData.nodeData.id !== treeData.id) {
            setTreeData(mapData.nodeData);
        }
    }, [mapData]);

    // Layout options from settings
    const layoutOptions: Partial<LayoutOptions> = useMemo(() => ({
        direction: settings.direction,
        horizontalGap: settings.horizontalGap,
        verticalGap: settings.verticalGap,
    }), [settings]);

    // Handle collapse/expand toggle
    const handleToggleExpand = useCallback((nodeId: string) => {
        setTreeData(prev => {
            const newTree = toggleNodeExpanded(prev, nodeId);
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

    // Convert tree to flow elements whenever tree changes
    useEffect(() => {
        // Process image URLs for display
        const processNode = (node: MindNode): MindNode => {
            if (node.isImage && node.imageUrl && resolveImageUrl) {
                return {
                    ...node,
                    imageUrl: resolveImageUrl(node.imageUrl),
                    children: node.children?.map(processNode) || [],
                };
            }
            return {
                ...node,
                children: node.children?.map(processNode) || [],
            };
        };

        const displayTree = processNode(treeData);
        const { nodes: newNodes, edges: newEdges } = convertToFlowElements(
            displayTree,
            layoutOptions,
            contentMap,
            {
                onToggleExpand: handleToggleExpand,
                onNodeRename: handleNodeRename,
            }
        );
        setNodes(newNodes);
        setEdges(newEdges);
    }, [treeData, layoutOptions, contentMap, setNodes, setEdges, resolveImageUrl, handleToggleExpand, handleNodeRename]);

    // Handle node selection
    const handleNodeClick: NodeMouseHandler = useCallback((_, node) => {
        setSelectedNodeId(node.id);
        // Use ref to get current tree data (avoids stale closure)
        const currentTree = treeDataRef.current;
        const mindNode = findNodeInTree(currentTree, node.id);
        if (mindNode) {
            onNodeSelect?.(mindNode);
        }
    }, [onNodeSelect]);

    // Generate unique ID
    const generateId = useCallback(() => {
        return Math.random().toString(16).slice(2, 18);
    }, []);

    // Add child to selected node
    const addChild = useCallback(() => {
        const currentTree = treeDataRef.current;
        const parentId = selectedNodeId || currentTree.id;
        const newNode: MindNode = {
            id: generateId(),
            topic: 'New Node',
            filepath: '',
            children: [],
            expanded: true,
        };

        const newTree = addChildNode(currentTree, parentId, newNode);
        setTreeData(newTree);
        onMapDataChange?.({ nodeData: newTree });
        onNodeCreate?.(newNode, parentId);
    }, [selectedNodeId, generateId, onMapDataChange, onNodeCreate]);

    // Delete selected node
    const deleteSelected = useCallback(() => {
        const currentTree = treeDataRef.current;
        if (!selectedNodeId || selectedNodeId === currentTree.id) return; // Can't delete root

        const nodeToDelete = findNodeInTree(currentTree, selectedNodeId);
        if (nodeToDelete) {
            const newTree = removeNode(currentTree, selectedNodeId);
            if (newTree) {
                setTreeData(newTree);
                onMapDataChange?.({ nodeData: newTree });
                onNodeDelete?.(nodeToDelete);
                setSelectedNodeId(null);
            }
        }
    }, [selectedNodeId, onMapDataChange, onNodeDelete]);

    // Deep clone a node for copying
    const cloneNode = useCallback((node: MindNode): MindNode => {
        return {
            ...node,
            id: generateId(),
            filepath: '', // New file will be created
            children: node.children?.map(cloneNode) || [],
        };
    }, [generateId]);

    // Copy node
    const copyNode = useCallback(() => {
        if (!selectedNodeId) return;
        const currentTree = treeDataRef.current;
        const node = findNodeInTree(currentTree, selectedNodeId);
        if (node) {
            setCopiedNode(node);
            setCutNodeId(null);
        }
    }, [selectedNodeId]);

    // Cut node
    const cutNode = useCallback(() => {
        const currentTree = treeDataRef.current;
        if (!selectedNodeId || selectedNodeId === currentTree.id) return;
        const node = findNodeInTree(currentTree, selectedNodeId);
        if (node) {
            setCopiedNode(node);
            setCutNodeId(selectedNodeId);
        }
    }, [selectedNodeId]);

    // Paste node
    const pasteNode = useCallback(() => {
        if (!copiedNode) return;
        const currentTree = treeDataRef.current;
        const parentId = selectedNodeId || currentTree.id;

        // Clone the copied node with new IDs
        const newNode = cloneNode(copiedNode);

        let newTree = addChildNode(currentTree, parentId, newNode);

        // If it was a cut, remove the original
        if (cutNodeId) {
            newTree = removeNode(newTree, cutNodeId) || newTree;
            setCutNodeId(null);
        }

        setTreeData(newTree);
        onMapDataChange?.({ nodeData: newTree });
        onNodeCreate?.(newNode, parentId);
    }, [copiedNode, cutNodeId, selectedNodeId, cloneNode, onMapDataChange, onNodeCreate]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Check if we're in an input field
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                return;
            }

            if (e.ctrlKey || e.metaKey) {
                switch (e.key.toLowerCase()) {
                    case 'c':
                        e.preventDefault();
                        copyNode();
                        break;
                    case 'x':
                        e.preventDefault();
                        cutNode();
                        break;
                    case 'v':
                        e.preventDefault();
                        pasteNode();
                        break;
                }
            } else {
                switch (e.key) {
                    case 'Tab':
                        e.preventDefault();
                        addChild();
                        break;
                    case 'Delete':
                    case 'Backspace':
                        e.preventDefault();
                        deleteSelected();
                        break;
                }
            }
        };

        const container = containerRef.current;
        container?.addEventListener('keydown', handleKeyDown);
        return () => container?.removeEventListener('keydown', handleKeyDown);
    }, [copyNode, cutNode, pasteNode, addChild, deleteSelected]);

    // Handle drop
    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            onDrop?.(files);
        }
    }, [onDrop]);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
    }, []);

    // Determine theme
    const isDark = settings.theme === 'dark' ||
        (settings.theme === 'auto' && document.body.classList.contains('theme-dark'));

    return (
        <div
            ref={containerRef}
            className="mindmap-flow-container"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            tabIndex={0}
        >
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={handleNodeClick}
                nodeTypes={nodeTypes}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={true}
                selectionMode={SelectionMode.Partial}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                zoomOnDoubleClick={false}
                colorMode={isDark ? 'dark' : 'light'}
                proOptions={{ hideAttribution: true }}
            >
                <Background />
                <Controls />
                <MiniMap
                    nodeStrokeWidth={3}
                    zoomable
                    pannable
                />
            </ReactFlow>
        </div>
    );
}

// Wrap with ReactFlowProvider
export function MindMapFlow(props: MindMapFlowProps) {
    return (
        <ReactFlowProvider>
            <MindMapFlowInner {...props} />
        </ReactFlowProvider>
    );
}
