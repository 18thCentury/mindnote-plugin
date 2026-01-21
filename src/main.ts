/**
 * MindNote Plugin - Main Entry Point
 */
import { Plugin, WorkspaceLeaf, TFolder, TFile, Menu, Notice } from 'obsidian';
import { MindNoteSettings, DEFAULT_SETTINGS, VIEW_TYPE_MINDNOTE, FILE_EXTENSION_MN, MAP_FILE_NAME } from './types';
import { MindNoteView } from './views/MindNoteView';
import { CreateNoteModal } from './views/CreateNoteModal';
import { MindNoteSettingTab } from './settings/SettingsTab';

export default class MindNotePlugin extends Plugin {
    settings: MindNoteSettings = DEFAULT_SETTINGS;

    async onload(): Promise<void> {
        await this.loadSettings();

        // Register the mindnote view
        this.registerView(
            VIEW_TYPE_MINDNOTE,
            (leaf) => new MindNoteView(leaf, this)
        );

        // Register file extension
        this.registerExtensions([FILE_EXTENSION_MN.slice(1)], VIEW_TYPE_MINDNOTE);

        // Add ribbon icon
        this.addRibbonIcon('brain', 'Create new MindNote', () => {
            this.createNewMindNote();
        });

        // Add command: Create new MindNote
        this.addCommand({
            id: 'create-new',
            name: 'Create new MindNote',
            callback: () => this.createNewMindNote(),
        });

        // Add command: Open as MindNote
        this.addCommand({
            id: 'open-as-mindnote',
            name: 'Open folder as MindNote',
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (file && this.isMindNoteBundle(file.parent)) {
                    if (!checking) {
                        this.openMindNote(file.parent!.path);
                    }
                    return true;
                }
                return false;
            },
        });

        // Register context menu for folders
        this.registerEvent(
            this.app.workspace.on('file-menu', (menu, file) => {
                if (file instanceof TFolder && file.path.endsWith(FILE_EXTENSION_MN)) {
                    menu.addItem((item) => {
                        item
                            .setTitle('Open as MindNote')
                            .setIcon('brain')
                            .onClick(() => this.openMindNote(file.path));
                    });
                }
            })
        );

        // Add settings tab
        this.addSettingTab(new MindNoteSettingTab(this.app, this));
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    /**
     * Check if a folder is a valid MindNote bundle
     */
    isMindNoteBundle(folder: TFolder | null): boolean {
        if (!folder) return false;
        if (!folder.path.endsWith(FILE_EXTENSION_MN)) return false;

        // Check for map.mn file
        const mapFile = this.app.vault.getAbstractFileByPath(`${folder.path}/${MAP_FILE_NAME}`);
        return mapFile instanceof TFile;
    }

    /**
     * Create a new MindNote bundle
     */
    async createNewMindNote(): Promise<void> {
        new CreateNoteModal(this.app, async (name) => {
            await this.createMindNote(name);
        }).open();
    }

    /**
     * Create the MindNote structure with the given name
     */
    async createMindNote(name: string): Promise<void> {
        const basePath = '';  // Root of vault for now

        try {
            const bundlePath = `${basePath}${name}${FILE_EXTENSION_MN}`;

            // Create folder structure
            await this.app.vault.createFolder(bundlePath);
            await this.app.vault.createFolder(`${bundlePath}/md`);
            await this.app.vault.createFolder(`${bundlePath}/img`);
            await this.app.vault.createFolder(`${bundlePath}/file`);

            // Create initial map.mn
            const initialMap = {
                nodeData: {
                    id: this.generateId(),
                    topic: name,
                    filepath: `${name}.md`,
                    children: [],
                    expanded: true,
                },
            };

            await this.app.vault.create(
                `${bundlePath}/${MAP_FILE_NAME}`,
                JSON.stringify(initialMap, null, 2)
            );

            // Create root markdown file
            await this.app.vault.create(`${bundlePath}/md/${name}.md`, '');

            // Open the new mindnote
            await this.openMindNote(bundlePath);

            new Notice(`Created MindNote: ${name}`);
        } catch (error) {
            new Notice(`Failed to create MindNote: ${error}`);
        }
    }

    /**
     * Open an existing MindNote bundle
     */
    async openMindNote(bundlePath: string): Promise<void> {
        const { workspace } = this.app;

        // Check if already open
        const existingLeaves = workspace.getLeavesOfType(VIEW_TYPE_MINDNOTE);
        for (const leaf of existingLeaves) {
            const view = leaf.view as MindNoteView;
            if (view.bundlePath === bundlePath) {
                workspace.setActiveLeaf(leaf, { focus: true });
                return;
            }
        }

        // Open in new leaf
        const leaf = workspace.getLeaf('tab');
        await leaf.setViewState({
            type: VIEW_TYPE_MINDNOTE,
            state: { bundlePath },
        });
        workspace.setActiveLeaf(leaf, { focus: true });
    }

    /**
     * Generate a unique node ID
     */
    generateId(): string {
        return Math.random().toString(16).slice(2, 18);
    }
}
