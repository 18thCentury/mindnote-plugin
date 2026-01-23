import esbuild from 'esbuild';
import process from 'process';
import builtins from 'builtin-modules';
import fs from 'fs';

const banner = `/*
MindNote - Obsidian Plugin
Organize vault files using mindmap nodes
*/`;

const prod = process.argv[2] === 'production';

// Plugin to inject CSS into JS and remove extracted main.css
const injectCssPlugin = {
    name: 'inject-css',
    setup(build) {
        build.onEnd(async () => {
            // Check if main.css was generated, append to styles.css
            if (fs.existsSync('main.css')) {
                const reactFlowCss = fs.readFileSync('main.css', 'utf8');
                const existingStyles = fs.existsSync('styles.css')
                    ? fs.readFileSync('styles.css', 'utf8')
                    : '';

                // Only append if not already included
                if (!existingStyles.includes('.react-flow{')) {
                    const combined = existingStyles + '\n\n/* React Flow Styles */\n' + reactFlowCss;
                    fs.writeFileSync('styles.css', combined);
                    console.log('  → Merged React Flow CSS into styles.css');
                }

                // Remove main.css
                fs.unlinkSync('main.css');
                console.log('  → Removed main.css');
            }
        });
    }
};

const context = await esbuild.context({
    banner: { js: banner },
    entryPoints: ['src/main.ts'],
    bundle: true,
    loader: { '.tsx': 'tsx', '.ts': 'ts' },
    jsx: 'automatic',
    plugins: [injectCssPlugin],
    external: [
        'obsidian',
        'electron',
        '@codemirror/autocomplete',
        '@codemirror/collab',
        '@codemirror/commands',
        '@codemirror/language',
        '@codemirror/lint',
        '@codemirror/search',
        '@codemirror/state',
        '@codemirror/view',
        '@lezer/common',
        '@lezer/highlight',
        '@lezer/lr',
        ...builtins,
    ],
    format: 'cjs',
    target: 'es2020',
    logLevel: 'info',
    sourcemap: prod ? false : 'inline',
    treeShaking: true,
    outfile: 'main.js',
    minify: prod,
});

if (prod) {
    await context.rebuild();
    process.exit(0);
} else {
    await context.watch();
}
