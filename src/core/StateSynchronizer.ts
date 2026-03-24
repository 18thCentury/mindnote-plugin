/**
 * StateSynchronizer
 * Manages bidirectional synchronization between mindmap nodes and markdown files
 */
import { App, TFile, TFolder, WorkspaceLeaf, normalizePath, debounce } from 'obsidian';
import { MindNode, MindMapData, MAP_FILE_NAME, QueuedOperation } from '../types';
import { FileSystemManager } from './FileSystemManager';
import { TransactionManager } from './TransactionManager';
import { WriteQueue } from './WriteQueue';

export class StateSynchronizer {
    private bundlePath: string = '';
    private currentOpenNode: MindNode | null = null;
    private currentLeaf: WorkspaceLeaf | null = null;
    private mapData: MindMapData | null = null;
    private writeQueue: WriteQueue;
    private readonly canvasDefaultContent = '{\n  "nodes": [],\n  "edges": []\n}';
    private fileEventUnsubscribe: (() => void) | null = null;
    private onContentChangeCallback: ((nodeId: string, hasContent: boolean) => void) | null = null;

    constructor(
        private app: App,
        private fsm: FileSystemManager,
        private txManager: TransactionManager
    ) {
        // Initialize write queue with operation executor
        this.writeQueue = new WriteQueue(
            txManager,
            (op) => this.executeQueuedOperation(op),
            () => this.getMapData(),
            100 // 100ms debounce
        );
    }

    /**
     * Initialize synchronizer for a bundle
     */
    async initialize(bundlePath: string): Promise<void> {
        this.bundlePath = bundlePath;
        this.txManager.setBundlePath(bundlePath);

        // Load initial map data
        this.mapData = await this.loadMapState();

        // Register file event listeners for external changes
        this.registerFileListeners();

        // Ensure md folder exists
        await this.fsm.ensureDirectory(this.getMdFolderPath());
    }

    /**
     * Dispose of the synchronizer
     */
    dispose(): void {
        if (this.fileEventUnsubscribe) {
            this.fileEventUnsubscribe();
            this.fileEventUnsubscribe = null;
        }
        this.writeQueue.clear();
        this.currentOpenNode = null;
        this.currentLeaf = null;
        this.mapData = null;
    }

    /**
     * Get the current map data
     */
    getMapData(): MindMapData {
        if (!this.mapData) {
            throw new Error('StateSynchronizer not initialized');
        }
        return this.mapData;
    }

    /**
     * Get map data formatted for display (resolving image URLs)
     */
    getDisplayMapData(): MindMapData {
        const data = this.getMapData();
        // Deep clone to avoid mutating persistent state
        const clone = JSON.parse(JSON.stringify(data));
        this.processNodeForDisplay(clone.nodeData);
        return clone;
    }

    /**
     * Set map data from view (sanitizes display-only data)
     */
    /**
     * Set map data from view (sanitizes display-only data)
     */
    setMapData(data: MindMapData): void {
        const uiData = JSON.parse(JSON.stringify(data));

        // Smart Merge: Preserve critical metadata (filepath) from existing state
        if (this.mapData) {
            this.mergeNodeData(uiData.nodeData, this.mapData.nodeData);
        }

        this.processNodeForStorage(uiData.nodeData);
        this.mapData = uiData;
    }

    /**
     * Recursively merge UI node data with stored node data to preserve filepaths
     */
    private mergeNodeData(uiNode: MindNode, storedNodeRoot: MindNode): void {
        // Find corresponding stored node. 
        // Note: storedNodeRoot might be the root or a parent, so we search relative to current scope 
        // or just strict ID match if we traverse in parallel.
        // But since structure changes (moves), we should look up by ID in the entire stored tree if possible,
        // or effectively we traverse assuming ID stability.
        // Actually, searching the whole tree for every node is invalid O(n^2).
        // Better strategy: The uiNode IS the new structure. We just need to pull properties from "somewhere" in the old data.

        // Optimization: For the root call, we pass the root. 
        // For children, since structure might have changed (moves), strict parallel traversal isn't enough.
        // We need a quick lookup map or we accept O(n) lookup. given map size, it might be fine, or we build a map first.

        // Let's rely on `findNodeById` which I essentially just added or can add.
        const storedNode = this.findNodeById(storedNodeRoot, uiNode.id);

        if (storedNode) {
            // Preserve filepath
            if (storedNode.filepath) {
                uiNode.filepath = storedNode.filepath;
            }
            // Preserve other backend-only props if any
        }

        if (uiNode.children && uiNode.children.length > 0) {
            for (const child of uiNode.children) {
                // We pass the SAME root to search from, because children might have been moved from elsewhere in the tree
                this.mergeNodeData(child, storedNodeRoot);
            }
        }
    }

