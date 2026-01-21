/**
 * MindNote View
 * Main view for displaying and interacting with the mindmap
 */
import { ItemView, WorkspaceLeaf, TFile, Notice, normalizePath, Menu } from 'obsidian';
import MindElixir from 'mind-elixir';
import type MindNotePlugin from '../main';
import { VIEW_TYPE_MINDNOTE, MindMapData, MindNode, MAP_FILE_NAME, FILE_EXTENSION_MN } from '../types';
import { FileSystemManager, TransactionManager, StateSynchronizer } from '../core';

export class MindNoteView extends ItemView {
    plugin: MindNotePlugin;
    bundlePath: string = '';
    bundleName: string = '';
    private mindElixir: any = null;
    private containerEl_: HTMLElement | null = null;

    // Core Modules
    private fsm: FileSystemManager;
    private txManager: TransactionManager;
    private synchronizer: StateSynchronizer;

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
        if (this.mindElixir) {
            // Synchronizer handles persistence via queue flush
            await this.synchronizer.flush();
        }
        this.synchronizer.dispose();
        this.mindElixir = null;
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
            // Use display data which has resolved image URLs
            const mapData = this.synchronizer.getDisplayMapData();

            this.initMindElixir(container, mapData);
        } catch (error) {
            this.containerEl_?.createEl('div', {
                text: `Failed to load MindNote: ${error instanceof Error ? error.message : 'Unknown error'}`,
                cls: 'mindnote-error'
            });
            console.error('MindNote load error:', error);
        }
    }

    /**
     * Initialize mind-elixir with map data
     */
    private initMindElixir(container: HTMLElement, mapData: MindMapData): void {
        const { settings } = this.plugin;

        // Apply theme
        let theme: 'primary' | 'dark' = 'primary';
        if (settings.theme === 'dark') {
            theme = 'dark';
        } else if (settings.theme === 'auto') {
            theme = document.body.classList.contains('theme-dark') ? 'dark' : 'primary';
        }

        // Apply spacing and appearance settings as CSS custom properties
        // Uses mind-elixir's expected variable names for gaps
        container.style.setProperty('--node-gap-x', `${settings.horizontalGap}px`);
        container.style.setProperty('--node-gap-y', `${settings.verticalGap}px`);
        container.style.setProperty('--main-gap-x', `${settings.mainHorizontalGap}px`);
        container.style.setProperty('--main-gap-y', `${settings.mainVerticalGap}px`);
        container.style.setProperty('--topic-padding', `${settings.topicPadding}px`);
        container.style.setProperty('--main-radius', `${settings.nodeRadius}px`);
        container.style.setProperty('--root-radius', `${settings.rootRadius}px`);

        this.mindElixir = new MindElixir({
            el: container,
            direction: settings.direction,
            draggable: true,
            contextMenu: true,
            toolBar: true,
            nodeMenu: true,
            keypress: true,
            // theme: MindElixir.theme[theme],
        });

        this.mindElixir.init(mapData);

        // Register event handlers
        this.registerMindElixirEvents();

        // Handle window resize
        this.registerDomEvent(window, 'resize', () => {
            this.mindElixir?.layout();
        });

        // Handle Paste
        this.registerDomEvent(container, 'paste', (e: ClipboardEvent) => {
            this.handlePaste(e);
        });

        // Handle Drop
        this.registerDomEvent(container, 'dragover', (e: DragEvent) => {
            e.preventDefault(); // Necessary to allow dropping
        });

        this.registerDomEvent(container, 'drop', (e: DragEvent) => {
            this.handleDrop(e);
        });
    }

    /**
     * Register mind-elixir event handlers
     */
    private registerMindElixirEvents(): void {
        if (!this.mindElixir) return;

        this.mindElixir.bus.addListener('selectNode', async (node: MindNode) => {
            await this.synchronizer.openNodeMarkdown(node, { active: false });
        });



        // Handle structural operations
        this.mindElixir.bus.addListener('operation', (operation: any) => {
            this.handleOperation(operation);
        });
    }

    /**
     * Handle operations from mind-elixir and sync to core
     */
    private async handleOperation(operation: { name: string; obj: any }): Promise<void> {
        const { name, obj } = operation;
        console.log(`MindNote: Operation '${name}'`, obj);

        // Capture authoritative node data BEFORE updating state for deletion
        // We need this because setMapData below will remove the node from checking the state
        let nodeToDelete: MindNode | null = null;
        if (name === 'removeNode' && obj && obj.id) {
            try {
                // Get current state before it's updated
                const currentMapData = this.synchronizer.getMapData();
                const authoritativeNode = this.findNodeById(currentMapData.nodeData, obj.id);
                console.log('MindNote: Authoritative node found:', authoritativeNode);
                // Create a copy to ensure it doesn't get mutated/lost
                if (authoritativeNode) {
                    // We can use the reference directly since setMapData replaces the entire state
                    nodeToDelete = authoritativeNode;
                    console.log('MindNote: Node to delete determined:', nodeToDelete);
                } else {
                    console.warn('MindNote: Could not find authoritative node for ID:', obj.id);
                }
            } catch (e) {
                console.error('Failed to find node to delete:', e);
            }
        }

        // Sync map data first
        if (this.mindElixir) {
            const data = this.mindElixir.getData();
            console.log('MindNote: Current Data from Elixir:', JSON.stringify(data));
            this.synchronizer.setMapData(data);
        }

        // Map mind-elixir operations to synchronizer actions
        switch (name) {
            case 'addChild':
                // obj is the new node
                if (obj) this.synchronizer.onNodeCreated(obj);
                break;

            case 'removeNode':
                // obj is the removed node (from UI), but we prefer the authoritative one with filepath
                const node = nodeToDelete || obj;
                if (node) this.synchronizer.onNodeDeleted(node);
                break;

            case 'finishEdit':
                // obj is the edited node
                if (obj && obj.id) {
                    // Find authoritative node (with filepath) from synchronizer state
                    try {
                        const mapData = this.synchronizer.getMapData();
                        const authoritativeNode = this.findNodeById(mapData.nodeData, obj.id);

                        if (authoritativeNode) {
                            // Pass '' as oldTopic since it's unused by the rename logic (it relies on node.filepath)
                            this.synchronizer.onNodeRenamed(authoritativeNode, '');
                        }
                    } catch (e) {
                        console.error('Failed to sync rename:', e);
                    }
                }
                break;

            case 'moveNode':
                // obj: { node, oldParent, newParent }
                // this.synchronizer.onNodeMoved(...)
                break;
        }

        // Always save the map structure changes
        await this.synchronizer.saveMapState();
    }

    /**
     * Handle paste events
     */
    private async handlePaste(e: ClipboardEvent): Promise<void> {
        const files = e.clipboardData?.files;
        if (files && files.length > 0) {
            e.preventDefault();
            await this.processDroppedFiles(files);
        }
    }

    /**
     * Handle drop events
     */
    private async handleDrop(e: DragEvent): Promise<void> {
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            e.preventDefault();
            await this.processDroppedFiles(files);
        }
    }

    /**
     * Process dropped/pasted files
     */
    private async processDroppedFiles(files: FileList): Promise<void> {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                // Returns relative path (e.g. "img/foo.png" or "file/bar.pdf")
                const relativePath = await this.synchronizer.importImage(file);

                let newNode: MindNode;

                if (file.type.startsWith('image/')) {
                    // Create image node
                    const resourcePath = this.app.vault.adapter.getResourcePath(normalizePath(`${this.bundlePath}/${relativePath}`));

                    newNode = {
                        id: crypto.randomUUID(),
                        topic: `<img src="${resourcePath}" style="max-width:300px; border-radius: 4px;" />`,
                        filepath: '', // synchronizer will generate md file
                        children: [],
                        expanded: true,
                        isImage: true,
                        imageUrl: relativePath,
                    };
                } else {
                    // Create regular node for other files
                    newNode = {
                        id: crypto.randomUUID(),
                        topic: file.name,
                        filepath: '', // synchronizer will generate md file
                        children: [],
                        expanded: true
                    };
                    // Note: We might want to inject the file link into the generated markdown file
                    // but standard 'create' op creates empty file. 
                    // Future todo: allow pre-populating content.
                }

                const selectedNode = this.mindElixir.currentNode;

                if (selectedNode) {
                    this.mindElixir.addChild(selectedNode, newNode);
                } else {
                    const root = this.mindElixir.getData().nodeData;
                    this.mindElixir.addChild(root, newNode);
                }
            } catch (error) {
                new Notice(`Failed to import file: ${error}`);
            }
        }
    }

    /**
     * Helper to find a node by ID in a tree
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
}
