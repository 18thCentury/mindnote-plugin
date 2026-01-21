
import { App, Modal, Setting, Notice, TFolder } from 'obsidian';
import { FILE_EXTENSION_MN } from '../types';

export class CreateNoteModal extends Modal {
    private result: string = '';
    private onSubmit: (result: string) => void;

    constructor(app: App, onSubmit: (result: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        this.result = '';

        contentEl.createEl('h2', { text: 'Create new MindNote' });

        const nameSetting = new Setting(contentEl)
            .setName('Name')
            .setDesc('Enter the name for your new MindNote')
            .addText((text) =>
                text.onChange((value) => {
                    this.result = value;
                })
            );

        // Allow pressing Enter to submit
        nameSetting.controlEl.querySelector('input')?.addEventListener('keypress', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                this.submit();
            }
        });

        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText('Create')
                    .setCta()
                    .onClick(() => {
                        this.submit();
                    })
            )
            .addButton((btn) =>
                btn
                    .setButtonText('Cancel')
                    .onClick(() => {
                        this.close();
                    })
            );
    }

    private submit() {
        if (!this.result || this.result.trim() === '') {
            new Notice('Name cannot be empty');
            return;
        }

        const bundleName = `${this.result}${FILE_EXTENSION_MN}`;
        if (this.app.vault.getAbstractFileByPath(bundleName)) {
            new Notice('A MindNote with this name already exists');
            return;
        }

        this.close();
        this.onSubmit(this.result);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