    /**
     * Import an image file into the bundle
     * Returns the relative path to the image
     */
    async importImage(file: File): Promise<string> {
        const arrayBuffer = await file.arrayBuffer();
        if (file.type.startsWith('image/')) {
            const relativePath = await this.fsm.saveImage(this.bundlePath, arrayBuffer, file.name);
            return relativePath;
        } else {
            const relativePath = await this.fsm.saveResource(this.bundlePath, arrayBuffer, file.name);
            return relativePath;
        }
    }

    private processNodeForDisplay(node: MindNode): void {
        if (node.isImage && node.imageUrl) {
            const resourcePath = this.app.vault.adapter.getResourcePath(normalizePath(`${this.bundlePath}/${node.imageUrl}`));
            node.topic = `<img src="${resourcePath}" style="max-width:300px; border-radius: 4px;" />`;
        }
        if (node.children && node.children.length > 0) {
            for (const child of node.children) {
                this.processNodeForDisplay(child);
            }
        }
    }

    private processNodeForStorage(node: MindNode): void {
        if (node.isImage) {
            // Restore clean topic for storage
            // If we want to preserve the filename as topic, we could, but [Image] is safer
            // to avoid sync conflicts or stale data. 
            // Ideally topic should be derived from imageUrl filename?
            const filename = node.imageUrl ? node.imageUrl.split('/').pop() : 'Image';
            node.topic = `![${filename?.replace(/\./g, '_') || 'image'}]`;
        }
        if (node.children && node.children.length > 0) {
            for (const child of node.children) {
                this.processNodeForStorage(child);
            }
        }
    }

    // ============================================================================
    // Node → File Sync
    // ============================================================================

    /**
     * Handle node creation - queue the operation
     */
    onNodeCreated(node: MindNode): void {
        this.writeQueue.enqueueCreate(node);
    }

    /**
     * Handle node rename - queue the operation
     */
    onNodeRenamed(node: MindNode, oldTopic: string): void {
        this.writeQueue.enqueueRename(node, oldTopic);
    }

    /**
     * Handle node deletion - queue the operation
     */
    onNodeDeleted(node: MindNode): void {
        this.writeQueue.enqueueDelete(node);
    }

    /**
     * Handle node move - queue the operation
     */
    onNodeMoved(node: MindNode, oldParentId: string, newParentId: string): void {
        this.writeQueue.enqueueMove(node, oldParentId, newParentId);
    }

    // ============================================================================
    // Operation Execution
    // ============================================================================

    /**
     * Execute a queued operation
     */
    private async executeQueuedOperation(op: QueuedOperation): Promise<void> {
        switch (op.type) {
            case 'create':
                await this.executeNodeCreate(op.data as MindNode);
                break;
            case 'rename':
                const renameData = op.data as { node: MindNode; oldTopic: string };
                await this.executeNodeRename(renameData.node, renameData.oldTopic);
                break;
            case 'delete':
                await this.executeNodeDelete(op.data as MindNode);
                break;
            case 'move':
                // Move only updates map structure, no file operations needed
                break;
        }
    }

    /**
     * Execute node creation
     */
    private async executeNodeCreate(node: MindNode): Promise<void> {
        const targetFolder = await this.getNodeMarkdownDirectory(node);
        const safeName = this.fsm.generateSafeName(node.topic, targetFolder);
        const relativePath = this.toRelativeMdPath(`${targetFolder}/${safeName}${this.getNodeExtension(node)}`);
        const filePath = normalizePath(`${this.getMdFolderPath()}/${relativePath}`);

        await this.fsm.createFile(filePath, this.getDefaultFileContent(node));
        this.txManager.recordCreate(filePath);

        // Update node's filepath
        node.filepath = relativePath;

        // Update persistent map state
        if (this.mapData) {
            const storedNode = this.findNodeById(this.mapData.nodeData, node.id);
            if (storedNode) {
                storedNode.filepath = relativePath;
            }
        }
    }

