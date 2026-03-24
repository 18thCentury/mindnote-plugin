import { useState, useCallback } from 'react';
import { Notice } from 'obsidian';
import {
    addChildNode,
    removeNode,
    findNodeInTree,
} from '../treeOperations';
import type { MindNode, MindMapData } from '../../../types';

export interface UseClipboardProps {
    treeDataRef: React.MutableRefObject<MindNode>;
    selectedNodeIds: Set<string>;
    setTreeData: React.Dispatch<React.SetStateAction<MindNode>>;
    onMapDataChange?: (data: MindMapData) => void;
    onNodeCreate?: (node: MindNode, parentId: string, fileType?: 'markdown' | 'canvas') => void;
    onPaste?: (files: File[], targetNodeId: string | null) => void;
    generateId: () => string;
}

export function useClipboard({
    treeDataRef,
    selectedNodeIds,
    setTreeData,
    onMapDataChange,
    onNodeCreate,
    onPaste,
    generateId,
}: UseClipboardProps) {
    const [copiedNodes, setCopiedNodes] = useState<MindNode[]>([]);
    const [cutNodeIds, setCutNodeIds] = useState<Set<string>>(new Set());

    // Deep clone a node for copying
    const cloneNode = useCallback((node: MindNode): MindNode => {
        return {
            ...node,
            id: generateId(),
            filepath: '', // New file will be created
            children: node.children?.map(cloneNode) || [],
        };
    }, [generateId]);

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

            // HTML: Semantic structure + embedded data for rich paste targets
            const generateHtml = (nodeList: MindNode[]): string => {
                const listItems = nodeList.map(node => {
                    const childrenHtml = node.children && node.children.length > 0
                        ? `<ul>${generateHtml(node.children)}</ul>`
                        : '';
                    return `<li>${escapeHtml(node.topic)}${childrenHtml}</li>`;
                }).join('');
                return listItems;
            };

            const escapeHtml = (unsafe: string) => {
                return unsafe
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#039;");
            };

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

                setCopiedNodes(nodes);
                setCutNodeIds(new Set()); // Clear cut on fresh copy
                new Notice(`Copied ${nodes.length} node(s)`);

            } catch (err) {
                console.error('Failed to copy to clipboard:', err);
                new Notice('Failed to copy to system clipboard');
                setCopiedNodes(nodes);
            }
        }
    }, [selectedNodeIds, treeDataRef]);

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
            await copyNode();
            setCopiedNodes(nodes);
            setCutNodeIds(cutIds);
        }
    }, [selectedNodeIds, copyNode, treeDataRef]);

    const pasteNode = useCallback(async () => {
        try {
            const clipboardItems = await navigator.clipboard.read();
            const currentTree = treeDataRef.current;

            const targetId = selectedNodeIds.size > 0
                ? Array.from(selectedNodeIds)[selectedNodeIds.size - 1]
                : currentTree.id;

            for (const item of clipboardItems) {
                // 1. Check for Custom MindNote Type
                if (item.types.includes('web mindnote/node')) {
                    const blob = await item.getType('web mindnote/node');
                    const text = await blob.text();
                    try {
                        const data = JSON.parse(text);
                        if (data && Array.isArray(data.nodes)) {
                            const nodesToPaste: MindNode[] = data.nodes;
                            let newTree = currentTree;
                            nodesToPaste.forEach(copiedNode => {
                                const newNode = cloneNode(copiedNode); // Recursively generates new IDs
                                newTree = addChildNode(newTree, targetId, newNode);
                                onNodeCreate?.(newNode, targetId);
                            });

                            if (cutNodeIds.size > 0) {
                                cutNodeIds.forEach(cutId => {
                                    const updated = removeNode(newTree, cutId);
                                    if (updated) newTree = updated;
                                });
                                setCutNodeIds(new Set());
                            }

                            setTreeData(newTree);
                            onMapDataChange?.({ nodeData: newTree });
                            return;
                        }
                    } catch (e) {
                        console.error('Failed to parse MindNote clipboard data', e);
                    }
                }

                // 2. Check for Images
                const imageType = item.types.find(type => type.startsWith('image/'));
                if (imageType) {
                    const blob = await item.getType(imageType);
                    const file = new File([blob], "pasted-image.png", { type: imageType });
                    onPaste?.([file], targetId);
                    return;
                }

                // 3. Fallback: Check for HTML
                if (item.types.includes('text/html')) {
                    const blob = await item.getType('text/html');
                    const text = await blob.text();

                    const parser = new DOMParser();
                    const doc = parser.parseFromString(text, 'text/html');
                    const wrapper = doc.querySelector('[data-mindnote-json]');
                    if (wrapper) {
                        const jsonAttr = wrapper.getAttribute('data-mindnote-json');
                        if (jsonAttr) {
                            try {
                                const data = JSON.parse(jsonAttr);
                                if (data && Array.isArray(data.nodes)) {
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
                        const newNode: MindNode = {
                            id: generateId(),
                            topic: text.trim(),
                            filepath: '',
                            children: [],
                            expanded: true
                        };
                        const newTree = addChildNode(currentTree, targetId, newNode);
                        setTreeData(newTree);
                        onMapDataChange?.({ nodeData: newTree });
                        onNodeCreate?.(newNode, targetId);
                    }
                }
            }
        } catch (err) {
            console.error('Failed to paste from clipboard:', err);
        }
    }, [selectedNodeIds, cutNodeIds, onMapDataChange, onNodeCreate, generateId, cloneNode, onPaste, treeDataRef, setTreeData]);

    return {
        copyNode,
        cutNode,
        pasteNode,
        cutNodeIds, // Exported to be aware of cut state if needed
    };
}
