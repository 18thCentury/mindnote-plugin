/**
 * HistoryManager
 * Manages undo/redo operations with file state restoration
 */
import { App, TFile, normalizePath, Notice } from 'obsidian';
import { HistoryEntry, HistoryActionType, MindNode, ResourceSnapshot, MindMapData } from '../types';
import { FileSystemManager } from './FileSystemManager';

const MAX_HISTORY_SIZE = 50;

export class HistoryManager {
    private undoStack: HistoryEntry[] = [];
    private redoStack: HistoryEntry[] = [];
    private bundlePath: string = '';

    constructor(
        private app: App,
        private fsm: FileSystemManager
    ) { }

    /**
     * Set the bundle path for this history manager
     */
    setBundlePath(bundlePath: string): void {
        this.bundlePath = bundlePath;
    }

    /**
     * Record a history entry
     */
    record(entry: Omit<HistoryEntry, 'timestamp'>): void {
        const fullEntry: HistoryEntry = {
            ...entry,
            timestamp: Date.now(),
        };

        this.undoStack.push(fullEntry);

        // Clear redo stack on new action
        this.redoStack = [];

        // Limit history size
        if (this.undoStack.length > MAX_HISTORY_SIZE) {
            this.undoStack.shift();
        }
    }

    /**
     * Record a CREATE action
     */
    async recordCreate(node: MindNode, filePath: string): Promise<void> {
        this.record({
            type: 'CREATE',
            nodeData: { ...node },
            resources: [{ path: filePath, content: '' }],
        });
    }

    /**
     * Record a DELETE action (must capture file content for restore)
     */
    async recordDelete(node: MindNode, resources: TFile[]): Promise<void> {
        const snapshots: ResourceSnapshot[] = [];

        // Capture markdown file content
        const mdPath = normalizePath(`${this.bundlePath}/md/${node.filepath}`);
        const mdFile = this.app.vault.getAbstractFileByPath(mdPath);
        if (mdFile instanceof TFile) {
            const content = await this.app.vault.read(mdFile);
            snapshots.push({ path: mdPath, content });
        }

        // Capture resource contents
        for (const resource of resources) {
            try {
                const content = await this.app.vault.readBinary(resource);
                snapshots.push({ path: resource.path, content });
            } catch {
                // Skip if can't read
            }
        }

        this.record({
            type: 'DELETE',
            nodeData: { ...node },
            resources: snapshots,
        });
    }

    /**
     * Record a RENAME action
     */
    recordRename(node: MindNode, oldFilepath: string): void {
        this.record({
            type: 'RENAME',
            nodeData: { ...node },
            previousState: { filepath: oldFilepath },
        });
    }

    /**
     * Record a MOVE action
     */
    recordMove(node: MindNode, oldParentId: string): void {
        this.record({
            type: 'MOVE',
            nodeData: { ...node },
            previousState: { parentId: oldParentId },
        });
    }

    /**
     * Check if undo is available
     */
    canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    /**
     * Check if redo is available
     */
    canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    /**
     * Perform undo operation
     * Returns the entry that was undone for map updates
     */
    async undo(): Promise<HistoryEntry | null> {
        const entry = this.undoStack.pop();
        if (!entry) {
            return null;
        }

        try {
            await this.reverseAction(entry);
            this.redoStack.push(entry);
            return entry;
        } catch (error) {
            // Put it back on failure
            this.undoStack.push(entry);
            new Notice('Undo failed');
            console.error('Undo failed:', error);
            return null;
        }
    }

    /**
     * Perform redo operation
     * Returns the entry that was redone for map updates
     */
    async redo(): Promise<HistoryEntry | null> {
        const entry = this.redoStack.pop();
        if (!entry) {
            return null;
        }

        try {
            await this.replayAction(entry);
            this.undoStack.push(entry);
            return entry;
        } catch (error) {
            // Put it back on failure
            this.redoStack.push(entry);
            new Notice('Redo failed');
            console.error('Redo failed:', error);
            return null;
        }
    }

    /**
     * Reverse an action for undo
     */
    private async reverseAction(entry: HistoryEntry): Promise<void> {
        switch (entry.type) {
            case 'CREATE':
                // Delete the created file
                await this.deleteResources(entry);
                break;

            case 'DELETE':
                // Restore the deleted file
                await this.restoreResources(entry);
                break;

            case 'RENAME':
                // Rename back to original
                await this.undoRename(entry);
                break;

            case 'MOVE':
                // Move operations only affect map structure
                // Map restoration is handled by caller
                break;

            case 'EDIT':
                // Edit operations would need content snapshots
                break;
        }
    }

    /**
     * Replay an action for redo
     */
    private async replayAction(entry: HistoryEntry): Promise<void> {
        switch (entry.type) {
            case 'CREATE':
                // Recreate the file
                await this.restoreResources(entry);
                break;

            case 'DELETE':
                // Delete the file again
                await this.deleteResources(entry);
                break;

            case 'RENAME':
                // Rename to new name again
                await this.redoRename(entry);
                break;

            case 'MOVE':
            case 'EDIT':
                // Handled by caller
                break;
        }
    }

    /**
     * Delete resources from a history entry
     */
    private async deleteResources(entry: HistoryEntry): Promise<void> {
        if (!entry.resources) return;

        for (const snapshot of entry.resources) {
            const file = this.app.vault.getAbstractFileByPath(snapshot.path);
            if (file instanceof TFile) {
                await this.fsm.deleteFile(file);
            }
        }
    }

    /**
     * Restore resources from a history entry
     */
    private async restoreResources(entry: HistoryEntry): Promise<void> {
        if (!entry.resources) return;

        for (const snapshot of entry.resources) {
            const existing = this.app.vault.getAbstractFileByPath(snapshot.path);
            if (!existing) {
                if (snapshot.content instanceof ArrayBuffer) {
                    await this.app.vault.createBinary(snapshot.path, snapshot.content);
                } else {
                    await this.fsm.createFile(snapshot.path, snapshot.content as string);
                }
            }
        }
    }

    /**
     * Undo a rename operation
     */
    private async undoRename(entry: HistoryEntry): Promise<void> {
        if (!entry.previousState?.filepath) return;

        const currentPath = normalizePath(`${this.bundlePath}/md/${entry.nodeData.filepath}`);
        const originalPath = normalizePath(`${this.bundlePath}/md/${entry.previousState.filepath}`);

        const file = this.app.vault.getAbstractFileByPath(currentPath);
        if (file instanceof TFile) {
            await this.fsm.renameFile(file, originalPath);
        }
    }

    /**
     * Redo a rename operation
     */
    private async redoRename(entry: HistoryEntry): Promise<void> {
        if (!entry.previousState?.filepath) return;

        const originalPath = normalizePath(`${this.bundlePath}/md/${entry.previousState.filepath}`);
        const newPath = normalizePath(`${this.bundlePath}/md/${entry.nodeData.filepath}`);

        const file = this.app.vault.getAbstractFileByPath(originalPath);
        if (file instanceof TFile) {
            await this.fsm.renameFile(file, newPath);
        }
    }

    /**
     * Clear all history
     */
    clear(): void {
        this.undoStack = [];
        this.redoStack = [];
    }

    /**
     * Get undo stack size
     */
    get undoCount(): number {
        return this.undoStack.length;
    }

    /**
     * Get redo stack size
     */
    get redoCount(): number {
        return this.redoStack.length;
    }
}