    /**
     * Execute node rename
     */
    private async executeNodeRename(node: MindNode, _oldTopic: string): Promise<void> {
        const oldPath = normalizePath(`${this.getMdFolderPath()}/${node.filepath}`);
        const oldFile = this.app.vault.getAbstractFileByPath(oldPath);

        if (!(oldFile instanceof TFile)) {
            // File doesn't exist, treat as create
            await this.executeNodeCreate(node);
            return;
        }

        const parentDir = this.getParentDirectory(node.filepath);
        const safeName = this.fsm.generateSafeName(node.topic, parentDir, oldPath);
        const newPath = normalizePath(`${parentDir}/${safeName}${this.getNodeExtension(node)}`);
        const newRelativePath = this.toRelativeMdPath(newPath);

        if (oldPath !== newPath) {
            // If this node has descendants, close any open markdown under the folder to avoid lock/conflicts
            if (node.children && node.children.length > 0 && this.currentOpenNode) {
                const currentOpenPath = normalizePath(`${this.getMdFolderPath()}/${this.currentOpenNode.filepath}`);
                const oldFolderPath = this.stripNodeFileExtension(oldPath);
                if (currentOpenPath === oldPath || currentOpenPath.startsWith(`${oldFolderPath}/`)) {
                    await this.closeCurrentMarkdown();
                }
            }

            await this.fsm.renameFile(oldFile, newPath);
            this.txManager.recordRename(oldPath, newPath);

            node.filepath = newRelativePath;

            const oldFolderPath = this.stripNodeFileExtension(oldPath);
            const newFolderPath = this.stripNodeFileExtension(newPath);

            // If this node has children, rename its subtree folder as well
            if (node.children && node.children.length > 0) {
                const existingFolder = this.app.vault.getAbstractFileByPath(oldFolderPath);
                if (existingFolder instanceof TFolder) {
                    await this.fsm.renameFile(existingFolder, newFolderPath);
                }

                // Update descendant relative filepaths in memory and stored map state
                this.rewriteDescendantFilepaths(node, oldFolderPath, newFolderPath);
            }

            // Update persistent map state
            if (this.mapData) {
                const storedNode = this.findNodeById(this.mapData.nodeData, node.id);
                if (storedNode) {
                    storedNode.filepath = newRelativePath;
                    if (storedNode.children && storedNode.children.length > 0) {
                        this.rewriteDescendantFilepaths(storedNode, oldFolderPath, newFolderPath);
                    }
                }
            }
        }
    }

    /**
     * Execute node deletion
     */
    private async executeNodeDelete(node: MindNode): Promise<void> {
        console.log('MindNote: Executing delete for node:', node);
        // Collect resources first
        const resources = this.collectNodeResources(node);

        // Delete markdown file
        if (!node.filepath) {
            console.warn('MindNote: Node has no filepath, skipping file deletion:', node.id);
        } else {
            const mdPath = normalizePath(`${this.getMdFolderPath()}/${node.filepath}`);
            console.log('MindNote: Attempting to delete markdown file at:', mdPath);
            const mdFile = this.app.vault.getAbstractFileByPath(mdPath);

            if (mdFile instanceof TFile) {
                await this.txManager.recordDelete(mdFile);
                await this.fsm.deleteFile(mdFile);
                console.log('MindNote: Deleted file:', mdPath);
            } else {
                console.warn('MindNote: File not found for deletion:', mdPath);
            }
        }

        // Delete associated resources
        for (const resource of resources) {
            await this.txManager.recordDelete(resource);
            await this.fsm.deleteFile(resource);
        }

        // Recursively delete children
        if (node.children && Array.isArray(node.children)) {
            for (const child of node.children) {
                await this.executeNodeDelete(child);
            }
        }
    }

    /**
     * Find a node by its ID
     */
    private findNodeById(node: MindNode, id: string): MindNode | null {
        if (node.id === id) {
            return node;
        }

        if (node.children && node.children.length > 0) {
            for (const child of node.children) {
                const found = this.findNodeById(child, id);
                if (found) return found;
            }
        }

        return null;
    }

    /**
     * Collect all image resources referenced in a node's markdown file
     * Uses Obsidian's CachedMetadata API for accurate parsing
     */
    private collectNodeResources(node: MindNode): TFile[] {
        const resources: TFile[] = [];
        const mdPath = normalizePath(`${this.getMdFolderPath()}/${node.filepath}`);
        const mdFile = this.app.vault.getAbstractFileByPath(mdPath);

        if (!(mdFile instanceof TFile)) return resources;

        // Use Obsidian's cached metadata
        const cache = this.app.metadataCache.getFileCache(mdFile);
        if (!cache?.embeds) return resources;

        for (const embed of cache.embeds) {
            // embed.link contains the file reference (e.g., "img/photo.png")
            const imgPath = normalizePath(`${this.bundlePath}/${embed.link}`);
            const imgFile = this.app.vault.getAbstractFileByPath(imgPath);

            if (imgFile instanceof TFile) {
                resources.push(imgFile);
            }
        }

        return resources;
    }

