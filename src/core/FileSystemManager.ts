/**
 * FileSystemManager
 * Manages all file operations with atomic guarantees using Obsidian's Vault API
 */
import { App, TFile, TFolder, TAbstractFile, normalizePath } from 'obsidian';

import { MindNoteSettings } from '../types';

export class FileSystemManager {
    constructor(
        private app: App,
        private getSettings: () => MindNoteSettings
    ) { }

    // ============================================================================
    // Atomic Operations
    // ============================================================================

    /**
     * Atomic write using Vault.process() to prevent conflicts
     */
    async atomicWrite(file: TFile, transform: (content: string) => string): Promise<void> {
        await this.app.vault.process(file, transform);
    }

    /**
     * Read file content
     */
    async read(file: TFile): Promise<string> {
        return await this.app.vault.read(file);
    }

    // ============================================================================
    // Directory Operations
    // ============================================================================

    /**
     * Create a directory (and parent directories if needed)
     */
    async createDirectory(path: string): Promise<TFolder | null> {
        const normalizedPath = normalizePath(path);

        try {
            await this.app.vault.createFolder(normalizedPath);
            return this.app.vault.getAbstractFileByPath(normalizedPath) as TFolder | null;
        } catch (error) {
            // Folder might already exist
            const existing = this.app.vault.getAbstractFileByPath(normalizedPath);
            if (existing instanceof TFolder) {
                return existing;
            }
            throw error;
        }
    }

    /**
     * Ensure a directory exists, creating it if necessary
     */
    async ensureDirectory(path: string): Promise<TFolder> {
        const normalizedPath = normalizePath(path);
        const existing = this.app.vault.getAbstractFileByPath(normalizedPath);

        if (existing instanceof TFolder) {
            return existing;
        }

        const folder = await this.createDirectory(normalizedPath);
        if (!folder) {
            throw new Error(`Failed to create directory: ${path}`);
        }
        return folder;
    }

    // ============================================================================
    // File Operations
    // ============================================================================

    /**
     * Create a new file with content
     */
    async createFile(path: string, content: string = ''): Promise<TFile> {
        const normalizedPath = normalizePath(path);
        return await this.app.vault.create(normalizedPath, content);
    }

    /**
     * Rename/move a file
     */
    async renameFile(file: TAbstractFile, newPath: string): Promise<void> {
        const normalizedPath = normalizePath(newPath);
        await this.app.fileManager.renameFile(file, normalizedPath);
    }

    /**
     * Delete a file using FileManager for proper cleanup (handles backlinks)
     */
    async deleteFile(file: TFile): Promise<void> {
        await this.app.fileManager.trashFile(file);
    }

    /**
     * Copy a file to a new location
     */
    async copyFile(source: TFile, destPath: string): Promise<TFile> {
        const normalizedPath = normalizePath(destPath);
        const content = await this.app.vault.read(source);
        return await this.app.vault.create(normalizedPath, content);
    }

    // ============================================================================
    // Resource Management
    // ============================================================================

    /**
     * Save an image to the bundle's img/ folder
     */
    async saveImage(bundlePath: string, data: ArrayBuffer, name: string): Promise<string> {
        return this.saveBinaryResource(bundlePath, 'img', data, name);
    }

    /**
     * Save a resource to the bundle's file/ folder
     */
    async saveResource(bundlePath: string, data: ArrayBuffer, name: string): Promise<string> {
        return this.saveBinaryResource(bundlePath, 'file', data, name);
    }

    // ============================================================================
    // Query Operations
    // ============================================================================


    private async saveBinaryResource(
        bundlePath: string,
        folderName: 'img' | 'file',
        data: ArrayBuffer,
        name: string
    ): Promise<string> {
        const targetFolder = normalizePath(`${bundlePath}/${folderName}`);
        await this.ensureDirectory(targetFolder);

        const safeName = this.generateSafeResourceName(name, targetFolder);
        const filePath = normalizePath(`${targetFolder}/${safeName}`);

        await this.app.vault.createBinary(filePath, data);
        return `${folderName}/${safeName}`;
    }

    /**
     * Check if a path exists
     */
    exists(path: string): boolean {
        const normalizedPath = normalizePath(path);
        return this.app.vault.getAbstractFileByPath(normalizedPath) !== null;
    }

    /**
     * Get abstract file by path
     */
    getAbstractFile(path: string): TAbstractFile | null {
        const normalizedPath = normalizePath(path);
        return this.app.vault.getAbstractFileByPath(normalizedPath);
    }

    /**
     * List all files in a folder
     */
    listFiles(folder: TFolder): TFile[] {
        const files: TFile[] = [];

        for (const child of folder.children) {
            if (child instanceof TFile) {
                files.push(child);
            }
        }

        return files;
    }

    // ============================================================================
    // Utility Functions
    // ============================================================================

    /**
     * Sanitize filename by replacing illegal characters
     * Illegal chars: \ / : * ? " < > |
     */
    sanitizeFilename(name: string): string {
        return name.replace(/[\\/:*?"<>|]/g, '_').trim();
    }

    /**
     * Generate a unique filename by appending _1, _2, etc.
     * Used for markdown files
     * @param ignoredPath Optional path to ignore (e.g. the file being renamed)
     */
    generateSafeName(baseName: string, folderPath: string, ignoredPath?: string): string {
        const sanitized = this.sanitizeFilename(baseName);
        let candidate = sanitized;
        let counter = 1;

        const settings = this.getSettings();
        const caseSensitive = settings.caseSensitiveFilenames;

        while (true) {
            const candidatePath = normalizePath(`${folderPath}/${candidate}.md`);

            // If this is the file we're renaming, it's safe to keep the name
            if (ignoredPath && candidatePath === normalizePath(ignoredPath)) {
                break;
            }

            if (caseSensitive) {
                // Determine existence by direct path check
                if (!this.exists(candidatePath)) {
                    break;
                }
            } else {
                // Case-insensitive check: 
                // We must check if ANY file in the directory matches case-insensitively
                const folder = this.app.vault.getAbstractFileByPath(normalizePath(folderPath));
                let exists = false;

                if (folder instanceof TFolder) {
                    for (const child of folder.children) {
                        if (child.name.toLowerCase() === `${candidate}.md`.toLowerCase()) {
                            // If it's the ignored file, it's not a conflict
                            if (ignoredPath && child.path === normalizePath(ignoredPath)) {
                                continue;
                            }
                            exists = true;
                            break;
                        }
                    }
                }

                if (!exists) {
                    break;
                }
            }

            candidate = `${sanitized}_${counter}`;
            counter++;
        }

        return candidate;
    }

    /**
     * Generate a unique resource name (for images/files with extension)
     */
    private generateSafeResourceName(name: string, folderPath: string): string {
        const sanitized = this.sanitizeFilename(name);
        const ext = sanitized.includes('.') ? sanitized.split('.').pop() : '';
        const baseName = sanitized.includes('.')
            ? sanitized.slice(0, sanitized.lastIndexOf('.'))
            : sanitized;

        let candidate = sanitized;
        let counter = 1;

        while (this.exists(normalizePath(`${folderPath}/${candidate}`))) {
            candidate = ext ? `${baseName}_${counter}.${ext}` : `${baseName}_${counter}`;
            counter++;
        }

        return candidate;
    }
}
