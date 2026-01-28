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
    type OnNodeDrag,
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
    addSiblingNode,
    updateNodeTopic,
    findNodeInTree,
    findParentNode,
    moveNodeAsChild,
    moveNodeAsSiblingAbove,
    moveNodeAsSiblingBelow,
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
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const [copiedNodes, setCopiedNodes] = useState<MindNode[]>([]);
    const [cutNodeIds, setCutNodeIds] = useState<Set<string>>(new Set());
    const [editTrigger, setEditTrigger] = useState<{ id: string; ts: number } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Drag and drop state
    const [dragState, setDragState] = useState<{
        draggedNodeId: string | null;
        targetNodeId: string | null;
        dropZone: 'above' | 'child' | 'below' | null;
    }>({
        draggedNodeId: null,
        targetNodeId: null,
        dropZone: null,
    });

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
                editTrigger: editTrigger,
            }
        );

        // Add drag state to nodes
        const nodesWithDragState = newNodes.map(node => ({
            ...node,
            selected: selectedNodeIds.has(node.id),
            data: {
                ...node.data,
                isDragging: false,
                dropZone: null,
            },
        }));

        setNodes(nodesWithDragState);
        setEdges(newEdges);
    }, [treeData, layoutOptions, contentMap, setNodes, setEdges, resolveImageUrl, handleToggleExpand, handleNodeRename, editTrigger]);

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

    // Handle node selection
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
    }, [onNodeSelect]);

    const handlePaneClick = useCallback(() => {
        setSelectedNodeIds(new Set());
    }, []);

    // Handle drag start
    const handleNodeDragStart: NodeMouseHandler = useCallback((event, node) => {
        // If dragging a node that is NOT selected, select it exclusively
        // Check modifiers to allow adding to selection on drag start? 
        // Standard behavior: if modifier held, add to selection. If not, and node not selected, select only it.
        // If node ALREADY selected, keep selection (to allow dragging group).

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
        });
    }, [selectedNodeIds]);

    // Handle drag - detect drop zone based on mouse position
    const handleNodeDrag: OnNodeDrag = useCallback((event, node, nodes) => {
        const draggedId = node.id;
        // Use elementsFromPoint to find all elements at the cursor position
        // This allows us to "see through" the dragged node if it's blocking the view
        const mouseEvent = event as React.MouseEvent;
        const mouseX = mouseEvent.clientX;
        const mouseY = mouseEvent.clientY;

        const elements = document.elementsFromPoint(mouseX, mouseY);

        let targetNodeId: string | null = null;
        let dropZone: 'above' | 'child' | 'below' | null = null;

        // Find the first element that is a node (but not the dragged one)
        for (const el of elements) {
            const nodeEl = el.closest('.react-flow__node');
            if (nodeEl) {
                const id = nodeEl.getAttribute('data-id');
                if (id && id !== draggedId) {
                    // Found a valid target!
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

                    // console.log('Target found:', { targetNodeId, dropZone, relativeY });
                    break; // Stop looking once we found the top-most target
                }
            }
        }

        // Only update if state changed to avoid excessive re-renders
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

    // Handle drag stop - execute the move
    const handleNodeDragStop: NodeMouseHandler = useCallback(() => {
        const { draggedNodeId, targetNodeId, dropZone } = dragState;

        if (!draggedNodeId || !targetNodeId || !dropZone) {
            setDragState({
                draggedNodeId: null,
                targetNodeId: null,
                dropZone: null,
            });
            // Force layout reset to snap back nodes
            setTreeData(prev => ({ ...prev }));
            return;
        }

        const currentTree = treeDataRef.current;
        let newTree = currentTree;

        // Determine nodes to move
        // If dragged node matches a selected node, move all selected nodes
        // Otherwise just move the dragged one (fallback)
        // Also ensure current draggedNodeId is included if it wasn't selected (though dragStart handles this)
        const nodesToMove = selectedNodeIds.has(draggedNodeId)
            ? Array.from(selectedNodeIds)
            : [draggedNodeId];

        // Filter out nodes if their ancestor is also being moved to avoid double moves
        // (If we move default parent + child, child moves implicitly)
        const independentNodesToMove = nodesToMove.filter(id => {
            // Check if any ancestor of 'id' is in 'nodesToMove'
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

            // Re-validate tree state for each move since tree changes
            // Note: Use 'newTree' for moves to chain updates
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
            // Snap back if nothing changed
            setTreeData(prev => ({ ...prev }));
        }

        // Clear drag state
        setDragState({
            draggedNodeId: null,
            targetNodeId: null,
            dropZone: null,
        });
    }, [dragState, onMapDataChange, selectedNodeIds]);

    // Generate unique ID
    const generateId = useCallback(() => {
        return Math.random().toString(16).slice(2, 18);
    }, []);

    // Add sibling
    const addSibling = useCallback((direction: 'above' | 'below') => {
        const currentTree = treeDataRef.current;
        if (selectedNodeIds.size === 0) return;

        // Add sibling to the last selected node
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
        onMapDataChange?.({ nodeData: newTree });

        // Select and edit the new node
        setSelectedNodeIds(new Set([newNode.id]));
        // Trigger edit after a short delay to allow render
        setTimeout(() => {
            setEditTrigger({ id: newNode.id, ts: Date.now() });
        }, 50);

    }, [selectedNodeIds, generateId, onMapDataChange]);

    // Add child to selected node
    const addChild = useCallback(() => {
        const currentTree = treeDataRef.current;
        // If multiple selected, add to the last selected (or first found). 
        // For simplicity, prioritize the most recently clicked? 
        // Set iteration order is insertion order.
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
        onMapDataChange?.({ nodeData: newTree });
        onNodeCreate?.(newNode, parentId);

        // Select the new node and edit
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
            onMapDataChange?.({ nodeData: newTree });
            deletedNodes.forEach(n => onNodeDelete?.(n));
            setSelectedNodeIds(new Set());
        }
    }, [selectedNodeIds, onMapDataChange, onNodeDelete]);

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
        if (selectedNodeIds.size === 0) return;
        const currentTree = treeDataRef.current;
        const nodes: MindNode[] = [];
        selectedNodeIds.forEach(id => {
            const node = findNodeInTree(currentTree, id);
            if (node) nodes.push(node);
        });

        if (nodes.length > 0) {
            setCopiedNodes(nodes);
            setCutNodeIds(new Set());
        }
    }, [selectedNodeIds]);

    // Cut node
    const cutNode = useCallback(() => {
        const currentTree = treeDataRef.current;
        const nodes: MindNode[] = [];
        const cutIds = new Set<string>();

        selectedNodeIds.forEach(id => {
            if (id === currentTree.id) return;
            const node = findNodeInTree(currentTree, id);
            if (node) {
                nodes.push(node);
                cutIds.add(id);
            }
        });

        if (nodes.length > 0) {
            setCopiedNodes(nodes);
            setCutNodeIds(cutIds);
        }
    }, [selectedNodeIds]);

    // Paste node
    const pasteNode = useCallback(() => {
        if (copiedNodes.length === 0) return;
        const currentTree = treeDataRef.current;
        // Paste into the last selected node or root
        const targetId = selectedNodeIds.size > 0
            ? Array.from(selectedNodeIds)[selectedNodeIds.size - 1]
            : currentTree.id;

        let newTree = currentTree;

        copiedNodes.forEach(copiedNode => {
            // Clone the copied node with new IDs
            const newNode = cloneNode(copiedNode);
            newTree = addChildNode(newTree, targetId, newNode);
            onNodeCreate?.(newNode, targetId);
        });

        // If it was a cut, remove originals
        if (cutNodeIds.size > 0) {
            cutNodeIds.forEach(cutId => {
                const updated = removeNode(newTree, cutId);
                if (updated) newTree = updated;
            });
            setCutNodeIds(new Set());
        }

        setTreeData(newTree);
        onMapDataChange?.({ nodeData: newTree });
    }, [copiedNodes, cutNodeIds, selectedNodeIds, cloneNode, onMapDataChange, onNodeCreate]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Check if we're in an input field (native check)
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                return;
            }
            // Check if contentEditable (just in case)
            if ((e.target as HTMLElement).isContentEditable) {
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
                    case 'Enter':
                        e.preventDefault();
                        if (e.shiftKey) {
                            addSibling('above');
                        } else {
                            addSibling('below');
                        }
                        break;
                    case ' ': // Space
                        e.preventDefault();
                        if (selectedNodeIds.size > 0) {
                            const targetId = Array.from(selectedNodeIds)[selectedNodeIds.size - 1];
                            setEditTrigger({ id: targetId, ts: Date.now() });
                        }
                        break;
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

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [copyNode, cutNode, pasteNode, addChild, deleteSelected, addSibling, selectedNodeIds]);
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
                onPaneClick={handlePaneClick}
                onNodeDragStart={handleNodeDragStart}
                onNodeDrag={handleNodeDrag}
                onNodeDragStop={handleNodeDragStop}
                nodeTypes={nodeTypes}
                nodesDraggable={true}
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
