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
}: UseKeyboardShortcutsProps) {
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
                    case 'Backspace':
                    case 'Delete':
                        // Only delete if NOT in input (already checked above)
                        e.preventDefault();
                        deleteSelected();
                        break;
                    case '/': // Expand/Collapse
                        e.preventDefault();
                        if (selectedNodeIds.size > 0) {
                            selectedNodeIds.forEach(id => handleToggleExpand(id));
                        }
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
        handleToggleExpand
    ]);
}
