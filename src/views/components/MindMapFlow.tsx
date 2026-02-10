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
import { Notice } from 'obsidian';

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
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const [copiedNodes, setCopiedNodes] = useState<MindNode[]>([]);
    const [cutNodeIds, setCutNodeIds] = useState<Set<string>>(new Set());
    const [editTrigger, setEditTrigger] = useState<{ id: string; ts: number } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Drag and drop state (for both internal node drag and external file drop)
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

    // Store current tree state internally for mutations
    const [treeData, setTreeData] = useState<MindNode>(mapData.nodeData);
    // Use a ref to always have current treeData in callbacks (avoids stale closure)
    const treeDataRef = useRef<MindNode>(treeData);

    // Keep ref in sync with state
    useEffect(() => {
        treeDataRef.current = treeData;
    }, [treeData]);

    // Update tree when mapData prop changes
    // Sync when: 1) different map loaded (root ID changed), or 2) external additions (nodes added outside React Flow)
    useEffect(() => {
        // Count nodes in a tree for comparison
        const countNodes = (node: MindNode): number => {
            let count = 1;
            for (const child of node.children || []) {
                count += countNodes(child);
            }
            return count;
        };

        const mapNodeCount = countNodes(mapData.nodeData);
        const treeNodeCount = countNodes(treeData);

        // Sync if: root ID changed (different map) OR mapData has more nodes (external addition)
        if (mapData.nodeData.id !== treeData.id || mapNodeCount > treeNodeCount) {
            setTreeData(mapData.nodeData);
        }
    }, [mapData]);

    // Layout options from settings
    const layoutOptions: Partial<LayoutOptions> = useMemo(() => ({
        direction: settings.direction,
        horizontalGap: settings.horizontalGap,
        verticalGap: settings.verticalGap,
        lineWidth: settings.lineWidth,
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
            isExternalFileDrag: false,
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
                isExternalFileDrag: false,
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
            isExternalFileDrag: false,
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

    // Copy node to system clipboard
    const copyNode = useCallback(async () => {
        if (selectedNodeIds.size === 0) return;
        const currentTree = treeDataRef.current;
        const nodes: MindNode[] = [];
        selectedNodeIds.forEach(id => {
            const node = findNodeInTree(currentTree, id);
            if (node) nodes.push(node);
        });

        if (nodes.length > 0) {
            // 1. Prepare Data
            // Custom Type: Raw JSON source of truth
            const customData = { nodes };
            const jsonString = JSON.stringify(customData);

            // Plain Text: Indented list for external apps
            const generateText = (nodeList: MindNode[], depth = 0): string => {
                return nodeList.map(node => {
                    const indent = '\t'.repeat(depth);
                    const childrenText = node.children ? '\n' + generateText(node.children, depth + 1) : '';
                    return `${indent}${node.topic}${childrenText}`;
                }).join('\n');
            };
            const plainText = generateText(nodes);

            // HTML: Semantic structure + embedded data for rich paste targets (e.g. Word)
            // We embed the JSON in a data attribute for robust parsing if custom type fails
            const generateHtml = (nodeList: MindNode[]): string => {
                const listItems = nodeList.map(node => {
                    const childrenHtml = node.children && node.children.length > 0
                        ? `<ul>${generateHtml(node.children)}</ul>`
                        : '';
                    return `<li>${escapeHtml(node.topic)}${childrenHtml}</li>`;
                }).join('');
                return listItems;
            };
            // Utility to escape HTML characters
            const escapeHtml = (unsafe: string) => {
                return unsafe
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#039;");
            };
            // Utility to escape attribute values (specifically quotes)
            const escapeAttr = (unsafe: string) => {
                return unsafe.replace(/"/g, '&quot;');
            };

            const htmlContent = `<div data-mindnote-json="${escapeAttr(jsonString)}">
                <ul>${generateHtml(nodes)}</ul>
            </div>`;

            try {
                // 2. Write to Clipboard
                // Attempt 1: All types including custom
                try {
                    const clipboardItem = new ClipboardItem({
                        'web mindnote/node': new Blob([jsonString], { type: 'application/json' }),
                        'text/plain': new Blob([plainText], { type: 'text/plain' }),
                        'text/html': new Blob([htmlContent], { type: 'text/html' }),
                    });
                    await navigator.clipboard.write([clipboardItem]);
                } catch (customError) {
                    console.warn('Clipboard write with custom type failed, falling back to standard types', customError);

                    // Attempt 2: Standard types only (HTML + Text)
                    try {
                        const fallbackItem = new ClipboardItem({
                            'text/plain': new Blob([plainText], { type: 'text/plain' }),
                            'text/html': new Blob([htmlContent], { type: 'text/html' }),
                        });
                        await navigator.clipboard.write([fallbackItem]);
                    } catch (standardError) {
                        console.warn('Clipboard write with HTML failed, falling back to text only', standardError);

                        // Attempt 3: Text only
                        await navigator.clipboard.writeText(plainText);
                    }
                }

                // Fallback / Side effect: Set internal state for "Cut" operation tracking
                setCopiedNodes(nodes);
                setCutNodeIds(new Set()); // Clear cut on fresh copy
                new Notice(`Copied ${nodes.length} node(s)`);

            } catch (err) {
                console.error('Failed to copy to clipboard:', err);
                new Notice('Failed to copy to system clipboard');
                // Fallback to internal state only
                setCopiedNodes(nodes);
            }
        }
    }, [selectedNodeIds]);

    // Cut node
    const cutNode = useCallback(async () => {
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
            // Write to system clipboard first
            await copyNode();

            // Then set cut state (overriding copyNode's clear)
            setCopiedNodes(nodes);
            setCutNodeIds(cutIds);
        }
    }, [selectedNodeIds, copyNode]);

    // Paste node from system clipboard
    const pasteNode = useCallback(async () => {
        try {
            const clipboardItems = await navigator.clipboard.read();
            const currentTree = treeDataRef.current;

            // Target for paste: Selected node or Root
            const targetId = selectedNodeIds.size > 0
                ? Array.from(selectedNodeIds)[selectedNodeIds.size - 1]
                : currentTree.id;

            for (const item of clipboardItems) {
                // 1. Check for Custom MindNote Type (Highest Priority)
                if (item.types.includes('web mindnote/node')) {
                    const blob = await item.getType('web mindnote/node');
                    const text = await blob.text();
                    try {
                        const data = JSON.parse(text);
                        if (data && Array.isArray(data.nodes)) {
                            const nodesToPaste: MindNode[] = data.nodes;
                            let newTree = currentTree;
                            nodesToPaste.forEach(copiedNode => {
                                // Clone with new IDs
                                const newNode = cloneNode(copiedNode); // This recursively generates new IDs
                                newTree = addChildNode(newTree, targetId, newNode);
                                onNodeCreate?.(newNode, targetId);
                            });
                            // Handle Cut operation cleanup (if strictly internal)
                            // Note: With system clipboard, "Cut" is trickier to track "after paste" across apps.
                            // We heavily rely on internal state 'cutNodeIds' for the *current session* cut.
                            if (cutNodeIds.size > 0) {
                                // Check if we are pasting the *same* nodes that were cut?
                                // Simplified: If we have cut nodes pending, and we just pasted *any* node,
                                // we assume the cut operation is completing? 
                                // Better: Only clear cut if we can verify identity, but JSON serialization loses identity equality.
                                // Logic: If cutNodeIds exist, remove them.
                                cutNodeIds.forEach(cutId => {
                                    const updated = removeNode(newTree, cutId);
                                    if (updated) newTree = updated;
                                });
                                setCutNodeIds(new Set());
                            }

                            setTreeData(newTree);
                            onMapDataChange?.({ nodeData: newTree });
                            return; // Success, stop processing this item
                        }
                    } catch (e) {
                        console.error('Failed to parse MindNote clipboard data', e);
                    }
                }

                // 2. Check for Images
                // Find any image type
                const imageType = item.types.find(type => type.startsWith('image/'));
                if (imageType) {
                    const blob = await item.getType(imageType);
                    // Convert Blob to File
                    const file = new File([blob], "pasted-image.png", { type: imageType });
                    onPaste?.([file], targetId);
                    return;
                }

                // 3. Fallback: Check for HTML (maybe from Word or another MindNote instance without custom types)
                if (item.types.includes('text/html')) {
                    const blob = await item.getType('text/html');
                    const text = await blob.text();

                    // Parse HTML to look for our embedded data attribute
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(text, 'text/html');
                    const wrapper = doc.querySelector('[data-mindnote-json]');
                    if (wrapper) {
                        const jsonAttr = wrapper.getAttribute('data-mindnote-json');
                        if (jsonAttr) {
                            try {
                                const data = JSON.parse(jsonAttr);
                                if (data && Array.isArray(data.nodes)) {
                                    // Found embedded MindNode data!
                                    const nodesToPaste: MindNode[] = data.nodes;
                                    let newTree = currentTree;
                                    nodesToPaste.forEach(copiedNode => {
                                        const newNode = cloneNode(copiedNode);
                                        newTree = addChildNode(newTree, targetId, newNode);
                                        onNodeCreate?.(newNode, targetId);
                                    });
                                    setTreeData(newTree);
                                    onMapDataChange?.({ nodeData: newTree });
                                    return;
                                }
                            } catch (e) { console.error("Found data attribute but failed to parse", e); }
                        }
                    }
                }

                // 4. Fallback: Plain Text
                if (item.types.includes('text/plain')) {
                    const blob = await item.getType('text/plain');
                    const text = await blob.text();
                    if (text && text.trim().length > 0) {
                        // Create a single node with the text
                        // Future improvement: Parse indentation to create hierarchy
                        const newNode: MindNode = {
                            id: generateId(),
                            topic: text.trim(), // Consider truncating if very long
                            filepath: '',
                            children: [],
                            expanded: true
                        };
                        let newTree = addChildNode(currentTree, targetId, newNode);
                        setTreeData(newTree);
                        onMapDataChange?.({ nodeData: newTree });
                        onNodeCreate?.(newNode, targetId);
                    }
                }
            }
        } catch (err) {
            console.error('Failed to paste from clipboard:', err);
        }
    }, [selectedNodeIds, cutNodeIds, onMapDataChange, onNodeCreate, generateId, cloneNode, onPaste]);

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
    // Detect target node during external file drag (reuses logic from handleNodeDrag)
    const detectTargetNode = useCallback((mouseX: number, mouseY: number): { targetNodeId: string | null; dropZone: 'above' | 'child' | 'below' | null } => {
        const elements = document.elementsFromPoint(mouseX, mouseY);

        for (const el of elements) {
            const nodeEl = el.closest('.react-flow__node');
            if (nodeEl) {
                const id = nodeEl.getAttribute('data-id');
                if (id) {
                    const rect = nodeEl.getBoundingClientRect();
                    const relativeY = (mouseY - rect.top) / rect.height;

                    let dropZone: 'above' | 'child' | 'below';
                    if (relativeY < 0.25) {
                        dropZone = 'above';
                    } else if (relativeY > 0.75) {
                        dropZone = 'below';
                    } else {
                        dropZone = 'child';
                    }

                    return { targetNodeId: id, dropZone };
                }
            }
        }

        return { targetNodeId: null, dropZone: null };
    }, []);

    // Handle external file drag over - detect target nodes for visual feedback
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';

        // Check if this is a file drag (has files in dataTransfer)
        if (e.dataTransfer.types.includes('Files')) {
            const { targetNodeId, dropZone } = detectTargetNode(e.clientX, e.clientY);

            setDragState(prev => {
                if (prev.targetNodeId === targetNodeId && prev.dropZone === dropZone && prev.isExternalFileDrag) {
                    return prev;
                }
                return {
                    draggedNodeId: null,
                    targetNodeId,
                    dropZone,
                    isExternalFileDrag: true,
                };
            });
        }
    }, [detectTargetNode]);

    // Handle drag leave - clear external drag state
    const handleDragLeave = useCallback((e: React.DragEvent) => {
        // Only clear if leaving the container entirely
        const relatedTarget = e.relatedTarget as HTMLElement | null;
        if (!containerRef.current?.contains(relatedTarget)) {
            setDragState({
                draggedNodeId: null,
                targetNodeId: null,
                dropZone: null,
                isExternalFileDrag: false,
            });
        }
    }, []);

    // Handle drop - pass target node ID to callback
    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            // Detect target at drop time to avoid stale closure issues
            const { targetNodeId } = detectTargetNode(e.clientX, e.clientY);

            // Use the detected target node or fall back to selected node
            const targetId = targetNodeId ||
                (selectedNodeIds.size > 0 ? Array.from(selectedNodeIds)[selectedNodeIds.size - 1] : null);
            onDrop?.(files, targetId);
        }

        // Clear drag state
        setDragState({
            draggedNodeId: null,
            targetNodeId: null,
            dropZone: null,
            isExternalFileDrag: false,
        });
    }, [onDrop, detectTargetNode, selectedNodeIds]);

    // Determine theme
    const isDark = settings.theme === 'dark' ||
        (settings.theme === 'auto' && document.body.classList.contains('theme-dark'));

    return (
        <div
            ref={containerRef}
            className="mindmap-flow-container"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
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
