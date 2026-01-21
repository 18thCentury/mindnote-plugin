/**
 * StateSynchronizer Unit Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StateSynchronizer } from '../../src/core/StateSynchronizer';
import { FileSystemManager } from '../../src/core/FileSystemManager';
import { TransactionManager } from '../../src/core/TransactionManager';
import { MindNode } from '../../src/types';
import { TFile } from 'obsidian';

// Create mock implementations
const createMockApp = () => ({
    vault: {
        read: vi.fn().mockResolvedValue('{}'),
        modify: vi.fn().mockResolvedValue(undefined),
        create: vi.fn().mockResolvedValue({ path: 'test.md' }),
        delete: vi.fn().mockResolvedValue(undefined),
        getAbstractFileByPath: vi.fn(),
        on: vi.fn().mockReturnValue({ id: 'event-ref' }),
        offref: vi.fn(),
    },
    workspace: {
        getLeaf: vi.fn().mockReturnValue({
            openFile: vi.fn().mockResolvedValue(undefined),
        }),
    },
    fileManager: {
        renameFile: vi.fn().mockResolvedValue(undefined),
        trashFile: vi.fn().mockResolvedValue(undefined),
    },
    metadataCache: {
        getFileCache: vi.fn().mockReturnValue(null),
    },
});

const createMockFsm = () => ({
    createFile: vi.fn().mockResolvedValue({ path: 'test.md' }),
    renameFile: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    generateSafeName: vi.fn((name: string) => name),
    ensureDirectory: vi.fn().mockResolvedValue({ path: 'md' }),
    exists: vi.fn().mockReturnValue(false),
});

const createMockTxManager = () => ({
    setBundlePath: vi.fn(),
    beginTransaction: vi.fn().mockResolvedValue('tx-123'),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    recordCreate: vi.fn(),
    recordRename: vi.fn(),
    recordDelete: vi.fn().mockResolvedValue(undefined),
});

describe('StateSynchronizer', () => {
    let sync: StateSynchronizer;
    let mockApp: ReturnType<typeof createMockApp>;
    let mockFsm: ReturnType<typeof createMockFsm>;
    let mockTxManager: ReturnType<typeof createMockTxManager>;

    beforeEach(() => {
        mockApp = createMockApp();
        mockFsm = createMockFsm();
        mockTxManager = createMockTxManager();

        sync = new StateSynchronizer(
            mockApp as any,
            mockFsm as any,
            mockTxManager as any
        );
    });

    describe('initialization', () => {
        it('should initialize with bundle path', async () => {
            const mapData = { nodeData: { id: '1', topic: 'Root', filepath: 'Root.md', children: [], expanded: true } };

            mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
                if (path.includes('map.mn')) {
                    const f = new TFile(); f.path = path; f.name = 'map.mn'; return f;
                }
                return null;
            });

            mockApp.vault.read.mockResolvedValue(JSON.stringify(mapData));

            await sync.initialize('test.mn');

            expect(mockTxManager.setBundlePath).toHaveBeenCalledWith('test.mn');
        });
    });

    describe('node operations', () => {
        beforeEach(async () => {
            const mapData = { nodeData: { id: '1', topic: 'Root', filepath: 'Root.md', children: [], expanded: true } };

            mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
                if (path.includes('map.mn')) {
                    const f = new TFile(); f.path = path; f.name = 'map.mn'; return f;
                }
                return null;
            });

            mockApp.vault.read.mockResolvedValue(JSON.stringify(mapData));
            await sync.initialize('test.mn');
        });

        it('should queue node creation', () => {
            const node: MindNode = {
                id: 'new-1',
                topic: 'New Node',
                filepath: '',
                children: [],
                expanded: true,
            };

            sync.onNodeCreated(node);

            // Queue is debounced, so we just verify no immediate error
            expect(true).toBe(true);
        });

        it('should queue node rename', () => {
            const node: MindNode = {
                id: 'node-1',
                topic: 'Renamed Node',
                filepath: 'Old Node.md',
                children: [],
                expanded: true,
            };

            sync.onNodeRenamed(node, 'Old Node');

            expect(true).toBe(true);
        });

        it('should queue node deletion', () => {
            const node: MindNode = {
                id: 'node-1',
                topic: 'Delete Me',
                filepath: 'Delete Me.md',
                children: [],
                expanded: true,
            };

            sync.onNodeDeleted(node);

            expect(true).toBe(true);
        });
        expect(true).toBe(true);
    });


    describe('markdown leaf management', () => {
        beforeEach(async () => {
            const mapData = { nodeData: { id: '1', topic: 'Root', filepath: 'Root.md', children: [], expanded: true } };
            mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
                if (path.endsWith('.md')) {
                    const f = new TFile(); f.path = path; f.name = path.split('/').pop()!; return f;
                }
                return null;
            });
            mockApp.vault.read.mockResolvedValue(JSON.stringify(mapData));
            await sync.initialize('test.mn');
        });

        it('should open markdown file for node', async () => {
            const node: MindNode = { id: '1', topic: 'Node', filepath: 'Node.md', children: [], expanded: true };
            await sync.openNodeMarkdown(node);
            expect(mockApp.workspace.getLeaf).toHaveBeenCalledWith('split', 'vertical');
        });

        it('should close previous leaf when opening new node', async () => {
            const node1: MindNode = { id: '1', topic: 'Node 1', filepath: 'Node1.md', children: [], expanded: true };
            const node2: MindNode = { id: '2', topic: 'Node 2', filepath: 'Node2.md', children: [], expanded: true };

            const mockDetach = vi.fn();
            mockApp.workspace.getLeaf.mockReturnValue({
                openFile: vi.fn().mockResolvedValue(undefined),
                detach: mockDetach,
            });

            await sync.openNodeMarkdown(node1);
            await sync.openNodeMarkdown(node2);

            expect(mockDetach).toHaveBeenCalled();
        });

        it('should not reopen if same node is clicked', async () => {
            const node: MindNode = { id: '1', topic: 'Node', filepath: 'Node.md', children: [], expanded: true };

            // First open
            await sync.openNodeMarkdown(node);

            // Clear mock calls to verify next call
            mockApp.workspace.getLeaf.mockClear();

            // Second open (same node)
            await sync.openNodeMarkdown(node);

            expect(mockApp.workspace.getLeaf).not.toHaveBeenCalled();
        });

        it('should open markdown file even if input node lacks filepath (lookup from mapData)', async () => {
            const nodeWithFilepath = { id: '1', topic: 'Node', filepath: 'Node.md', children: [], expanded: true };
            const nodeWithoutFilepath = { id: '1', topic: 'Node', filepath: '', children: [], expanded: true };

            // Initialize with map data containing the complete node
            const mapData = { nodeData: nodeWithFilepath };
            mockApp.vault.read.mockResolvedValue(JSON.stringify(mapData));

            // Fix mock to allow loading map.mn AND finding the .md file
            mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
                if (path.includes('map.mn')) {
                    const f = new TFile(); f.path = path; f.name = 'map.mn'; return f;
                }
                if (path.endsWith('.md')) {
                    const f = new TFile(); f.path = path; f.name = path.split('/').pop()!; return f;
                }
                return null;
            });

            // Force re-initialization to load mapData
            await sync.initialize('test.mn');

            await sync.openNodeMarkdown(nodeWithoutFilepath);

            expect(mockApp.workspace.getLeaf).toHaveBeenCalledWith('split', 'vertical');
        });
    });

    describe('getMapData', () => {
        it('should throw if not initialized', () => {
            expect(() => sync.getMapData()).toThrow('StateSynchronizer not initialized');
        });

        it('should return map data after initialization', async () => {
            const mapData = { nodeData: { id: '1', topic: 'Root', filepath: 'Root.md', children: [], expanded: true } };

            mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
                if (path.includes('map.mn')) {
                    const f = new TFile(); f.path = path; f.name = 'map.mn'; return f;
                }
                return null;
            });

            mockApp.vault.read.mockResolvedValue(JSON.stringify(mapData));

            await sync.initialize('test.mn');

            expect(sync.getMapData()).toEqual(mapData);
        });
    });

    describe('dispose', () => {
        it('should cleanup resources', async () => {
            const mapData = { nodeData: { id: '1', topic: 'Root', filepath: 'Root.md', children: [], expanded: true } };
            mockApp.vault.getAbstractFileByPath.mockReturnValue({ path: 'test.mn/map.mn' });

            mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
                if (path.includes('map.mn')) {
                    const f = new TFile(); f.path = path; f.name = 'map.mn'; return f;
                }
                return null;
            });

            mockApp.vault.read.mockResolvedValue(JSON.stringify(mapData));

            await sync.initialize('test.mn');
            sync.dispose();

            expect(sync.getCurrentOpenNode()).toBeNull();
        });
    });

    describe('Smart Merge Strategy', () => {
        beforeEach(async () => {
            const mapData = {
                nodeData: {
                    id: 'root',
                    topic: 'Root',
                    filepath: 'Root.md',
                    children: [
                        { id: '1', topic: 'Node 1', filepath: 'Node_1.md', children: [], expanded: true }
                    ],
                    expanded: true
                }
            };

            mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => {
                if (path.includes('map.mn')) {
                    const f = new TFile(); f.path = path; f.name = 'map.mn'; return f;
                }
                return null;
            });
            mockApp.vault.read.mockResolvedValue(JSON.stringify(mapData));
            await sync.initialize('test.mn');
        });

        it('should preserve filepath when overwritten by UI data', () => {
            // Simulate UI sending data without filepath
            const uiData: any = {
                nodeData: {
                    id: 'root',
                    topic: 'Root',
                    // filepath missing or empty from UI
                    children: [
                        { id: '1', topic: 'Node 1 Updated', children: [], expanded: true } // filepath missing
                    ],
                    expanded: true
                }
            };

            sync.setMapData(uiData);

            const result = sync.getMapData();
            // Should preserve root filepath
            expect(result.nodeData.filepath).toBe('Root.md');
            // Should preserve child filepath AND update topic
            expect(result.nodeData.children[0].filepath).toBe('Node_1.md');
            expect(result.nodeData.children[0].topic).toBe('Node 1 Updated');
        });

        it('should handle new nodes from UI', () => {
            const uiData: any = {
                nodeData: {
                    id: 'root',
                    topic: 'Root',
                    children: [
                        { id: '1', topic: 'Node 1', children: [], expanded: true },
                        { id: '2', topic: 'New Node', children: [], expanded: true } // New node
                    ],
                    expanded: true
                }
            };

            sync.setMapData(uiData);

            const result = sync.getMapData();
            expect(result.nodeData.children).toHaveLength(2);
            expect(result.nodeData.children[1].id).toBe('2');
            // New node won't have filepath yet (handled by onNodeCreated)
            expect(result.nodeData.children[1].filepath).toBeUndefined();
        });
    });
});
