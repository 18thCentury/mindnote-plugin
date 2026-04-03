/**
 * FileSystemManager Unit Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFolder } from 'obsidian';
import { FileSystemManager } from '../../src/core/FileSystemManager';

// Mock App
const createMockApp = () => ({
    vault: {
        process: vi.fn(),
        read: vi.fn(),
        create: vi.fn(),
        createFolder: vi.fn(),
        createBinary: vi.fn(),
        modify: vi.fn(),
        delete: vi.fn(),
        getAbstractFileByPath: vi.fn(),
    },
    fileManager: {
        renameFile: vi.fn(),
        trashFile: vi.fn(),
    },
});

describe('FileSystemManager', () => {
    let fsm: FileSystemManager;
    let mockApp: ReturnType<typeof createMockApp>;

    beforeEach(() => {
        mockApp = createMockApp();
        fsm = new FileSystemManager(mockApp as any, () => ({ caseSensitiveFilenames: true } as any));
    });

    describe('sanitizeFilename', () => {
        it('should replace all illegal characters with underscore', () => {
            const result = fsm.sanitizeFilename('test:file<name>?.md');
            expect(result).toBe('test_file_name__.md');
        });

        it('should preserve valid characters', () => {
            const result = fsm.sanitizeFilename('valid-file_name 123.md');
            expect(result).toBe('valid-file_name 123.md');
        });

        it('should handle empty string', () => {
            const result = fsm.sanitizeFilename('');
            expect(result).toBe('');
        });

        it('should trim whitespace', () => {
            const result = fsm.sanitizeFilename('  test  ');
            expect(result).toBe('test');
        });

        it('should replace backslash', () => {
            const result = fsm.sanitizeFilename('path\\to\\file');
            expect(result).toBe('path_to_file');
        });

        it('should replace forward slash', () => {
            const result = fsm.sanitizeFilename('path/to/file');
            expect(result).toBe('path_to_file');
        });
    });

    describe('generateSafeName', () => {
        it('should return sanitized name when no conflict', () => {
            mockApp.vault.getAbstractFileByPath.mockReturnValue(null);

            const result = fsm.generateSafeName('test', 'folder');
            expect(result).toBe('test');
        });

        it('should append _1 when file exists', () => {
            mockApp.vault.getAbstractFileByPath
                .mockReturnValueOnce({ path: 'folder/test.md' }) // test.md exists
                .mockReturnValue(null); // test_1.md doesn't exist

            const result = fsm.generateSafeName('test', 'folder');
            expect(result).toBe('test_1');
        });

        it('should increment counter for multiple conflicts', () => {
            mockApp.vault.getAbstractFileByPath
                .mockReturnValueOnce({ path: 'folder/test.md' })
                .mockReturnValueOnce({ path: 'folder/test_1.md' })
                .mockReturnValueOnce({ path: 'folder/test_2.md' })
                .mockReturnValue(null);

            const result = fsm.generateSafeName('test', 'folder');
            expect(result).toBe('test_3');
        });

        it('should sanitize before checking', () => {
            mockApp.vault.getAbstractFileByPath.mockReturnValue(null);

            const result = fsm.generateSafeName('test:file', 'folder');
            expect(result).toBe('test_file');
        });
        it('should ignore duplicate if path matches ignoredPath', () => {
            // Mock that folder/test.md exists
            mockApp.vault.getAbstractFileByPath.mockReturnValue({ path: 'folder/test.md' });

            // Should NOT return test_1, but test because we ignore 'folder/test.md'
            const result = fsm.generateSafeName('test', 'folder', 'folder/test.md');
            expect(result).toBe('test');
        });

        it('should NOT ignore duplicate if path matches ignoredPath but we want a new name', () => {
            // Case where we rename "test.md" to "test_1.md" but "test_1.md" already exists
            mockApp.vault.getAbstractFileByPath
                .mockReturnValueOnce({ path: 'folder/test_1.md' }) // test_1 exists
                .mockReturnValue(null);

            // We are renaming "folder/test.md" (ignoredPath) to "test_1"
            const result = fsm.generateSafeName('test_1', 'folder', 'folder/test.md');
            // test_1 exists and is NOT the ignored path. So it should be test_1_1 or similar?
            // Wait, existing check is candidatePath.
            // baseName = test_1. Candidate = test_1. CandidatePath = folder/test_1.md.
            // ignoredPath = folder/test.md. Mismatch.
            // So test_1.md is a conflict.
            // Next candidate: test_1_1.
            expect(result).toBe('test_1_1');
        });
    });

    describe('exists', () => {
        it('should return true when file exists', () => {
            mockApp.vault.getAbstractFileByPath.mockReturnValue({ path: 'test.md' });

            expect(fsm.exists('test.md')).toBe(true);
        });

        it('should return false when file does not exist', () => {
            mockApp.vault.getAbstractFileByPath.mockReturnValue(null);

            expect(fsm.exists('nonexistent.md')).toBe(false);
        });
    });

    describe('atomicWrite', () => {
        it('should call vault.process with correct arguments', async () => {
            const mockFile = { path: 'test.md' };
            const transform = (content: string) => content + ' modified';

            await fsm.atomicWrite(mockFile as any, transform);

            expect(mockApp.vault.process).toHaveBeenCalledWith(mockFile, transform);
        });
    });

    describe('deleteFile', () => {
        it('should use fileManager.trashFile for deletion', async () => {
            const mockFile = { path: 'test.md' };

            await fsm.deleteFile(mockFile as any);

            expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(mockFile);
        });
    });


    describe('saveImage and saveResource', () => {
        it('should save image under img folder and return relative path', async () => {
            const imgFolder = new TFolder();
            imgFolder.path = 'bundle.mn/img';
            mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => path === 'bundle.mn/img' ? imgFolder : null);

            const data = new ArrayBuffer(8);
            const result = await fsm.saveImage('bundle.mn', data, 'photo.png');

            expect(mockApp.vault.createFolder).not.toHaveBeenCalled();
            expect(mockApp.vault.createBinary).toHaveBeenCalledWith('bundle.mn/img/photo.png', data);
            expect(result).toBe('img/photo.png');
        });

        it('should save generic resource under file folder and return relative path', async () => {
            const fileFolder = new TFolder();
            fileFolder.path = 'bundle.mn/file';
            mockApp.vault.getAbstractFileByPath.mockImplementation((path: string) => path === 'bundle.mn/file' ? fileFolder : null);

            const data = new ArrayBuffer(8);
            const result = await fsm.saveResource('bundle.mn', data, 'doc.pdf');

            expect(mockApp.vault.createFolder).not.toHaveBeenCalled();
            expect(mockApp.vault.createBinary).toHaveBeenCalledWith('bundle.mn/file/doc.pdf', data);
            expect(result).toBe('file/doc.pdf');
        });
    });

    describe('createFile', () => {
        it('should create file with content', async () => {
            mockApp.vault.create.mockResolvedValue({ path: 'test.md' });

            await fsm.createFile('test.md', 'content');

            expect(mockApp.vault.create).toHaveBeenCalledWith('test.md', 'content');
        });

        it('should create empty file when no content provided', async () => {
            mockApp.vault.create.mockResolvedValue({ path: 'test.md' });

            await fsm.createFile('test.md');

            expect(mockApp.vault.create).toHaveBeenCalledWith('test.md', '');
        });
    });
});
