/**
 * BundleManager
 * Manages .mn bundle lifecycle and structure
 */
import { App, TFile, TFolder, normalizePath, Notice } from 'obsidian';
import { MindMapData, MindNode, MAP_FILE_NAME, FILE_EXTENSION_MN } from '../types';
import { FileSystemManager } from './FileSystemManager';

export class BundleManager {
    constructor(
        private app: App,
        private fsm: FileSystemManager
    ) { }

    /**
     * Create a new MindNote bundle
     */
    async createBundle(basePath: string, name: string): Promise<string> {
        const bundlePath = normalizePath(`${basePath}/${name}${FILE_EXTENSION_MN}`);

        // Check if bundle already exists
        if (this.fsm.exists(bundlePath)) {
            throw new Error(`Bundle "${name}" already exists`);
        }

        try {
            // Create folder structure
            await this.fsm.createDirectory(bundlePath);
            await this.fsm.createDirectory(`${bundlePath}/md`);
            await this.fsm.createDirectory(`${bundlePath}/img`);
            await this.fsm.createDirectory(`${bundlePath}/file`);

            // Create initial map.mn with root node
            const rootNode: MindNode = {
                id: this.generateId(),
                topic: name,
                filepath: `${name}.md`,
                children: [],
                expanded: true,
            };

            const initialMap: MindMapData = {
                nodeData: rootNode,
            };

            await this.fsm.createFile(
                `${bundlePath}/${MAP_FILE_NAME}`,
                JSON.stringify(initialMap, null, 2)
            );

            // Create root markdown file
            await this.fsm.createFile(`${bundlePath}/md/${name}.md`, '');

            return bundlePath;
        } catch (error) {
            // Cleanup on failure
            try {
                const folder = this.app.vault.getAbstractFileByPath(bundlePath);
                if (folder instanceof TFolder) {
                    await this.app.vault.delete(folder, true);
                }
            } catch {
                // Ignore cleanup errors
            }
            throw error;
        }
    }

    /**
     * Open an existing bundle and return its map data
     */
    async openBundle(bundlePath: string): Promise<MindMapData> {
        // Validate bundle
        const isValid = await this.validateBundle(bundlePath);
        if (!isValid) {
            throw new Error('Invalid MindNote bundle');
        }

        // Load map data
        const mapPath = normalizePath(`${bundlePath}/${MAP_FILE_NAME}`);
        const mapFile = this.app.vault.getAbstractFileByPath(mapPath);

        if (!(mapFile instanceof TFile)) {
            throw new Error('Map file not found');
        }

        const content = await this.app.vault.read(mapFile);
        return JSON.parse(content) as MindMapData;
    }

    /**
     * Validate that a path is a valid MindNote bundle
     */
    async validateBundle(bundlePath: string): Promise<boolean> {
        // Check path ends with .mn
        if (!bundlePath.endsWith(FILE_EXTENSION_MN)) {
            return false;
        }

        // Check folder exists
        const folder = this.app.vault.getAbstractFileByPath(bundlePath);
        if (!(folder instanceof TFolder)) {
            return false;
        }

        // Check map.mn exists
        const mapPath = normalizePath(`${bundlePath}/${MAP_FILE_NAME}`);
        const mapFile = this.app.vault.getAbstractFileByPath(mapPath);
        if (!(mapFile instanceof TFile)) {
            return false;
        }

        // Check required subfolders exist
        const requiredFolders = ['md', 'img', 'file'];
        for (const subFolder of requiredFolders) {
            const subPath = normalizePath(`${bundlePath}/${subFolder}`);
            const sub = this.app.vault.getAbstractFileByPath(subPath);
            if (!(sub instanceof TFolder)) {
                return false;
            }
        }

        // Validate map.mn structure
        try {
            const content = await this.app.vault.read(mapFile);
            const data = JSON.parse(content) as MindMapData;
            return data.nodeData && typeof data.nodeData.id === 'string';
        } catch {
            return false;
        }
    }

    /**
     * Check if a path is a MindNote bundle path
     */
    isBundlePath(path: string): boolean {
        return path.endsWith(FILE_EXTENSION_MN);
    }

    /**
     * Get bundle path from a map.mn file path
     */
    getBundleFromMapFile(mapFilePath: string): string | null {
        if (!mapFilePath.endsWith(MAP_FILE_NAME)) {
            return null;
        }

        const parentPath = mapFilePath.slice(0, -MAP_FILE_NAME.length - 1);
        if (parentPath.endsWith(FILE_EXTENSION_MN)) {
            return parentPath;
        }

        return null;
    }

    /**
     * Get bundle name from path
     */
    getBundleName(bundlePath: string): string {
        const name = bundlePath.split('/').pop() || '';
        return name.replace(FILE_EXTENSION_MN, '');
    }

    /**
     * Generate a unique node ID
     */
    private generateId(): string {
        return Math.random().toString(16).slice(2, 18);
    }

    /**
     * Fix bundle structure by creating missing folders
     */
    async repairBundle(bundlePath: string): Promise<boolean> {
        try {
            const requiredFolders = ['md', 'img', 'file'];
            for (const subFolder of requiredFolders) {
                await this.fsm.ensureDirectory(`${bundlePath}/${subFolder}`);
            }
            return true;
        } catch {
            return false;
        }
    }
}