    // ============================================================================
    // Markdown Leaf Management
    // ============================================================================

    /**
     * Open the markdown file associated with a node
     */
    private openFileRequestId = 0;

    /**
     * Open the markdown file associated with a node
     */
    async openNodeMarkdown(node: MindNode, options: { active: boolean } = { active: true }): Promise<void> {
        // Increment request ID to invalidate previous pending requests
        const requestId = ++this.openFileRequestId;

        // Use authoritative node state to get filepath
        // The UI node might be stale (missing filepath after creation)
        let targetNode = node;
        if (this.mapData) {
            const authoritativeNode = this.findNodeById(this.mapData.nodeData, node.id);
            if (authoritativeNode) {
                targetNode = authoritativeNode;
            }
        }

        // Optimization: Fast path if file already exists
        // Check Obsidian cache directly (synchronous & fast)
        let fileExists = false;
        if (targetNode.filepath) {
            const existingPath = normalizePath(`${this.getMdFolderPath()}/${targetNode.filepath}`);
            const existingFile = this.app.vault.getAbstractFileByPath(existingPath);
            if (existingFile instanceof TFile) {
                fileExists = true;
            }
        }

        // If no filepath exists or file missing, create the markdown file now
        if (!fileExists) {
            await this.ensureNodeHasBackingFile(targetNode);

            // Check for cancellation after async op
            if (this.openFileRequestId !== requestId) return;
        }

        // Still no filepath? Something went wrong
        if (!targetNode.filepath) {
            console.warn('MindNote: Could not create file for node:', targetNode.id);
            return;
        }

        // If clicking the same node, do nothing
        if (this.currentOpenNode && this.currentOpenNode.id === targetNode.id) {
            return;
        }

        // Determine the file path
        const filePath = normalizePath(`${this.getMdFolderPath()}/${targetNode.filepath}`);
        let file = this.app.vault.getAbstractFileByPath(filePath);

        // If file doesn't exist on disk (unlikely given check above, but possible race), create it
        if (!(file instanceof TFile)) {
            await this.fsm.ensureDirectory(this.getMdFolderPath());
            // Check cancellation
            if (this.openFileRequestId !== requestId) return;

            await this.fsm.createFile(filePath, this.getDefaultFileContent(targetNode));
            // Check cancellation
            if (this.openFileRequestId !== requestId) return;

            file = this.app.vault.getAbstractFileByPath(filePath);
        }

        if (file instanceof TFile) {
            // Check if we can reuse the current leaf
            let leaf = this.currentLeaf;

            // Verify if the leaf is still attached to the workspace
            let existsInWorkspace = false;
            if (leaf) {
                this.app.workspace.iterateAllLeaves((l) => {
                    if (l === leaf) existsInWorkspace = true;
                });
            }

            if (!existsInWorkspace || !leaf) {
                // Create a new split if no valid leaf exists
                leaf = this.app.workspace.getLeaf('split', 'vertical');
            }

            if (leaf) {
                // Request cancellation check one last time before UI update
                if (this.openFileRequestId !== requestId) return;

                await leaf.openFile(file, { active: options.active });

                // Final check to ensure we don't update state if another request came in during openFile
                if (this.openFileRequestId !== requestId) return;

                this.currentOpenNode = targetNode;
                this.currentLeaf = leaf;
            }
        }
    }

    /**
     * Ensure a node has an associated markdown file, creating one if needed
     */
    private async ensureNodeHasBackingFile(node: MindNode): Promise<void> {
        const targetFolder = await this.getNodeMarkdownDirectory(node);
        const safeName = this.fsm.generateSafeName(node.topic, targetFolder);
        const relativePath = this.toRelativeMdPath(`${targetFolder}/${safeName}${this.getNodeExtension(node)}`);
        const filePath = normalizePath(`${this.getMdFolderPath()}/${relativePath}`);

        // Create the file if it doesn't exist
        const existingFile = this.app.vault.getAbstractFileByPath(filePath);
        if (!(existingFile instanceof TFile)) {
            await this.fsm.createFile(filePath, this.getDefaultFileContent(node));
        }

        // Update node's filepath
        node.filepath = relativePath;

        // Update persistent map state
        if (this.mapData) {
            const storedNode = this.findNodeById(this.mapData.nodeData, node.id);
            if (storedNode) {
                storedNode.filepath = relativePath;
            }
            // Save immediately
            await this.saveMapState();
        }
    }

