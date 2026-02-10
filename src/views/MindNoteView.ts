/**
 * MindNote View
 * Main view for displaying and interacting with the mindmap using React Flow
 */
import { ItemView, WorkspaceLeaf, TFile, Notice, normalizePath } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import type MindNotePlugin from '../main';
import { VIEW_TYPE_MINDNOTE, MindMapData, MindNode, MAP_FILE_NAME, FILE_EXTENSION_MN } from '../types';
import { FileSystemManager, TransactionManager, StateSynchronizer } from '../core';
import { MindMapFlow, type MindMapFlowProps } from './components';

export class MindNoteView extends ItemView {
    plugin: MindNotePlugin;
    bundlePath: string = '';
    bundleName: string = '';
    private reactRoot: Root | null = null;
    private containerEl_: HTMLElement | null = null;

    // Core Modules
    private fsm: FileSystemManager;
    private txManager: TransactionManager;
    private synchronizer: StateSynchronizer;

    // Content tracking
    private contentMap: Map<string, boolean> = new Map();

    constructor(leaf: WorkspaceLeaf, plugin: MindNotePlugin) {
        super(leaf);
        this.plugin = plugin;

        // Initialize core modules
        this.fsm = new FileSystemManager(this.app, () => this.plugin.settings);
        this.txManager = new TransactionManager(this.app);
        this.synchronizer = new StateSynchronizer(this.app, this.fsm, this.txManager);
    }

    getViewType(): string {
        return VIEW_TYPE_MINDNOTE;
    }

    getDisplayText(): string {
        return this.bundleName || 'MindNote';
    }

    getIcon(): string {
        return 'brain';
    }

    async onOpen(): Promise<void> {
        this.containerEl_ = this.containerEl.children[1] as HTMLElement;
        this.containerEl_.empty();
        this.containerEl_.addClass('mindnote-container');

        // Create mindmap container
        const mapContainer = this.containerEl_.createDiv({ cls: 'mindnote-map' });

        // Ensure bundle is loaded
        if (this.bundlePath) {
            await this.initializeMindMap(mapContainer);
        }
    }

    async onClose(): Promise<void> {
        // Unmount React tree
        if (this.reactRoot) {
            this.reactRoot.unmount();
            this.reactRoot = null;
        }

        // Flush pending synchronizer operations
        await this.synchronizer.flush();
        this.synchronizer.dispose();
    }

    /**
     * Called when view state is set (e.g., from navigation)
     */
    async setState(state: { bundlePath?: string; file?: string }, result: { history: boolean }): Promise<void> {
        if (state.file && !state.bundlePath) {
            // Check if opening map.mn directly
            if (state.file.endsWith(MAP_FILE_NAME)) {
                state.bundlePath = state.file.substring(0, state.file.length - MAP_FILE_NAME.length - 1);
            } else if (state.file.endsWith(normalizePath(FILE_EXTENSION_MN))) {
                // Fallback if opening the folder directly (if supported)
                state.bundlePath = state.file;
            }
        }

        if (state.bundlePath) {
            this.bundlePath = state.bundlePath;
            this.bundleName = this.bundlePath.split('/').pop()?.replace('.mn', '') || 'MindNote';

            // If already open, re-initialize
            if (this.containerEl_) {
                const mapContainer = this.containerEl_.querySelector('.mindnote-map') as HTMLElement;
                if (mapContainer) {
                    mapContainer.empty();
                    await this.initializeMindMap(mapContainer);
                }
            }
        }
        await super.setState(state, result);
    }

    getState(): { bundlePath: string } {
        return { bundlePath: this.bundlePath };
    }

    /**
     * Initialize the mind map with data from synchronizer
     */
    private async initializeMindMap(container: HTMLElement): Promise<void> {
        try {
            await this.synchronizer.initialize(this.bundlePath);
            const mapData = this.synchronizer.getDisplayMapData();

            // Build content map for all nodes
            await this.updateContentMap(mapData.nodeData);

            // Register content change listener to update contentMap when files are modified
            this.synchronizer.setOnContentChange((nodeId, hasContent) => {
                this.contentMap.set(nodeId, hasContent);
                this.rerenderMindMap();
            });

            // Create React root and render
            this.renderReactFlow(container, mapData);
        } catch (error) {
            this.containerEl_?.createEl('div', {
                text: `Failed to load MindNote: ${error instanceof Error ? error.message : 'Unknown error'}`,
                cls: 'mindnote-error'
            });
            console.error('MindNote load error:', error);
        }
    }

    /**
     * Re-render the mind map with current data
     */
    public rerenderMindMap(): void {
        if (!this.containerEl_) return;
        const mapContainer = this.containerEl_.querySelector('.mindnote-map') as HTMLElement;
        if (mapContainer) {
            const mapData = this.synchronizer.getDisplayMapData();
            this.renderReactFlow(mapContainer, mapData);
        }
    }

