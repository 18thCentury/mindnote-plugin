import { App, TFile, normalizePath } from 'obsidian';
import { MAP_FILE_NAME, MindMapData, MindNoteSettings } from '../types';
import { FileSystemManager } from '../core/FileSystemManager';
import { FlatToHierarchyMigrator } from '../core/FlatToHierarchyMigrator';

/**
 * Convert a legacy flat md/ bundle structure into hierarchical folders.
 *
 * Example:
 *  await migrateFlatStructure(app, 'path/to/demo.mn', () => settings)
 */
export async function migrateFlatStructure(
    app: App,
    bundlePath: string,
    getSettings: () => MindNoteSettings
): Promise<MindMapData> {
    const fsm = new FileSystemManager(app, getSettings);
    const migrator = new FlatToHierarchyMigrator(app, fsm);

    const mapPath = normalizePath(`${bundlePath}/${MAP_FILE_NAME}`);
    const mapFile = app.vault.getAbstractFileByPath(mapPath);
    if (!(mapFile instanceof TFile)) {
        throw new Error(`Map file not found: ${mapPath}`);
    }

    const content = await app.vault.read(mapFile);
    const mapData = JSON.parse(content) as MindMapData;

    const migrated = await migrator.migrateBundle(bundlePath, mapData);
    await app.vault.modify(mapFile, JSON.stringify(migrated, null, 2));

    return migrated;
}
