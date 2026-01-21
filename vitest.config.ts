import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            include: ['src/**/*.ts'],
            exclude: ['src/main.ts', 'src/types/**'],
            thresholds: {
                lines: 80,
                functions: 80,
                branches: 70,
                statements: 80,
            },
        },
        setupFiles: ['tests/setup.ts'],
        deps: {
            // Mock external modules that can't be resolved in Node
            inline: ['obsidian'],
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            // Mock obsidian module
            'obsidian': path.resolve(__dirname, './tests/mocks/obsidian.ts'),
        },
    },
});