    /**
     * Update content map by checking if each node's markdown has content
     */
    private async updateContentMap(node: MindNode): Promise<void> {
        if (node.filepath) {
            const filePath = normalizePath(`${this.bundlePath}/md/${node.filepath}`);
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                const content = await this.app.vault.read(file);
                this.contentMap.set(node.id, content.trim().length > 0);
            } else {
                this.contentMap.set(node.id, false);
            }
        }
        if (node.children) {
            for (const child of node.children) {
                await this.updateContentMap(child);
            }
        }
    }

    /**
     * Render React Flow component
     */
    private renderReactFlow(container: HTMLElement, mapData: MindMapData): void {
        const { settings } = this.plugin;

        // Create React root if not exists
        if (!this.reactRoot) {
            this.reactRoot = createRoot(container);
        }

        const props: MindMapFlowProps = {
            mapData,
            settings: {
                direction: settings.direction,
                horizontalGap: settings.horizontalGap,
                verticalGap: settings.verticalGap,
                theme: settings.theme,
                lineWidth: settings.lineWidth,
            },
            contentMap: this.contentMap,
            onNodeSelect: this.handleNodeSelect.bind(this),
            onNodeCreate: this.handleNodeCreate.bind(this),
            onNodeDelete: this.handleNodeDelete.bind(this),
            onNodeRename: this.handleNodeRename.bind(this),
            onMapDataChange: this.handleMapDataChange.bind(this),
            onDrop: this.handleDrop.bind(this),
            onPaste: this.handlePaste.bind(this),
            resolveImageUrl: this.resolveImageUrl.bind(this),
        };

        this.reactRoot.render(createElement(MindMapFlow, props));
    }

    /**
     * Resolve relative image path to Obsidian resource URL
     */
    private resolveImageUrl(relativePath: string): string {
        const fullPath = normalizePath(`${this.bundlePath}/${relativePath}`);
        return this.app.vault.adapter.getResourcePath(fullPath);
    }

    /**
     * Handle node selection - open markdown file
     */
    private async handleNodeSelect(node: MindNode): Promise<void> {
        await this.synchronizer.openNodeMarkdown(node, { active: false });
    }

    /**
     * Handle node creation
     */
    private handleNodeCreate(node: MindNode, _parentId: string): void {
        this.synchronizer.onNodeCreated(node);
    }

    /**
     * Handle node deletion
     */
    private handleNodeDelete(node: MindNode): void {
        this.synchronizer.onNodeDeleted(node);
    }

    /**
     * Handle node rename
     */
    private handleNodeRename(node: MindNode, oldTopic: string): void {
        this.synchronizer.onNodeRenamed(node, oldTopic);
    }

    /**
     * Handle map data change - sync to storage
     */
    private async handleMapDataChange(data: MindMapData): Promise<void> {
        this.synchronizer.setMapData(data);
        await this.synchronizer.saveMapState();
    }



    /**
     * Common logic to import files (images/text) as nodes
     */
    private async importFiles(files: File[], targetNodeId: string | null): Promise<void> {
        for (const file of files) {
            try {
                // Determine parent node
                const mapData = this.synchronizer.getMapData();
                let parentNode: MindNode = mapData.nodeData;

                if (targetNodeId) {
                    const findNode = (node: MindNode, id: string): MindNode | null => {
                        if (node.id === id) return node;
                        for (const child of node.children || []) {
                            const found = findNode(child, id);
                            if (found) return found;
                        }
                        return null;
                    };
                    const found = findNode(mapData.nodeData, targetNodeId);
                    if (found) {
                        parentNode = found;
                    }
                }

                let newNode: MindNode;

                if (file.type.startsWith('image/')) {
                    const relativePath = await this.synchronizer.importImage(file);
                    newNode = {
                        id: crypto.randomUUID(),
                        topic: file.name,
                        filepath: '',
                        children: [],
                        expanded: true,
                        isImage: true,
                        imageUrl: relativePath,
                    };
                } else {
                    // For non-image files, maybe create a link or text node? 
                    // Current behavior creates a node with filename.
                    newNode = {
                        id: crypto.randomUUID(),
                        topic: file.name,
                        filepath: '',
                        children: [],
                        expanded: true,
                    };
                }

                // Add to tree
                parentNode.children = [...(parentNode.children || []), newNode];

                // Save
                await this.handleMapDataChange({ nodeData: mapData.nodeData });

                // Trigger creation hooks
                if (!newNode.isImage) {
                    this.synchronizer.onNodeCreated(newNode);
                }

                // Render
                const updatedData = this.synchronizer.getDisplayMapData();
                await this.updateContentMap(updatedData.nodeData);
                this.rerenderMindMap();

                new Notice(`Imported: ${file.name}`);
            } catch (error) {
                new Notice(`Failed to import file: ${error}`);
                console.error(error);
            }
        }
    }

    /**
     * Handle file drop - add dropped files as children of target node
     */
    private async handleDrop(fileList: FileList, targetNodeId: string | null): Promise<void> {
        const files = Array.from(fileList);
        await this.importFiles(files, targetNodeId);
    }

    /**
     * Handle paste - add pasted files as children of target node
     */
    private async handlePaste(files: File[], targetNodeId: string | null): Promise<void> {
        await this.importFiles(files, targetNodeId);
    }
}