    /**
     * Close the currently open markdown file
     */
    async closeCurrentMarkdown(): Promise<void> {
        if (this.currentLeaf) {
            this.currentLeaf.detach();
            this.currentLeaf = null;
        }
        this.currentOpenNode = null;
    }

    /**
     * Get the currently open node
     */
    getCurrentOpenNode(): MindNode | null {
        return this.currentOpenNode;
    }

    // ============================================================================
    // State Persistence
    // ============================================================================

    /**
     * Load map state from map.mn
     */
    async loadMapState(): Promise<MindMapData | null> {
        const mapPath = normalizePath(`${this.bundlePath}/${MAP_FILE_NAME}`);
        const mapFile = this.app.vault.getAbstractFileByPath(mapPath);

        if (!(mapFile instanceof TFile)) {
            return null;
        }

        try {
            const content = await this.app.vault.read(mapFile);
            return JSON.parse(content) as MindMapData;
        } catch {
            return null;
        }
    }

    /**
     * Save map state immediately (bypassing queue)
     */
    async saveMapState(): Promise<void> {
        if (!this.mapData) return;

        const mapPath = normalizePath(`${this.bundlePath}/${MAP_FILE_NAME}`);
        const mapFile = this.app.vault.getAbstractFileByPath(mapPath);

        if (mapFile instanceof TFile) {
            await this.app.vault.modify(mapFile, JSON.stringify(this.mapData, null, 2));
        }
    }

    /**
     * Flush any pending operations
     */
    async flush(): Promise<void> {
        await this.writeQueue.flush();
    }

    // ============================================================================
    // File → Node Sync (External Changes)
    // ============================================================================

    /**
     * Set callback for content changes (used by view to update contentMap)
     */
    setOnContentChange(callback: (nodeId: string, hasContent: boolean) => void): void {
        this.onContentChangeCallback = callback;
    }

    /**
     * Register file event listeners for external changes
     */
    private registerFileListeners(): void {
        // Debounced handler for file modifications
        const handleFileChange = debounce(
            async (file: TFile) => {
                await this.onExternalFileChange(file);
            },
            500,
            true
        );

        // Listen for file modifications
        const modifyRef = this.app.vault.on('modify', (file) => {
            if (file instanceof TFile && this.isInBundle(file.path)) {
                handleFileChange(file);
            }
        });

        // Listen for file renames
        const renameRef = this.app.vault.on('rename', async (file, oldPath) => {
            if (file instanceof TFile && this.isInBundle(file.path)) {
                await this.onExternalFileRename(file, oldPath);
            }
        });

        // Listen for file deletions
        const deleteRef = this.app.vault.on('delete', async (file) => {
            if (file instanceof TFile && this.isInBundle(file.path)) {
                await this.onExternalFileDelete(file);
            }
        });

        // Cleanup function
        this.fileEventUnsubscribe = () => {
            this.app.vault.offref(modifyRef);
            this.app.vault.offref(renameRef);
            this.app.vault.offref(deleteRef);
        };
    }

    /**
     * Check if a path is within this bundle
     */
    private isInBundle(path: string): boolean {
        return path.startsWith(this.bundlePath);
    }

    /**
     * Handle external file change - notify view of content changes
     */
    private async onExternalFileChange(file: TFile): Promise<void> {
        // Only process markdown files in the md folder
        if (!this.mapData || !file.path.includes('/md/') || !file.path.endsWith('.md')) return;

        const relativePath = this.toRelativeMdPath(file.path);
        const node = this.findNodeByFilepath(this.mapData.nodeData, relativePath);
        if (node && this.onContentChangeCallback) {
            const content = await this.app.vault.read(file);
            const hasContent = content.trim().length > 0;
            this.onContentChangeCallback(node.id, hasContent);
        }
    }

    /**
     * Handle external file rename - update map.mn
     */
    private async onExternalFileRename(file: TFile, oldPath: string): Promise<void> {
        if (!this.mapData) return;

        const oldRelativePath = this.toRelativeMdPath(oldPath);
        const newRelativePath = this.toRelativeMdPath(file.path);

        // Find and update the node with this filepath
        const node = this.findNodeByFilepath(this.mapData.nodeData, oldRelativePath);
        if (node) {
            node.filepath = newRelativePath;
            // Also update topic to match filename (without extension)
            node.topic = file.basename;
            await this.saveMapState();
        }
    }

