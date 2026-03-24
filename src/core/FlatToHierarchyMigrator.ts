import { App, TFile, normalizePath } from 'obsidian';
import { MindMapData, MindNode } from '../types';
import { FileSystemManager } from './FileSystemManager';

interface MoveOperation {
    oldPath: string;
    newPath: string;
}

/**
 * Migrates legacy flat md/ structure into hierarchical node folders.
 *
 * Legacy:
 *   md/Root.md
 *   md/Child A.md
 *   md/Child B.md
 *
 * Hierarchical:
 *   md/Root.md
 *   md/Root/Child A.md
 *   md/Root/Child B.md
 */
export class FlatToHierarchyMigrator {
    constructor(
        private app: App,
        private fsm: FileSystemManager
    ) { }

    async migrateBundle(bundlePath: string, mapData: MindMapData): Promise<MindMapData> {
        const mdFolder = normalizePath(`${bundlePath}/md`);
        await this.fsm.ensureDirectory(mdFolder);

        const cloned = JSON.parse(JSON.stringify(mapData)) as MindMapData;
        const operations: MoveOperation[] = [];

        this.planNodeMigration(cloned.nodeData, undefined, operations);
        await this.executeMoves(mdFolder, operations);

        return cloned;
    }

    private planNodeMigration(node: MindNode, parentPath: string | undefined, operations: MoveOperation[]): void {
        const currentPath = this.normalizeNodePath(node);
        node.filepath = currentPath;

        const targetPath = parentPath
            ? normalizePath(`${this.stripExt(parentPath)}/${this.getBasename(currentPath)}`)
            : currentPath;

        if (targetPath !== currentPath) {
            operations.push({ oldPath: currentPath, newPath: targetPath });
            node.filepath = targetPath;
        }

        const nextParent = node.filepath;
        if (node.children && node.children.length > 0) {
            for (const child of node.children) {
                this.planNodeMigration(child, nextParent, operations);
            }
        }
    }

    private async executeMoves(mdFolder: string, operations: MoveOperation[]): Promise<void> {
        if (operations.length === 0) return;

        const tempMoves: Array<{ tempPath: string; finalPath: string }> = [];

        // phase 1: move source -> temp (avoid collisions when two files swap/order overlaps)
        for (let i = 0; i < operations.length; i++) {
            const op = operations[i];
            const sourceFile = this.getFileInVault(mdFolder, op.oldPath);
            if (!sourceFile) {
                continue;
            }

            const tempPath = normalizePath(`${op.oldPath}.mn_migrate_tmp_${i}`);
            await this.fsm.renameFile(sourceFile, normalizePath(`${mdFolder}/${tempPath}`));
            tempMoves.push({ tempPath, finalPath: op.newPath });
        }

        // phase 2: move temp -> final
        for (const move of tempMoves) {
            const tempFile = this.getFileInVault(mdFolder, move.tempPath);
            if (!tempFile) {
                continue;
            }

            const targetDir = normalizePath(`${mdFolder}/${this.getParentDir(move.finalPath)}`);
            await this.fsm.ensureDirectory(targetDir);

            const finalFilePath = normalizePath(`${mdFolder}/${move.finalPath}`);
            const existingTarget = this.app.vault.getAbstractFileByPath(finalFilePath);
            if (existingTarget instanceof TFile) {
                // Existing target means this path is already occupied; keep temp file and continue.
                // Caller can inspect mapData and manually resolve if needed.
                continue;
            }

            await this.fsm.renameFile(tempFile, finalFilePath);
        }
    }

    private getFileInVault(mdFolder: string, relativePathUnderMd: string): TFile | null {
        const absPath = normalizePath(`${mdFolder}/${relativePathUnderMd}`);
        const abstract = this.app.vault.getAbstractFileByPath(absPath);
        return abstract instanceof TFile ? abstract : null;
    }

    private normalizeNodePath(node: MindNode): string {
        if (node.filepath && node.filepath.trim().length > 0) {
            return normalizePath(node.filepath);
        }
        return `${this.fsm.sanitizeFilename(node.topic)}.md`;
    }

    private stripExt(path: string): string {
        return path.endsWith('.md') ? path.slice(0, -3) : path;
    }

    private getBasename(path: string): string {
        return path.split('/').pop() || path;
    }

    private getParentDir(path: string): string {
        const parts = path.split('/');
        parts.pop();
        return normalizePath(parts.join('/'));
    }
}
