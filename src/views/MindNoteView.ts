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
        this.fsm = new FileSystemManager(this.app);
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
            },
            contentMap: this.contentMap,
            onNodeSelect: this.handleNodeSelect.bind(this),
            onNodeCreate: this.handleNodeCreate.bind(this),
            onNodeDelete: this.handleNodeDelete.bind(this),
            onNodeRename: this.handleNodeRename.bind(this),
            onMapDataChange: this.handleMapDataChange.bind(this),
            onDrop: this.handleDrop.bind(this),
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
     * Handle file drop
     */
    private async handleDrop(files: FileList): Promise<void> {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                const relativePath = await this.synchronizer.importImage(file);

                // Get current map data and find selected node
                const mapData = this.synchronizer.getMapData();
                const selectedNode = mapData.nodeData; // Default to root if no selection

                let newNode: MindNode;

                if (file.type.startsWith('image/')) {
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
                    newNode = {
                        id: crypto.randomUUID(),
                        topic: file.name,
                        filepath: '',
                        children: [],
                        expanded: true,
                    };
                }

                // Add as child of current selection (default to root)
                this.synchronizer.onNodeCreated(newNode);

                // Re-render with updated data
                const updatedData = this.synchronizer.getDisplayMapData();
                await this.updateContentMap(updatedData.nodeData);

                if (this.containerEl_) {
                    const mapContainer = this.containerEl_.querySelector('.mindnote-map') as HTMLElement;
                    if (mapContainer) {
                        this.renderReactFlow(mapContainer, updatedData);
                    }
                }

                new Notice(`Imported: ${file.name}`);
            } catch (error) {
                new Notice(`Failed to import file: ${error}`);
            }
        }
    }
}