    /**
     * Handle external file deletion - update map.mn
     */
    private async onExternalFileDelete(file: TFile): Promise<void> {
        // Note: We don't automatically delete nodes when files are deleted
        // as this could be destructive. Just clear the filepath.
        if (!this.mapData) return;

        const relativePath = this.toRelativeMdPath(file.path);
        const node = this.findNodeByFilepath(this.mapData.nodeData, relativePath);
        if (node) {
            node.filepath = '';
            await this.saveMapState();
        }
    }

    /**
     * Find a node by its filepath
     */
    private findNodeByFilepath(node: MindNode, filepath: string): MindNode | null {
        if (node.filepath === filepath) {
            return node;
        }

        if (node.children && node.children.length > 0) {
            for (const child of node.children) {
                const found = this.findNodeByFilepath(child, filepath);
                if (found) return found;
            }
        }

        return null;
    }

    // ============================================================================
    // Helpers
    // ============================================================================

    /**
     * Get the md folder path
     */
    private getMdFolderPath(): string {
        return normalizePath(`${this.bundlePath}/md`);
    }

    /**
     * Get the md folder
     */
    private getMdFolder(): TFolder | null {
        const path = this.getMdFolderPath();
        const folder = this.app.vault.getAbstractFileByPath(path);
        return folder instanceof TFolder ? folder : null;
    }

    private async getNodeMarkdownDirectory(node: MindNode): Promise<string> {
        const mdFolder = this.getMdFolderPath();
        await this.fsm.ensureDirectory(mdFolder);

        if (!this.mapData) {
            return mdFolder;
        }

        const parentNode = this.findParentNodeById(this.mapData.nodeData, node.id);
        if (!parentNode || !parentNode.filepath) {
            return mdFolder;
        }

        const parentFilePath = normalizePath(`${mdFolder}/${parentNode.filepath}`);
        const parentFolderPath = this.stripNodeFileExtension(parentFilePath);
        await this.fsm.ensureDirectory(parentFolderPath);
        return parentFolderPath;
    }

    private findParentNodeById(root: MindNode, targetId: string): MindNode | null {
        if (!root.children || root.children.length === 0) {
            return null;
        }

        for (const child of root.children) {
            if (child.id === targetId) {
                return root;
            }
            const found = this.findParentNodeById(child, targetId);
            if (found) {
                return found;
            }
        }

        return null;
    }

    private stripNodeFileExtension(path: string): string {
        if (path.endsWith('.canvas')) return path.slice(0, -7);
        if (path.endsWith('.md')) return path.slice(0, -3);
        return path;
    }

    private getNodeExtension(node: MindNode): '.md' | '.canvas' {
        return node.fileType === 'canvas' ? '.canvas' : '.md';
    }

    private getDefaultFileContent(node: MindNode): string {
        return node.fileType === 'canvas' ? this.canvasDefaultContent : '';
    }

    private getParentDirectory(filePath: string): string {
        const absolutePath = normalizePath(`${this.getMdFolderPath()}/${filePath}`);
        const segments = absolutePath.split('/');
        segments.pop();
        return normalizePath(segments.join('/'));
    }

    private toRelativeMdPath(absolutePath: string): string {
        const normalizedPath = normalizePath(absolutePath);
        const mdPrefix = `${this.getMdFolderPath()}/`;
        if (normalizedPath.startsWith(mdPrefix)) {
            return normalizedPath.slice(mdPrefix.length);
        }
        return normalizedPath;
    }

    private rewriteDescendantFilepaths(node: MindNode, oldFolderAbsPath: string, newFolderAbsPath: string): void {
        if (!node.children || node.children.length === 0) {
            return;
        }

        const oldPrefix = `${normalizePath(oldFolderAbsPath)}/`;
        const newPrefix = `${normalizePath(newFolderAbsPath)}/`;

        for (const child of node.children) {
            if (child.filepath) {
                const childAbsPath = normalizePath(`${this.getMdFolderPath()}/${child.filepath}`);
                if (childAbsPath.startsWith(oldPrefix)) {
                    child.filepath = this.toRelativeMdPath(childAbsPath.replace(oldPrefix, newPrefix));
                }
            }
            this.rewriteDescendantFilepaths(child, oldFolderAbsPath, newFolderAbsPath);
        }
    }

}
