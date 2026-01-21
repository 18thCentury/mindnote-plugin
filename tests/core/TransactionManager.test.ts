/**
 * TransactionManager Unit Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransactionManager } from '../../src/core/TransactionManager';
import { TFile } from 'obsidian';

const createMockApp = () => ({
    vault: {
        read: vi.fn().mockResolvedValue('{"nodeData":{}}'),
        modify: vi.fn().mockResolvedValue(undefined),
        create: vi.fn().mockResolvedValue({ path: 'test.md' }),
        delete: vi.fn().mockResolvedValue(undefined),
        getAbstractFileByPath: vi.fn(),
    },
    fileManager: {
        renameFile: vi.fn().mockResolvedValue(undefined),
    },
});

describe('TransactionManager', () => {
    let txManager: TransactionManager;
    let mockApp: ReturnType<typeof createMockApp>;

    beforeEach(() => {
        mockApp = createMockApp();
        txManager = new TransactionManager(mockApp as any);
        txManager.setBundlePath('test.mn');

        // Mock map file exists
        mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
            if (path.includes('map.mn')) {
                const file = new TFile();
                file.path = path;
                file.name = 'map.mn';
                return file;
            }
            return null;
        });
    });

    describe('beginTransaction', () => {
        it('should create a transaction with snapshot', async () => {
            const txId = await txManager.beginTransaction();

            expect(txId).toBeDefined();
            expect(typeof txId).toBe('string');
            expect(txManager.isActive()).toBe(true);
        });

        it('should throw if transaction already active', async () => {
            await txManager.beginTransaction();

            await expect(txManager.beginTransaction()).rejects.toThrow('Transaction already in progress');
        });

        it('should throw if no map file', async () => {
            mockApp.vault.getAbstractFileByPath.mockReturnValue(null);

            await expect(txManager.beginTransaction()).rejects.toThrow('No map.mn file found');
        });
    });

    describe('recordOperation', () => {
        it('should throw if no active transaction', () => {
            expect(() => txManager.recordCreate('test.md')).toThrow('No active transaction');
        });

        it('should record create operation', async () => {
            await txManager.beginTransaction();

            expect(() => txManager.recordCreate('test.md')).not.toThrow();
        });

        it('should record rename operation', async () => {
            await txManager.beginTransaction();

            expect(() => txManager.recordRename('old.md', 'new.md')).not.toThrow();
        });
    });

    describe('commit', () => {
        it('should commit and clear transaction', async () => {
            await txManager.beginTransaction();

            await txManager.commit({ nodeData: { id: '1', topic: 'Test', filepath: 'Test.md', children: [], expanded: true } });

            expect(txManager.isActive()).toBe(false);
            expect(mockApp.vault.modify).toHaveBeenCalled();
        });

        it('should throw if no active transaction', async () => {
            await expect(txManager.commit({ nodeData: {} as any })).rejects.toThrow('No active transaction');
        });
    });

    describe('rollback', () => {
        it('should rollback create operations', async () => {
            const createdFile = new TFile();
            createdFile.path = 'test.mn/md/new.md';

            mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
                if (path === 'test.mn/map.mn') {
                    const f = new TFile(); f.path = path; f.name = 'map.mn'; return f;
                }
                if (path === 'test.mn/md/new.md') return createdFile;
                return null;
            });

            await txManager.beginTransaction();
            txManager.recordCreate('test.mn/md/new.md');

            await txManager.rollback();

            expect(mockApp.vault.delete).toHaveBeenCalledWith(createdFile);
            expect(txManager.isActive()).toBe(false);
        });

        it('should rollback rename operations', async () => {
            const renamedFile = new TFile();
            renamedFile.path = 'test.mn/md/new.md';

            mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
                if (path === 'test.mn/map.mn') {
                    const f = new TFile(); f.path = path; f.name = 'map.mn'; return f;
                }
                if (path === 'test.mn/md/new.md') return renamedFile;
                return null;
            });

            await txManager.beginTransaction();
            txManager.recordRename('test.mn/md/old.md', 'test.mn/md/new.md');

            await txManager.rollback();

            expect(mockApp.fileManager.renameFile).toHaveBeenCalledWith(renamedFile, 'test.mn/md/old.md');
        });

        it('should rollback delete operations', async () => {
            mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
                if (path === 'test.mn/map.mn') {
                    const f = new TFile(); f.path = path; f.name = 'map.mn'; return f;
                }
                return null;
            });

            await txManager.beginTransaction();
            // Record delete with content
            txManager.recordOperation({
                type: 'delete',
                originalPath: 'test.mn/md/deleted.md',
                originalContent: 'original content',
            });

            await txManager.rollback();

            expect(mockApp.vault.create).toHaveBeenCalledWith('test.mn/md/deleted.md', 'original content');
        });
    });

    describe('abort', () => {
        it('should clear transaction without rollback', async () => {
            await txManager.beginTransaction();
            txManager.recordCreate('test.md');

            txManager.abort();

            expect(txManager.isActive()).toBe(false);
            expect(mockApp.vault.delete).not.toHaveBeenCalled();
        });
    });
});
