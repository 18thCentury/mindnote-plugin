/**
 * TransactionManager
 * Implements 2-Phase Commit for atomic file operations with rollback capability
 */
import { App, TFile, Notice, normalizePath } from 'obsidian';
import { TransactionContext, FileOperation, MindMapData, MAP_FILE_NAME } from '../types';

export class TransactionManager {
    private currentTx: TransactionContext | null = null;
    private bundlePath: string = '';

    constructor(private app: App) { }

    /**
     * Set the bundle path for this transaction manager
     */
    setBundlePath(bundlePath: string): void {
        this.bundlePath = bundlePath;
    }

    /**
     * Get the map.mn file for this bundle
     */
    private getMapFile(): TFile | null {
        const mapPath = normalizePath(`${this.bundlePath}/${MAP_FILE_NAME}`);
        const file = this.app.vault.getAbstractFileByPath(mapPath);
        return file instanceof TFile ? file : null;
    }

    /**
     * Phase 1: Begin transaction and snapshot current state
     */
    async beginTransaction(): Promise<string> {
        if (this.currentTx) {
            throw new Error('Transaction already in progress');
        }

        const mapFile = this.getMapFile();
        if (!mapFile) {
            throw new Error('No map.mn file found');
        }

        const snapshot = await this.app.vault.read(mapFile);

        this.currentTx = {
            id: crypto.randomUUID(),
            mapSnapshot: snapshot,
            fileOperations: [],
            status: 'pending',
        };

        return this.currentTx.id;
    }

    /**
     * Check if a transaction is currently active
     */
    isActive(): boolean {
        return this.currentTx !== null;
    }

    /**
     * Get current transaction ID
     */
    getCurrentTransactionId(): string | null {
        return this.currentTx?.id || null;
    }

    /**
     * Record a file operation for potential rollback
     */
    recordOperation(op: FileOperation): void {
        if (!this.currentTx) {
            throw new Error('No active transaction');
        }
        this.currentTx.fileOperations.push(op);
    }

    /**
     * Record a CREATE operation
     */
    recordCreate(newPath: string): void {
        this.recordOperation({
            type: 'create',
            newPath,
        });
    }

    /**
     * Record a RENAME operation
     */
    recordRename(originalPath: string, newPath: string): void {
        this.recordOperation({
            type: 'rename',
            originalPath,
            newPath,
        });
    }

    /**
     * Record a DELETE operation (must capture content for rollback)
     */
    async recordDelete(file: TFile): Promise<void> {
        const content = await this.app.vault.read(file);
        this.recordOperation({
            type: 'delete',
            originalPath: file.path,
            originalContent: content,
        });
    }

    /**
     * Phase 2a: Commit - persist map.mn changes
     */
    async commit(newMapState: MindMapData): Promise<void> {
        console.log('MindNote: Committing transaction', this.currentTx?.id);
        if (!this.currentTx) {
            throw new Error('No active transaction');
        }

        try {
            const mapFile = this.getMapFile();
            if (!mapFile) {
                throw new Error('Map file not found during commit');
            }

            await this.app.vault.modify(mapFile, JSON.stringify(newMapState, null, 2));
            this.currentTx.status = 'committed';
        } catch (error) {
            await this.rollback();
            throw error;
        } finally {
            this.currentTx = null;
        }
    }

    /**
     * Phase 2b: Rollback - restore all files to pre-transaction state
     */
    async rollback(): Promise<void> {
        console.warn('MindNote: Rolling back transaction', this.currentTx?.id);
        if (!this.currentTx) {
            return;
        }

        // Reverse operations in LIFO order
        const ops = [...this.currentTx.fileOperations].reverse();

        for (const op of ops) {
            try {
                await this.rollbackOperation(op);
            } catch (rollbackError) {
                console.error('Rollback failed for operation:', op, rollbackError);
            }
        }

        // Restore map.mn to original state
        try {
            const mapFile = this.getMapFile();
            if (mapFile && this.currentTx.mapSnapshot) {
                await this.app.vault.modify(mapFile, this.currentTx.mapSnapshot);
            }
        } catch (mapError) {
            console.error('Failed to restore map.mn:', mapError);
        }

        this.currentTx.status = 'rolledback';
        this.currentTx = null;

        new Notice('Operation failed. Changes have been rolled back.');
    }

    /**
     * Rollback a single operation
     */
    private async rollbackOperation(op: FileOperation): Promise<void> {
        switch (op.type) {
            case 'create': {
                // Delete the created file
                if (op.newPath) {
                    const created = this.app.vault.getAbstractFileByPath(op.newPath);
                    if (created instanceof TFile) {
                        await this.app.vault.delete(created);
                    }
                }
                break;
            }

            case 'rename': {
                // Rename back to original
                if (op.newPath && op.originalPath) {
                    const renamed = this.app.vault.getAbstractFileByPath(op.newPath);
                    if (renamed instanceof TFile) {
                        await this.app.fileManager.renameFile(renamed, op.originalPath);
                    }
                }
                break;
            }

            case 'delete': {
                // Recreate the deleted file
                if (op.originalPath && op.originalContent !== undefined) {
                    await this.app.vault.create(op.originalPath, op.originalContent);
                }
                break;
            }
        }
    }

    /**
     * Abort the current transaction without rollback
     * (for cases where no operations have been performed yet)
     */
    abort(): void {
        this.currentTx = null;
    }
}
