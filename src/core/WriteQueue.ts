/**
 * WriteQueue
 * Serializes high-frequency file operations with debouncing and coalescing
 */
import { Notice } from 'obsidian';
import { QueuedOperation, MindMapData, MindNode } from '../types';
import { TransactionManager } from './TransactionManager';

export type OperationExecutor = (op: QueuedOperation) => Promise<void>;
export type MapDataGetter = () => MindMapData;

export class WriteQueue {
    private queue: QueuedOperation[] = [];
    private processing = false;
    private debounceTimer: number | null = null;
    private readonly DEBOUNCE_MS: number;

    constructor(
        private txManager: TransactionManager,
        private executeOperation: OperationExecutor,
        private getMapData: MapDataGetter,
        debounceMs: number = 100
    ) {
        this.DEBOUNCE_MS = debounceMs;
    }

    /**
     * Enqueue an operation with debouncing
     */
    enqueue(
        type: QueuedOperation['type'],
        nodeId: string,
        data: unknown
    ): void {
        const operation: QueuedOperation = {
            id: crypto.randomUUID(),
            type,
            nodeId,
            data,
            timestamp: Date.now(),
        };

        this.queue.push(operation);
        this.scheduleProcessing();
    }

    /**
     * Enqueue a create operation
     */
    enqueueCreate(node: MindNode, parentId?: string): void {
        this.enqueue('create', node.id, { node, parentId });
    }

    /**
     * Enqueue a rename operation
     */
    enqueueRename(node: MindNode, oldTopic: string): void {
        this.enqueue('rename', node.id, { node, oldTopic });
    }

    /**
     * Enqueue a delete operation
     */
    enqueueDelete(node: MindNode): void {
        this.enqueue('delete', node.id, node);
    }

    /**
     * Enqueue a move operation
     */
    enqueueMove(node: MindNode, oldParentId: string, newParentId: string): void {
        this.enqueue('move', node.id, { node, oldParentId, newParentId });
    }

    /**
     * Schedule processing with debounce
     */
    private scheduleProcessing(): void {
        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
            this.processQueue();
        }, this.DEBOUNCE_MS) as unknown as number;
    }

    /**
     * Process all queued operations in a single transaction
     */
    private async processQueue(): Promise<void> {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;
        const operations = this.coalesceOperations([...this.queue]);
        this.queue = [];

        try {
            await this.txManager.beginTransaction();

            for (const op of operations) {
                await this.executeOperation(op);
            }

            await this.txManager.commit(this.getMapData());
        } catch (error) {
            console.error('MindNote: WriteQueue processing failed:', error);
            await this.txManager.rollback();
            const message = error instanceof Error ? error.message : 'Unknown error';
            new Notice(`Failed to save changes: ${message}`);
        } finally {
            this.processing = false;

            // Process any operations that came in while we were busy
            if (this.queue.length > 0) {
                this.scheduleProcessing();
            }
        }
    }

    /**
     * Coalesce redundant operations on the same node
     * e.g., multiple renames → keep only the last one
     * 
     * Rules:
     * - Multiple renames on same node → keep last
     * - Create then delete same node → cancel both
     * - Rename then delete → keep delete only
     */
    private coalesceOperations(ops: QueuedOperation[]): QueuedOperation[] {
        const nodeOps = new Map<string, QueuedOperation[]>();

        // Group by node ID
        for (const op of ops) {
            const existing = nodeOps.get(op.nodeId) || [];
            existing.push(op);
            nodeOps.set(op.nodeId, existing);
        }

        const result: QueuedOperation[] = [];

        for (const [_nodeId, nodeOperations] of nodeOps) {
            const coalesced = this.coalesceNodeOperations(nodeOperations);
            result.push(...coalesced);
        }

        // Sort by timestamp to maintain order
        return result.sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Coalesce operations for a single node
     */
    private coalesceNodeOperations(ops: QueuedOperation[]): QueuedOperation[] {
        if (ops.length === 0) return [];
        if (ops.length === 1) return ops;

        // Sort by timestamp
        ops.sort((a, b) => a.timestamp - b.timestamp);

        const hasCreate = ops.some((op) => op.type === 'create');
        const hasDelete = ops.some((op) => op.type === 'delete');

        // Create then delete → cancel both
        if (hasCreate && hasDelete) {
            return [];
        }

        // If there's a delete, only keep the delete
        if (hasDelete) {
            return [ops.find((op) => op.type === 'delete')!];
        }

        // For renames, keep only the last one
        const renames = ops.filter((op) => op.type === 'rename');
        const others = ops.filter((op) => op.type !== 'rename');

        if (renames.length > 1) {
            // Keep only the last rename
            others.push(renames[renames.length - 1]);
        } else {
            others.push(...renames);
        }

        return others.sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Flush the queue immediately (for cleanup/shutdown)
     */
    async flush(): Promise<void> {
        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }

        if (this.queue.length > 0 && !this.processing) {
            await this.processQueue();
        }
    }

    /**
     * Clear the queue without processing
     */
    clear(): void {
        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this.queue = [];
    }

    /**
     * Get the number of pending operations
     */
    get pendingCount(): number {
        return this.queue.length;
    }

    /**
     * Check if currently processing
     */
    get isProcessing(): boolean {
        return this.processing;
    }
}
