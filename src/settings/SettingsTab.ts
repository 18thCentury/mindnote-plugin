/**
 * MindNote Settings Tab
 */
import { App, PluginSettingTab, Setting } from 'obsidian';
import type MindNotePlugin from '../main';

export class MindNoteSettingTab extends PluginSettingTab {
    plugin: MindNotePlugin;

    constructor(app: App, plugin: MindNotePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // Files section
        new Setting(containerEl).setName('Files').setHeading();

        new Setting(containerEl)
            .setName('Case sensitive filenames')
            .setDesc('If enabled, "A.md" and "a.md" are treated as different files. Default is strictly case-insensitive to prevent duplicates.')
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.caseSensitiveFilenames)
                    .onChange(async (value) => {
                        this.plugin.settings.caseSensitiveFilenames = value;
                        await this.plugin.saveSettings();
                    })
            );

        // Layout section
        new Setting(containerEl).setName('Layout').setHeading();

        new Setting(containerEl)
            .setName('Direction')
            .setDesc('Direction of node expansion')
            .addDropdown((dropdown) =>
                dropdown
                    .addOption('0', 'Left')
                    .addOption('1', 'Right')
                    .addOption('2', 'Both sides')
                    .setValue(String(this.plugin.settings.direction))
                    .onChange(async (value) => {
                        this.plugin.settings.direction = parseInt(value) as 0 | 1 | 2;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName('Theme')
            .setDesc('Color theme for the mindmap')
            .addDropdown((dropdown) =>
                dropdown
                    .addOption('primary', 'Primary (light)')
                    .addOption('dark', 'Dark')
                    .addOption('auto', 'Follow Obsidian')
                    .setValue(this.plugin.settings.theme)
                    .onChange(async (value) => {
                        this.plugin.settings.theme = value as 'primary' | 'dark' | 'auto';
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName('Compact layout')
            .setDesc('Reduce spacing between nodes for a denser view')
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.compact)
                    .onChange(async (value) => {
                        this.plugin.settings.compact = value;
                        await this.plugin.saveSettings();
                    })
            );

        // Spacing section
        new Setting(containerEl).setName('Spacing').setHeading();

        new Setting(containerEl)
            .setName('Horizontal gap')
            .setDesc('Distance between parent and child nodes')
            .addSlider((slider) =>
                slider
                    .setLimits(5, 50, 1)
                    .setValue(this.plugin.settings.horizontalGap)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.horizontalGap = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName('Vertical gap')
            .setDesc('Distance between sibling nodes')
            .addSlider((slider) =>
                slider
                    .setLimits(2, 30, 1)
                    .setValue(this.plugin.settings.verticalGap)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.verticalGap = value;
                        await this.plugin.saveSettings();
                    })
            );

        // Appearance section
        new Setting(containerEl).setName('Appearance').setHeading();

        new Setting(containerEl)
            .setName('Node padding')
            .setDesc('Internal padding of nodes')
            .addSlider((slider) =>
                slider
                    .setLimits(2, 20, 1)
                    .setValue(this.plugin.settings.topicPadding)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.topicPadding = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName('Node radius')
            .setDesc('Border radius for child nodes')
            .addSlider((slider) =>
                slider
                    .setLimits(0, 15, 1)
                    .setValue(this.plugin.settings.nodeRadius)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.nodeRadius = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName('Line width')
            .setDesc('Thickness of connecting lines')
            .addSlider((slider) =>
                slider
                    .setLimits(1, 5, 1)
                    .setValue(this.plugin.settings.lineWidth)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.lineWidth = value;
                        await this.plugin.saveSettings();
                    })
            );
    }
}
