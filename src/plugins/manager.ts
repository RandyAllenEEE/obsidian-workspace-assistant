import { App, Platform, PluginManifest } from 'obsidian';
import AssistantPlugin from '../main';
import { DeviceSettings, isLoadingMethod, LoadingMethod, MyPluginsSettings } from '../settings';
import { t } from "../i18n/helpers";
import { LifecycleScope } from "../utils/lifecycle";

type ObsidianPluginManager = {
    enabledPlugins: Set<string>;
    manifests: Record<string, PluginManifest>;
    plugins?: Record<string, { _loaded?: boolean }>;
    disablePluginAndSave(pluginId: string): Promise<void>;
    enablePluginAndSave(pluginId: string): Promise<void>;
    enablePlugin(pluginId: string): Promise<void>;
};

export class PluginsManager {
    app: App;
    plugin: AssistantPlugin;
    manifests: PluginManifest[] = [];
    pendingTimeouts = new Map<string, number>();
    device = 'desktop/global';
    private scope = new LifecycleScope();
    private isLoaded = false;
    private startupOperationCounter = 0;
    private startupOperations = new Map<string, number>();

    constructor(app: App, plugin: AssistantPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    get settings(): MyPluginsSettings {
        return this.plugin.settings.myPlugins;
    }

    get deviceSettings(): DeviceSettings {
        if (this.settings.dualConfigs && Platform.isMobile) {
            return this.settings.mobile || this.settings.desktop;
        }
        return this.settings.desktop;
    }

    async onload() {
        if (this.isLoaded || !this.settings.enabled) return;
        this.isLoaded = true;
        this.scope.reset();

        await this.refreshDeviceConfiguration();
        if (!this.isLoaded) return;

        // Iterate over the installed plugins and load them with the specified delay
        this.manifests.forEach(plugin => {
            void this.setPluginStartup(plugin.id);
        });
    }

    async refreshDeviceConfiguration() {
        let changed = false;

        if (this.settings.dualConfigs && Platform.isMobile) {
            if (!this.settings.mobile) {
                this.settings.mobile = JSON.parse(JSON.stringify(this.settings.desktop));
                changed = true;
            }
            this.device = 'mobile';
        } else {
            this.device = 'desktop/global';
        }

        this.updateManifests();
        await this.setInitialPluginsConfiguration();

        if (changed) {
            await this.plugin.saveSettings();
        }
    }

    onunload() {
        if (!this.isLoaded) return;
        this.isLoaded = false;
        this.scope.dispose();
        this.pendingTimeouts.forEach(timeout => window.clearTimeout(timeout));
        this.pendingTimeouts.clear();
        this.startupOperations.clear();
    }

    async setPluginStartup(pluginId: string) {
        if (!this.isLoaded || !this.settings.enabled) return;
        this.clearPendingStartup(pluginId);
        const runToken = this.scope.token();
        const operationToken = ++this.startupOperationCounter;
        this.startupOperations.set(pluginId, operationToken);
        const obsidian = this.getObsidianPlugins();

        const startupType = this.getPluginStartup(pluginId);
        const isActiveOnStartup = obsidian.enabledPlugins.has(pluginId);
        const isRunning = obsidian.plugins?.[pluginId]?._loaded;

        try {
            switch (startupType) {
                case LoadingMethod.disabled:
                    if (!this.isActiveRun(runToken, pluginId, operationToken)) return;
                    await obsidian.disablePluginAndSave(pluginId);
                    if (!this.isActiveRun(runToken, pluginId, operationToken)) return;
                    break;
                case LoadingMethod.instant:
                    if (!this.isActiveRun(runToken, pluginId, operationToken)) return;
                    if (!isActiveOnStartup && !isRunning) {
                        await obsidian.enablePluginAndSave(pluginId);
                        if (!this.isActiveRun(runToken, pluginId, operationToken)) return;
                        this.requestSoftStartupRefresh();
                    }
                    break;
                case LoadingMethod.short:
                case LoadingMethod.long:
                    if (isActiveOnStartup) {
                        if (!this.isActiveRun(runToken, pluginId, operationToken)) return;
                        await obsidian.disablePluginAndSave(pluginId);
                        if (!this.isActiveRun(runToken, pluginId, operationToken)) return;
                        await obsidian.enablePlugin(pluginId);
                        if (!this.isActiveRun(runToken, pluginId, operationToken)) return;
                        this.requestSoftStartupRefresh();
                    } else if (!isRunning) {
                        if (!this.isActiveRun(runToken, pluginId, operationToken)) return;
                        this.scheduleDelayedStartup(pluginId, startupType, obsidian, runToken, operationToken);
                    }
                    break;
            }
        } catch (e) {
            console.error(t('Failed to load plugin {id} after delay:').replace('{id}', pluginId), e);
        }
    }

    private scheduleDelayedStartup(pluginId: string, startupType: LoadingMethod, obsidian: ObsidianPluginManager, runToken: number, operationToken: number) {
        const seconds = startupType === LoadingMethod.short ? this.deviceSettings.shortDelaySeconds : this.deviceSettings.longDelaySeconds;
        const stagger = isNaN(this.deviceSettings.delayBetweenPlugins) ? 40 : this.deviceSettings.delayBetweenPlugins;
        const manifestIndex = this.manifests.findIndex(x => x.id === pluginId);
        const delay = Math.max(0, manifestIndex) * stagger;

        const timeout = window.setTimeout(async () => {
            if (this.pendingTimeouts.get(pluginId) === timeout) {
                this.pendingTimeouts.delete(pluginId);
            }
            if (!this.isActiveRun(runToken, pluginId, operationToken)) return;
            try {
                if (!obsidian.plugins?.[pluginId]?._loaded) {
                    if (this.settings.showConsoleLog) {
                        console.log(t('Starting {id} after a {type} delay').replace('{id}', pluginId).replace('{type}', startupType));
                    }
                    await obsidian.enablePlugin(pluginId);
                    if (!this.isActiveRun(runToken, pluginId, operationToken)) return;
                    this.requestSoftStartupRefresh();
                }
            } catch (e) {
                console.error(t('Failed to load plugin {id} after delay:').replace('{id}', pluginId), e);
            }
        }, seconds * 1000 + delay);

        this.pendingTimeouts.set(pluginId, timeout);
        this.scope.add(() => window.clearTimeout(timeout));
    }

    private clearPendingStartup(pluginId: string) {
        const pending = this.pendingTimeouts.get(pluginId);
        if (pending !== undefined) {
            window.clearTimeout(pending);
            this.pendingTimeouts.delete(pluginId);
        }
    }

    private isActiveRun(token: number, pluginId?: string, operationToken?: number) {
        return this.isLoaded &&
            this.settings.enabled &&
            this.scope.isCurrent(token) &&
            (pluginId === undefined || this.startupOperations.get(pluginId) === operationToken);
    }

    private requestSoftStartupRefresh() {
        if (!this.isLoaded || !this.settings.enabled) return;
        this.plugin.statusBarManager?.refreshAfterSoftStartup();
        this.plugin.sidebarManager?.refreshAfterSoftStartup();
    }

    getPluginStartup(pluginId: string): LoadingMethod {
        return this.deviceSettings.plugins?.[pluginId]?.startupType ||
            this.deviceSettings.defaultStartupType ||
            (this.getObsidianPlugins().enabledPlugins.has(pluginId) ? LoadingMethod.instant : LoadingMethod.disabled);
    }

    async setInitialPluginsConfiguration() {
        let changed = false;
        for (const plugin of this.manifests) {
            if (!this.deviceSettings.plugins?.[plugin.id]?.startupType) {
                this.updatePluginSettingsWithNoSave(plugin.id, this.getPluginStartup(plugin.id));
                changed = true;
            }
        }
        if (changed) await this.plugin.saveSettings();
    }

    async updatePluginSettings(pluginId: string, startupType: LoadingMethod) {
        if (!isLoadingMethod(startupType)) return;
        this.deviceSettings.plugins[pluginId] = { startupType };
        await this.plugin.saveSettings();
    }

    private updatePluginSettingsWithNoSave(pluginId: string, startupType: LoadingMethod) {
        if (!isLoadingMethod(startupType)) return;
        this.deviceSettings.plugins[pluginId] = { startupType };
    }

    updateManifests() {
        this.manifests = Object.values(this.getObsidianPlugins().manifests)
            .filter((plugin: PluginManifest) =>
                plugin.id !== this.plugin.manifest.id &&
                !(Platform.isMobile && plugin.isDesktopOnly))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    private getObsidianPlugins(): ObsidianPluginManager {
        return (this.app as unknown as { plugins: ObsidianPluginManager }).plugins;
    }
}
