import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { FlatToHierarchyMigrator } from '../../src/core/FlatToHierarchyMigrator';

const createMockApp = () => ({
    vault: {
        getAbstractFileByPath: vi.fn(),
    },
});

const createMockFsm = () => ({
    ensureDirectory: vi.fn().mockResolvedValue({ path: 'folder' }),
    renameFile: vi.fn().mockResolvedValue(undefined),
    sanitizeFilename: vi.fn((name: string) => name.replace(/[\\/:*?"<>|]/g, '_')),
});

describe('FlatToHierarchyMigrator', () => {
    let app: ReturnType<typeof createMockApp>;
    let fsm: ReturnType<typeof createMockFsm>;
    let migrator: FlatToHierarchyMigrator;

    beforeEach(() => {
        app = createMockApp();
        fsm = createMockFsm();
        migrator = new FlatToHierarchyMigrator(app as any, fsm as any);
    });

    it('should convert flat child paths into parent-named folder paths', async () => {
        const rootFile = new TFile();
        rootFile.path = 'bundle.mn/md/Root.md';
        rootFile.name = 'Root.md';

        const childFile = new TFile();
        childFile.path = 'bundle.mn/md/Child.md';
        childFile.name = 'Child.md';

        const tempChildFile = new TFile();
        tempChildFile.path = 'bundle.mn/md/Child.md.mn_migrate_tmp_0';
        tempChildFile.name = 'Child.md.mn_migrate_tmp_0';

        app.vault.getAbstractFileByPath.mockImplementation((path: string) => {
            if (path === 'bundle.mn/md/Root.md') return rootFile;
            if (path === 'bundle.mn/md/Child.md') return childFile;
            if (path === 'bundle.mn/md/Child.md.mn_migrate_tmp_0') return tempChildFile;
            return null;
        });

        const mapData = {
            nodeData: {
                id: 'root',
                topic: 'Root',
                filepath: 'Root.md',
                children: [
                    { id: 'child', topic: 'Child', filepath: 'Child.md', children: [], expanded: true },
                ],
                expanded: true,
            },
        };

        const result = await migrator.migrateBundle('bundle.mn', mapData as any);

        expect(result.nodeData.children[0].filepath).toBe('Root/Child.md');
        expect(fsm.ensureDirectory).toHaveBeenCalledWith('bundle.mn/md/Root');
        expect(fsm.renameFile).toHaveBeenCalledWith(childFile, 'bundle.mn/md/Child.md.mn_migrate_tmp_0');
        expect(fsm.renameFile).toHaveBeenCalledWith(tempChildFile, 'bundle.mn/md/Root/Child.md');
    });

    it('should skip move when target file already exists', async () => {
        const childFile = new TFile();
        childFile.path = 'bundle.mn/md/Child.md';
        childFile.name = 'Child.md';

        const tempChildFile = new TFile();
        tempChildFile.path = 'bundle.mn/md/Child.md.mn_migrate_tmp_0';
        tempChildFile.name = 'Child.md.mn_migrate_tmp_0';

        const existingTarget = new TFile();
        existingTarget.path = 'bundle.mn/md/Root/Child.md';
        existingTarget.name = 'Child.md';

        app.vault.getAbstractFileByPath.mockImplementation((path: string) => {
            if (path === 'bundle.mn/md/Child.md') return childFile;
            if (path === 'bundle.mn/md/Child.md.mn_migrate_tmp_0') return tempChildFile;
            if (path === 'bundle.mn/md/Root/Child.md') return existingTarget;
            return null;
        });

        const mapData = {
            nodeData: {
                id: 'root',
                topic: 'Root',
                filepath: 'Root.md',
                children: [
                    { id: 'child', topic: 'Child', filepath: 'Child.md', children: [], expanded: true },
                ],
                expanded: true,
            },
        };

        await migrator.migrateBundle('bundle.mn', mapData as any);

        expect(fsm.renameFile).toHaveBeenCalledTimes(1);
        expect(fsm.renameFile).toHaveBeenCalledWith(childFile, 'bundle.mn/md/Child.md.mn_migrate_tmp_0');
    });
});
