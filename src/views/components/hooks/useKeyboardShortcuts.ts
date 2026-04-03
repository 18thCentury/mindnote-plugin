import { useEffect, useRef } from 'react';

export interface UseKeyboardShortcutsProps {
    containerElement: HTMLElement | null;
    selectedNodeIds: Set<string>;
    copyNode: () => void;
    cutNode: () => void;
    pasteNode: () => void;
    addSibling: (direction: 'above' | 'below') => void;
    deleteSelected: () => void;
    addChild: () => void;
    setEditTrigger: (trigger: { id: string; ts: number } | null) => void;
    handleToggleExpand: (nodeId: string) => void;
    undo: () => void;
    redo: () => void;
}


function getLastSelectedNodeId(selectedNodeIds: Set<string>): string | null {
    if (selectedNodeIds.size === 0) {
        return null;
    }

    return Array.from(selectedNodeIds)[selectedNodeIds.size - 1] ?? null;
}

function isTypingContext(target: EventTarget | null): boolean {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
        return true;
    }
    if (activeElement instanceof HTMLElement && activeElement.isContentEditable) {
        return true;
    }

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return true;
    }

    if (target instanceof HTMLElement) {
        if (target.isContentEditable) {
            return true;
        }
        if (target.closest('[contenteditable="true"]')) {
            return true;
        }
    }

    return false;
}

export function useKeyboardShortcuts({
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
    undo,
    redo,
}: UseKeyboardShortcutsProps) {
    const selectedNodeIdsRef = useRef(selectedNodeIds);

    useEffect(() => {
        selectedNodeIdsRef.current = selectedNodeIds;
    }, [selectedNodeIds]);

    useEffect(() => {
        let isActiveMap = false;

        const updateActiveMapFromTarget = (target: EventTarget | null) => {
            if (!containerElement) {
                isActiveMap = false;
                return;
            }
            isActiveMap = target instanceof Node && containerElement.contains(target);
        };

        const handlePointerDown = (e: PointerEvent) => {
            updateActiveMapFromTarget(e.target);
        };

        const handleFocusIn = (e: FocusEvent) => {
            updateActiveMapFromTarget(e.target);
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isActiveMap && containerElement?.contains(document.activeElement)) {
                isActiveMap = true;
            }

            if (!isActiveMap) {
                return;
            }

            if (isTypingContext(e.target)) {
                return;
            }

            if (e.ctrlKey || e.metaKey) {
                switch (e.key.toLowerCase()) {
                    case 'z':
                        e.preventDefault();
                        if (e.shiftKey) {
                            redo();
                        } else {
                            undo();
                        }
                        break;
                    case 'y':
                        e.preventDefault();
                        redo();
                        break;
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
                    case ' ': { // Space
                        const targetId = getLastSelectedNodeId(selectedNodeIdsRef.current);
                        if (!targetId) {
                            break;
                        }

                        e.preventDefault();
                        setEditTrigger({ id: targetId, ts: Date.now() });
                        break;
                    }
                    case 'Tab':
                        e.preventDefault();
                        addChild();
                        break;
                    case 'Backspace':
                    case 'Delete':
                        if (selectedNodeIdsRef.current.size === 0) {
                            break;
                        }

                        e.preventDefault();
                        deleteSelected();
                        break;
                    case '/': // Expand/Collapse
                        if (selectedNodeIdsRef.current.size === 0) {
                            break;
                        }

                        e.preventDefault();
                        selectedNodeIdsRef.current.forEach(id => handleToggleExpand(id));
                        break;
                }
            }
        };

        document.addEventListener('pointerdown', handlePointerDown, true);
        document.addEventListener('focusin', handleFocusIn, true);
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown, true);
            document.removeEventListener('focusin', handleFocusIn, true);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [
        containerElement,
        copyNode,
        cutNode,
        pasteNode,
        addSibling,
        deleteSelected,
        addChild,
        setEditTrigger,
        handleToggleExpand,
        undo,
        redo,
    ]);
}
