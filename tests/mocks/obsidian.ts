/**
 * Mock Obsidian Module
 * Provides mock implementations of Obsidian API for testing
 */

// ============================================================================
// Base Classes
// ============================================================================

export class App {
    vault = new Vault();
    workspace = new Workspace();
    fileManager = new FileManager();
    metadataCache = new MetadataCache();
}

export class Plugin {
    app: App;
    manifest: PluginManifest;

    constructor(app: App, manifest: PluginManifest) {
        this.app = app;
        this.manifest = manifest;
    }

    loadData(): Promise<unknown> { return Promise.resolve({}); }
    saveData(_data: unknown): Promise<void> { return Promise.resolve(); }
    addCommand(_command: unknown): void { }
    addRibbonIcon(_icon: string, _title: string, _callback: () => void): void { }
    addSettingTab(_tab: unknown): void { }
    registerView(_type: string, _viewCreator: unknown): void { }
    registerExtensions(_extensions: string[], _viewType: string): void { }
    registerEvent(_event: unknown): void { }
}

export interface PluginManifest {
    id: string;
    name: string;
    version: string;
}

export class PluginSettingTab {
    app: App;
    containerEl: HTMLElement;

    constructor(app: App, _plugin: Plugin) {
        this.app = app;
        this.containerEl = document.createElement('div');
    }

    display(): void { }
    hide(): void { }
}

// ============================================================================
// File System
// ============================================================================

export class TAbstractFile {
    path: string = '';
    name: string = '';
    parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
    extension: string = 'md';
    basename: string = '';

    constructor(path: string = '') {
        super();
        this.path = path;
        this.name = path.split('/').pop() || '';
        this.basename = this.name.replace(/\.[^.]+$/, '');
        this.extension = this.name.split('.').pop() || '';
    }
}

export class TFolder extends TAbstractFile {
    children: TAbstractFile[] = [];

    constructor(path: string = '') {
        super();
        this.path = path;
        this.name = path.split('/').pop() || '';
    }
}

export class Vault {
    private files: Map<string, TAbstractFile> = new Map();
    on(_event: string, _callback: (...args: unknown[]) => void): EventRef { return {} as EventRef; }
    offref(_ref: EventRef): void { }

    getAbstractFileByPath(path: string): TAbstractFile | null {
        return this.files.get(path) || null;
    }

    async read(_file: TFile): Promise<string> {
        return '';
    }

    async readBinary(_file: TFile): Promise<ArrayBuffer> {
        return new ArrayBuffer(0);
    }

    async create(path: string, content: string): Promise<TFile> {
        const file = new TFile(path);
        this.files.set(path, file);
        return file;
    }

    async createBinary(path: string, _data: ArrayBuffer): Promise<TFile> {
        const file = new TFile(path);
        this.files.set(path, file);
        return file;
    }

    async createFolder(path: string): Promise<void> {
        const folder = new TFolder(path);
        this.files.set(path, folder);
    }

    async modify(_file: TFile, _content: string): Promise<void> { }

    async delete(_file: TAbstractFile): Promise<void> { }

    async process(_file: TFile, fn: (content: string) => string): Promise<void> {
        fn('');
    }
}

export class Workspace {
    getActiveFile(): TFile | null { return null; }
    getActiveViewOfType<T>(_type: unknown): T | null { return null; }
    getLeaf(_type?: string): WorkspaceLeaf { return new WorkspaceLeaf(); }
    getLeavesOfType(_type: string): WorkspaceLeaf[] { return []; }
    on(_event: string, _callback: (...args: unknown[]) => void): EventRef { return {} as EventRef; }
    setActiveLeaf(_leaf: WorkspaceLeaf, _options?: unknown): void { }
}

export class WorkspaceLeaf {
    view: unknown;
    async openFile(_file: TFile): Promise<void> { }
    async setViewState(_state: unknown): Promise<void> { }
}

export class FileManager {
    async renameFile(_file: TFile, _newPath: string): Promise<void> { }
    async trashFile(_file: TFile): Promise<void> { }
}

export class MetadataCache {
    getFileCache(_file: TFile): CachedMetadata | null { return null; }
    getCache(_path: string): CachedMetadata | null { return null; }
}

export interface CachedMetadata {
    embeds?: EmbedCache[];
    links?: LinkCache[];
}

export interface EmbedCache {
    link: string;
    displayText?: string;
}

export interface LinkCache {
    link: string;
    displayText?: string;
}

export interface EventRef { }

// ============================================================================
// UI Components
// ============================================================================

export class ItemView {
    app: App;
    containerEl: HTMLElement;
    leaf: WorkspaceLeaf;

    constructor(leaf: WorkspaceLeaf) {
        this.leaf = leaf;
        this.app = new App();
        this.containerEl = document.createElement('div');
    }

    getViewType(): string { return ''; }
    getDisplayText(): string { return ''; }
    getIcon(): string { return ''; }
    async onOpen(): Promise<void> { }
    async onClose(): Promise<void> { }
    async setState(_state: unknown, _result: unknown): Promise<void> { }
    getState(): unknown { return {}; }
}

export class Modal {
    app: App;
    containerEl: HTMLElement;

    constructor(app: App) {
        this.app = app;
        this.containerEl = document.createElement('div');
    }

    open(): void { }
    close(): void { }
}

export class Setting {
    constructor(_containerEl: HTMLElement) { }

    setName(_name: string): this { return this; }
    setDesc(_desc: string): this { return this; }
    setHeading(): this { return this; }
    addDropdown(_cb: (dropdown: unknown) => void): this { return this; }
    addSlider(_cb: (slider: unknown) => void): this { return this; }
    addText(_cb: (text: unknown) => void): this { return this; }
    addToggle(_cb: (toggle: unknown) => void): this { return this; }
}

export class Notice {
    constructor(_message: string, _timeout?: number) { }
}

// ============================================================================
// Utility Functions
// ============================================================================

export function normalizePath(path: string): string {
    return path
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/')
        .replace(/^\//, '')
        .replace(/\/$/, '');
}

export function debounce(func: Function, wait: number, immediate: boolean = false) {
    let timeout: any;
    return function (this: any, ...args: any[]) {
        const context = this;
        const later = function () {
            timeout = null;
            if (!immediate) func.apply(context, args);
        };
        const callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func.apply(context, args);
    };
}

// ============================================================================
// Platform
// ============================================================================

export const Platform = {
    isMacOS: false,
    isWin: true,
    isLinux: false,
    isMobile: false,
    isDesktop: true,
    isDesktopApp: true,
    isIosApp: false,
    isAndroidApp: false,
};
