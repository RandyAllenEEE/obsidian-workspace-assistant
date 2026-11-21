import { App, Platform, PluginManifest } from 'obsidian';
import AssistantPlugin from '../main';
import { DeviceSettings, isLoadingMethod, LoadingMethod, MyPluginsSettings } from '../settings';
import { t } from "../i18n/helpers";
import { LifecycleScope } from "../utils/lifecycle";

type ObsidianPluginManager = {
    enabledPlugins: Set<string>;
    manifests: Record<string, PluginManifest>;
    plugins?: Record<string, { _loaded?: boolean }>;
    loadingPluginId?: string | null;
    disablePluginAndSave(pluginId: string): Promise<void>;
    disablePlugin(pluginId: string): Promise<void>;
    enablePluginAndSave(pluginId: string): Promise<boolean | void>;
    enablePlugin(pluginId: string): Promise<boolean | void>;
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
    private startupQueue: Promise<void> = Promise.resolve();
    private failedStartupInstances = new Map<string, { _loaded?: boolean }>();

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
        const runToken = this.scope.token();

        await this.refreshDeviceConfiguration();
        if (!this.isActiveRun(runToken)) return;

        const startInitialPluginSetup = () => {
            if (!this.isActiveRun(runToken)) return;
            void this.startInitialPluginSetup(runToken);
        };

        // Enabling or disabling a plugin can rebuild Markdown views. Do not let
        // that race Obsidian's restoration of their ephemeral editor state.
        const workspace = this.app.workspace;
        if (workspace && workspace.layoutReady === false) {
            workspace.onLayoutReady(startInitialPluginSetup);
        } else {
            startInitialPluginSetup();
        }
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

        try {
            await this.enqueueStartupOperation(async () => {
                if (!this.isActiveRun(runToken, pluginId, operationToken)) return;

                // Read runtime state only after this operation reaches the head
                // of the queue; an earlier operation may have changed it.
                const obsidian = this.getObsidianPlugins();
                if (this.failedStartupInstances.has(pluginId)) {
                    await this.runPluginLifecycleMutation(() => this.cleanupFailedStartup(pluginId));
                    if (!this.isActiveRun(runToken, pluginId, operationToken)) return;
                }
                const startupType = this.getPluginStartup(pluginId);
                const isActiveOnStartup = obsidian.enabledPlugins.has(pluginId);
                const isRunning = Boolean(obsidian.plugins?.[pluginId]?._loaded);

                switch (startupType) {
                    case LoadingMethod.disabled:
                        if (isActiveOnStartup || isRunning) {
                            await this.runPluginLifecycleMutation(() => obsidian.disablePluginAndSave(pluginId));
                            if (!this.isActiveRun(runToken, pluginId, operationToken)) return;
                        }
                        break;
                    case LoadingMethod.instant:
                        if (!isActiveOnStartup) {
                            await this.runPluginLifecycleMutation(() => this.enableManagedPlugin(pluginId, true));
                            if (!this.isActiveRun(runToken, pluginId, operationToken)) return;
                            this.requestSoftStartupRefresh();
                        } else if (!isRunning) {
                            await this.runPluginLifecycleMutation(() => this.enableManagedPlugin(pluginId));
                            if (!this.isActiveRun(runToken, pluginId, operationToken)) return;
                            this.requestSoftStartupRefresh();
                        }
                        break;
                    case LoadingMethod.short:
                    case LoadingMethod.long:
                        if (isActiveOnStartup) {
                            await this.runPluginLifecycleMutation(() => obsidian.disablePluginAndSave(pluginId));
                            if (!this.isActiveRun(runToken, pluginId, operationToken)) return;
                            this.scheduleDelayedStartup(pluginId, startupType, runToken, operationToken);
                        } else if (!isRunning) {
                            this.scheduleDelayedStartup(pluginId, startupType, runToken, operationToken);
                        }
                        break;
                }
            });
        } catch (e) {
            if (this.isActiveRun(runToken, pluginId, operationToken)) {
                console.error(t('Failed to load plugin {id} after delay:').replace('{id}', pluginId), e);
            }
        }
    }

    private async startInitialPluginSetup(runToken: number) {
        // When community plugins are enabled in an already restored workspace,
        // layoutReady is already true while Obsidian is still loading its native
        // enabled list. Let that loader finish before touching the same plugins.
        while (this.getObsidianPlugins().loadingPluginId) {
            if (!this.isActiveRun(runToken)) return;
            await new Promise<void>(resolve => window.setTimeout(resolve, 40));
        }
        for (const manifest of this.manifests) {
            if (!this.isActiveRun(runToken)) return;
            await this.setPluginStartup(manifest.id);
        }
    }

    private async enableManagedPlugin(pluginId: string, persist = false) {
        const obsidian = this.getObsidianPlugins();
        const previousInstance = obsidian.plugins?.[pluginId];
        try {
            const result = persist
                ? await obsidian.enablePluginAndSave(pluginId)
                : await obsidian.enablePlugin(pluginId);
            // Obsidian catches onload exceptions and returns false. _loaded is
            // set before onload completes, so it cannot prove startup succeeded.
            if (result === false) throw new Error(`Obsidian reported a failed plugin startup: ${pluginId}`);
        } catch (error) {
            const failedInstance = obsidian.plugins?.[pluginId];
            if (failedInstance && failedInstance !== previousInstance) {
                this.failedStartupInstances.set(pluginId, failedInstance);
                try {
                    await this.cleanupFailedStartup(pluginId);
                } catch (cleanupError) {
                    console.error(`[Workspace Assistant] Failed to clean up plugin ${pluginId}:`, cleanupError);
                }
            }
            throw error;
        }
    }

    private async cleanupFailedStartup(pluginId: string) {
        const failedInstance = this.failedStartupInstances.get(pluginId);
        if (!failedInstance) return;
        const obsidian = this.getObsidianPlugins();
        // A replacement installed by another caller belongs to that caller.
        if (obsidian.plugins?.[pluginId] === failedInstance) {
            await obsidian.disablePlugin(pluginId);
            if (obsidian.plugins?.[pluginId] === failedInstance) {
                throw new Error(`Failed plugin instance is still registered: ${pluginId}`);
            }
        }
        this.failedStartupInstances.delete(pluginId);
    }

    private enqueueStartupOperation(operation: () => Promise<void>) {
        const queued = this.startupQueue.then(operation);
        // Keep the queue usable after one plugin fails, while returning the
        // original rejection to the operation that owns the error message.
        this.startupQueue = queued.catch(() => undefined);
        return queued;
    }

    private async runPluginLifecycleMutation(operation: () => Promise<void>) {
        const configuredGap = this.deviceSettings.delayBetweenPlugins;
        const stabilizationDelay = Number.isFinite(configuredGap) ? Math.max(0, configuredGap) : 40;

        try {
            await operation();
        } finally {
            // Plugin lifecycle promises can resolve before their workspace and
            // editor callbacks have drained. Keep the global queue occupied for
            // at least one macrotask (and the configured inter-plugin gap).
            await new Promise<void>(resolve => window.setTimeout(resolve, stabilizationDelay));
        }
    }

    private scheduleDelayedStartup(pluginId: string, startupType: LoadingMethod, runToken: number, operationToken: number) {
        const seconds = startupType === LoadingMethod.short ? this.deviceSettings.shortDelaySeconds : this.deviceSettings.longDelaySeconds;
        const stagger = isNaN(this.deviceSettings.delayBetweenPlugins) ? 40 : this.deviceSettings.delayBetweenPlugins;
        const manifestIndex = this.manifests.findIndex(x => x.id === pluginId);
        const delay = Math.max(0, manifestIndex) * stagger;

        const timeout = window.setTimeout(async () => {
            if (this.pendingTimeouts.get(pluginId) === timeout) {
                this.pendingTimeouts.delete(pluginId);
            }
            if (!this.isActiveRun(runToken, pluginId, operationToken)) return;
            void this.runDelayedStartup(pluginId, startupType, runToken, operationToken);
        }, seconds * 1000 + delay);

        this.pendingTimeouts.set(pluginId, timeout);
        this.scope.add(() => window.clearTimeout(timeout));
    }

    private async runDelayedStartup(pluginId: string, startupType: LoadingMethod, runToken: number, operationToken: number) {
        try {
            await this.enqueueStartupOperation(async () => {
                if (!this.isActiveRun(runToken, pluginId, operationToken) || this.getPluginStartup(pluginId) !== startupType) return;

                const obsidian = this.getObsidianPlugins();
                await this.cleanupFailedStartup(pluginId);
                if (!this.isActiveRun(runToken, pluginId, operationToken)) return;
                if (obsidian.plugins?.[pluginId]?._loaded) return;
                if (this.settings.showConsoleLog) {
                    console.log(t('Starting {id} after a {type} delay').replace('{id}', pluginId).replace('{type}', startupType));
                }
                await this.runPluginLifecycleMutation(() => this.enableManagedPlugin(pluginId));
                if (!this.isActiveRun(runToken, pluginId, operationToken)) return;
                this.requestSoftStartupRefresh();
            });
        } catch (e) {
            if (this.isActiveRun(runToken, pluginId, operationToken)) {
                console.error(t('Failed to load plugin {id} after delay:').replace('{id}', pluginId), e);
            }
        }
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
