/**
 * WriteQueue Unit Tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WriteQueue } from '../../src/core/WriteQueue';
import { QueuedOperation, MindNode } from '../../src/types';

const createMockTxManager = () => ({
    beginTransaction: vi.fn().mockResolvedValue('tx-123'),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
});

describe('WriteQueue', () => {
    let queue: WriteQueue;
    let mockTxManager: ReturnType<typeof createMockTxManager>;
    let executeOp: ReturnType<typeof vi.fn>;
    let getMapData: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        mockTxManager = createMockTxManager();
        executeOp = vi.fn().mockResolvedValue(undefined);
        getMapData = vi.fn().mockReturnValue({ nodeData: {} });

        queue = new WriteQueue(
            mockTxManager as any,
            executeOp,
            getMapData,
            100 // 100ms debounce
        );
    });

    afterEach(() => {
        vi.useRealTimers();
        queue.clear();
    });

    describe('enqueue', () => {
        it('should add operation to queue', () => {
            const node: MindNode = { id: '1', topic: 'Test', filepath: '', children: [], expanded: true };

            queue.enqueueCreate(node);

            expect(queue.pendingCount).toBe(1);
        });

        it('should debounce processing', async () => {
            const node: MindNode = { id: '1', topic: 'Test', filepath: '', children: [], expanded: true };

            queue.enqueueCreate(node);

            // Advance less than debounce time
            await vi.advanceTimersByTimeAsync(50);

            expect(executeOp).not.toHaveBeenCalled();

            // Advance past debounce time
            await vi.advanceTimersByTimeAsync(100);

            expect(executeOp).toHaveBeenCalled();
        });
    });

    describe('coalescing', () => {
        it('should keep only last rename for same node', async () => {
            const node: MindNode = { id: '1', topic: 'Final', filepath: '', children: [], expanded: true };

            queue.enqueueRename({ ...node, topic: 'First' }, 'Original');
            queue.enqueueRename({ ...node, topic: 'Second' }, 'First');
            queue.enqueueRename(node, 'Second');

            await vi.advanceTimersByTimeAsync(150);

            // Should only execute once (the final rename)
            expect(executeOp).toHaveBeenCalledTimes(1);
        });

        it('should cancel create+delete on same node', async () => {
            const node: MindNode = { id: '1', topic: 'Test', filepath: '', children: [], expanded: true };

            queue.enqueueCreate(node);
            queue.enqueueDelete(node);

            await vi.advanceTimersByTimeAsync(150);

            // Should not execute anything (cancelled out)
            expect(executeOp).not.toHaveBeenCalled();
        });
    });

    describe('transaction handling', () => {
        it('should wrap operations in transaction', async () => {
            const node: MindNode = { id: '1', topic: 'Test', filepath: '', children: [], expanded: true };

            queue.enqueueCreate(node);
            await vi.advanceTimersByTimeAsync(150);

            expect(mockTxManager.beginTransaction).toHaveBeenCalled();
            expect(mockTxManager.commit).toHaveBeenCalled();
        });

        it('should rollback on error', async () => {
            executeOp.mockRejectedValueOnce(new Error('Test error'));
            const node: MindNode = { id: '1', topic: 'Test', filepath: '', children: [], expanded: true };

            queue.enqueueCreate(node);
            await vi.advanceTimersByTimeAsync(150);

            expect(mockTxManager.rollback).toHaveBeenCalled();
        });
    });

    describe('flush', () => {
        it('should process queue immediately', async () => {
            const node: MindNode = { id: '1', topic: 'Test', filepath: '', children: [], expanded: true };

            queue.enqueueCreate(node);
            await queue.flush();

            expect(executeOp).toHaveBeenCalled();
            expect(queue.pendingCount).toBe(0);
        });
    });

    describe('clear', () => {
        it('should clear queue without processing', () => {
            const node: MindNode = { id: '1', topic: 'Test', filepath: '', children: [], expanded: true };

            queue.enqueueCreate(node);
            queue.clear();

            expect(queue.pendingCount).toBe(0);
        });
    });
});
