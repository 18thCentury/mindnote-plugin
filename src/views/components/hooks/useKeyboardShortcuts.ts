import { useEffect } from 'react';

export interface UseKeyboardShortcutsProps {
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
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
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
                        const targetId = getLastSelectedNodeId(selectedNodeIds);
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
                        if (selectedNodeIds.size === 0) {
                            break;
                        }

                        e.preventDefault();
                        deleteSelected();
                        break;
                    case '/': // Expand/Collapse
                        if (selectedNodeIds.size === 0) {
                            break;
                        }

                        e.preventDefault();
                        selectedNodeIds.forEach(id => handleToggleExpand(id));
                        break;
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [
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
    ]);
}
