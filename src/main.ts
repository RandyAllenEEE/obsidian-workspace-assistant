import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { AssistantSettings, normalizeSettings } from './settings';
import { FoldersManager } from './folders/manager';
import { renderFoldersSettings } from './folders/settings-ui';
import { StatusBarManager } from './statusbar/manager';
import { renderStatusBarSettings } from './statusbar/settings-ui';
import { PluginsManager } from './plugins/manager';
import { renderPluginsSettings } from './plugins/settings-ui';
import { SnippetsManager } from './snippets/manager';
import { renderSnippetsSettings } from './snippets/settings-ui';
import { t } from './i18n/helpers';

import { SidebarManager } from './sidebar/manager';
import { renderSidebarSettings } from './sidebar/settings-ui';

import { createSettingsList } from './settings-list';

export default class AssistantPlugin extends Plugin {
    settings: AssistantSettings;
    foldersManager: FoldersManager;
    pluginsManager: PluginsManager;
    statusBarManager: StatusBarManager;
    snippetsManager: SnippetsManager;
    sidebarManager: SidebarManager;

    async onload() {
        console.log(t('Loading Workspace Assistant...'));
        console.log(t('Loading Settings...'));
        await this.loadSettings();

        // Initialize Managers
        this.foldersManager = new FoldersManager(this.app, this);
        this.pluginsManager = new PluginsManager(this.app, this);
        this.statusBarManager = new StatusBarManager(this.app, this);
        this.snippetsManager = new SnippetsManager(this.app, this);
        this.sidebarManager = new SidebarManager(this.app, this);

        // Load modules if enabled
        if (this.settings.myFolders.enabled) await this.foldersManager.onload();
        if (this.settings.myPlugins.enabled) await this.pluginsManager.onload();
        if (this.settings.myStatusBar.enabled) await this.statusBarManager.onload();
        if (this.settings.mySnippets.enabled) await this.snippetsManager.onload();
        if (this.settings.mySideBar.enabled) await this.sidebarManager.onload();

        // --- Centralized Command Registration ---

        // Folders
        this.addCommand({
            id: "toggle-attachment-folders",
            name: t('Toggle visibility of hidden folders'),
            callback: () => {
                if (this.settings.myFolders.enabled) this.foldersManager.toggleFunctionality();
            },
        });

        // Snippets
        this.addCommand({
            id: `open-snippets-menu`,
            name: t(`Open snippets in status bar`),
            icon: `pantone-line`,
            callback: async () => {
                if (this.settings.mySnippets.enabled) this.snippetsManager.openMenu();
            },
        });
        this.addCommand({
            id: `open-snippets-create`,
            name: t(`Create new CSS snippet`),
            icon: `ms-css-file`,
            callback: async () => {
                if (this.settings.mySnippets.enabled) this.snippetsManager.openCreateModal();
            },
        });



        this.addSettingTab(new AssistantSettingsTab(this.app, this));
    }

    onunload() {
        console.log(t('Unloading Workspace Assistant...'));
        this.foldersManager?.onunload();
        this.pluginsManager?.onunload();
        this.statusBarManager?.onunload();
        this.snippetsManager?.onunload();
        this.sidebarManager?.onunload();
    }

    async loadSettings() {
        const loadedData = await this.loadData();
        this.settings = normalizeSettings(loadedData);

        // Save cleaned settings to disk immediately
        await this.saveSettings();
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

}

class AssistantSettingsTab extends PluginSettingTab {
    plugin: AssistantPlugin;

    constructor(app: App, plugin: AssistantPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();
        containerEl.addClass('workspace-assistant-settings');

        // MyFolders Section
        this.addPluginSection(
            containerEl,
            t('My Folders'),
            this.plugin.settings.myFolders.enabled,
            async (value) => {
                this.plugin.settings.myFolders.enabled = value;
                await this.plugin.saveSettings();
                if (value) {
                    this.plugin.foldersManager.onload();
                } else {
                    this.plugin.foldersManager.onunload();
                }
            },
            (el) => {
                renderFoldersSettings(el, this.plugin.foldersManager);
            }
        );

        // MyPlugins Section
        this.addPluginSection(
            containerEl,
            t('My Plugins'),
            this.plugin.settings.myPlugins.enabled,
            async (value) => {
                this.plugin.settings.myPlugins.enabled = value;
                await this.plugin.saveSettings();
                if (value) {
                    this.plugin.pluginsManager.onload();
                } else {
                    this.plugin.pluginsManager.onunload();
                }
            },
            (el) => {
                renderPluginsSettings(el, this.plugin.pluginsManager);
            }
        );

        // MyStatusBar Section
        this.addPluginSection(
            containerEl,
            t('My Status Bar'),
            this.plugin.settings.myStatusBar.enabled,
            async (value) => {
                this.plugin.settings.myStatusBar.enabled = value;
                await this.plugin.saveSettings();
                if (value) {
                    this.plugin.statusBarManager.onload();
                } else {
                    this.plugin.statusBarManager.onunload();
                }
            },
            (el) => {
                renderStatusBarSettings(el, this.plugin.statusBarManager);
            }
        );

        // MySnippets Section
        this.addPluginSection(
            containerEl,
            t('My Snippets'),
            this.plugin.settings.mySnippets.enabled,
            async (value) => {
                this.plugin.settings.mySnippets.enabled = value;
                await this.plugin.saveSettings();
                if (value) {
                    this.plugin.snippetsManager.onload();
                } else {
                    this.plugin.snippetsManager.onunload();
                }
            },
            (el) => {
                renderSnippetsSettings(el, this.plugin.snippetsManager);
            }
        );



        // MySideBar Section
        this.addPluginSection(
            containerEl,
            t('My SideBar'),
            this.plugin.settings.mySideBar.enabled,
            async (value) => {
                this.plugin.settings.mySideBar.enabled = value;
                await this.plugin.saveSettings();
                if (value) {
                    this.plugin.sidebarManager.onload();
                } else {
                    this.plugin.sidebarManager.onunload();
                }
            },
            (el) => {
                renderSidebarSettings(el, this.plugin.sidebarManager);
            }
        );
    }

    addPluginSection(
        containerEl: HTMLElement,
        title: string,
        isEnabled: boolean,
        onToggle: (val: boolean) => void,
        renderBody: (el: HTMLElement) => void
    ) {
        const details = createSettingsList(containerEl).createEl('details', { cls: 'assistant-module-frame' });
        details.open = false;

        const summary = details.createEl('summary', { cls: 'assistant-settings-section-header' });

        const titleContainer = summary.createEl('div', { cls: 'settings-section-title' });
        titleContainer.createEl('strong', { text: title });

        // Toggle Switch Container
        const toggleContainer = summary.createEl('div');
        toggleContainer.onclick = (e) => e.stopPropagation();

        const toggleSetting = new Setting(toggleContainer)
            .addToggle(toggle => toggle
                .setValue(isEnabled)
                .onChange(onToggle));
        // Remove default setting padding/border to fit in header
        toggleSetting.settingEl.style.border = 'none';
        toggleSetting.settingEl.style.padding = '0';
        toggleSetting.infoEl.remove(); // Remove empty info

        const content = details.createEl('div');

        if (isEnabled) {
            renderBody(content);
        } else {
            content.createEl('i', { text: t('Feature is disabled.') });
        }
    }
}
