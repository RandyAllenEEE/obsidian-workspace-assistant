import { describe, expect, it, vi } from "vitest";
import { Platform } from "obsidian";
import { FoldersManager } from "../src/folders/manager";
import { PluginsManager } from "../src/plugins/manager";
import { RibbonFeature } from "../src/sidebar/features/ribbon";
import { ContextualSplitFeature } from "../src/sidebar/features/contextual-split";
import { SidebarTabsFeature } from "../src/sidebar/features/tabs";
import { StatusBarManager } from "../src/statusbar/manager";
import { LoadingMethod, normalizeSettings } from "../src/settings";

function flush() {
    return Promise.resolve();
}

async function flushAll() {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
}

function createWorkspace() {
    return {
        layoutReady: true,
        onLayoutReady: (callback: () => void) => callback(),
        on: vi.fn(() => ({})),
        offref: vi.fn(),
        leftSplit: null,
        rightSplit: null
    };
}

function createDeferredWorkspace() {
    const callbacks: Array<() => void> = [];
    return {
        callbacks,
        workspace: {
            layoutReady: false,
            onLayoutReady: (callback: () => void) => callbacks.push(callback),
            on: vi.fn(() => ({})),
            offref: vi.fn(),
            leftSplit: null,
            rightSplit: null
        }
    };
}

function createVault() {
    return {
        on: vi.fn(() => ({})),
        offref: vi.fn(),
        getConfig: vi.fn(() => []),
        setConfig: vi.fn(),
        trigger: vi.fn()
    };
}

function createPlugin() {
    return {
        settings: normalizeSettings(),
        manifest: { id: "obsidian-workspace-assistant" },
        saveSettings: vi.fn(async () => undefined),
        addRibbonIcon: vi.fn((_icon: string, title: string, callback: (event: MouseEvent) => void) => {
            const button = document.createElement("button");
            button.setAttribute("aria-label", title);
            button.addEventListener("click", callback);
            document.body.appendChild(button);
            return button;
        }),
        addStatusBarItem: vi.fn(() => {
            const item = document.createElement("div");
            item.setText = (text: string) => { item.textContent = text; };
            document.body.appendChild(item);
            return item;
        }),
        statusBarManager: { refreshAfterSoftStartup: vi.fn() },
        sidebarManager: { refreshAfterSoftStartup: vi.fn() }
    };
}

type ContextualSplitHarnessOptions = {
    layoutReady?: boolean;
    setViewState?: (leaf: any, type: string, creationIndex: number) => Promise<void>;
};

function createContextualSplitHarness(options: ContextualSplitHarnessOptions = {}) {
    const layoutReadyCallbacks: Array<() => void> = [];
    const eventCallbacks = new Map<string, Array<(...args: any[]) => void>>();
    const splitEl = document.body.createDiv({ cls: "mod-left-split" });
    const split: any = {
        containerEl: splitEl,
        children: []
    };

    const masterParentEl = splitEl.createDiv();
    const masterEl = masterParentEl.createDiv();
    (masterEl as any).isShown = () => true;
    const masterParent: any = {
        containerEl: masterParentEl,
        children: [],
        parent: split,
        setDimension: vi.fn()
    };
    const masterLeaf: any = {
        view: {
            getViewType: () => "search",
            getDisplayText: () => "Search",
            icon: "search",
            containerEl: masterEl
        },
        parent: masterParent,
        getViewState: () => ({ type: "search" })
    };
    masterParent.children.push(masterLeaf);
    split.children.push(masterParent);

    const createdLeaves: any[] = [];
    const createLeafBySplit = vi.fn((_masterLeaf: any, direction: string) => {
        const creationIndex = createdLeaves.length;
        const parentEl = splitEl.createDiv();
        const leafEl = parentEl.createDiv();
        (leafEl as any).isShown = () => true;
        let viewType = "empty";

        const parent: any = {
            containerEl: parentEl,
            children: [],
            parent: split,
            setDimension: vi.fn()
        };
        const leaf: any = {
            view: {
                getViewType: () => viewType,
                getDisplayText: () => viewType,
                icon: "",
                containerEl: leafEl
            },
            parent,
            getViewState: () => ({ type: viewType }),
            detach: vi.fn(() => {
                const index = split.children.indexOf(parent);
                if (index >= 0) split.children.splice(index, 1);
                parentEl.remove();
            })
        };
        leaf.setViewState = vi.fn(async (state: { type: string }) => {
            await options.setViewState?.(leaf, state.type, creationIndex);
            viewType = state.type;
        });

        parent.children.push(leaf);
        split.children.push(parent);
        createdLeaves.push(leaf);
        return leaf;
    });

    const workspace: any = {
        layoutReady: options.layoutReady ?? true,
        leftSplit: split,
        rightSplit: null,
        onLayoutReady: vi.fn((callback: () => void) => layoutReadyCallbacks.push(callback)),
        on: vi.fn((event: string, callback: (...args: any[]) => void) => {
            const callbacks = eventCallbacks.get(event) || [];
            callbacks.push(callback);
            eventCallbacks.set(event, callbacks);
            return { event, callback };
        }),
        offref: vi.fn(),
        createLeafBySplit,
        iterateAllLeaves: vi.fn((callback: (leaf: any) => void) => {
            const visit = (item: any) => {
                if (item?.view?.getViewType) {
                    callback(item);
                    return;
                }
                item?.children?.forEach((child: any) => visit(child));
            };
            visit(split);
        })
    };

    return {
        workspace,
        split,
        masterLeaf,
        masterParent,
        createdLeaves,
        createLeafBySplit,
        emit(event: string, ...args: any[]) {
            eventCallbacks.get(event)?.forEach(callback => callback(...args));
        },
        markLayoutReady() {
            workspace.layoutReady = true;
            layoutReadyCallbacks.forEach(callback => callback());
        },
        liveLeaves(type: string) {
            const leaves: any[] = [];
            workspace.iterateAllLeaves((leaf: any) => {
                if (leaf.view.getViewType() === type) leaves.push(leaf);
            });
            return leaves;
        }
    };
}

describe("manager stability behavior", () => {
    it("restores hidden folder display styles when rechecking or unloading", async () => {
        vi.useFakeTimers();
        const plugin = createPlugin();
        const app = { workspace: createWorkspace(), vault: createVault() };
        const manager = new FoldersManager(app as any, plugin as any);

        await manager.onload();
        const folder = document.createElement("div");
        folder.addClass("obsidian-hide-folders--hidden");
        folder.style.height = "0px";
        folder.style.display = "none";
        folder.style.overflow = "hidden";
        document.body.appendChild(folder);

        manager.settings.attachmentFolderNames = [];
        manager.processFolders(true);
        vi.advanceTimersByTime(100);

        expect(folder.style.display).toBe("");
        expect(folder.style.height).toBe("");
        expect(folder.style.overflow).toBe("");
        expect(folder.hasClass("obsidian-hide-folders--hidden")).toBe(false);

        folder.addClass("obsidian-hide-folders--hidden");
        folder.style.display = "none";
        manager.onunload();
        expect(folder.style.display).toBe("");
        expect(folder.hasClass("obsidian-hide-folders--hidden")).toBe(false);

        const styledFolder = document.createElement("div");
        styledFolder.style.display = "grid";
        styledFolder.style.height = "24px";
        styledFolder.style.overflow = "auto";
        document.body.appendChild(styledFolder);
        (manager as any).rememberFolderStyles(styledFolder);
        styledFolder.addClass("obsidian-hide-folders--hidden");
        styledFolder.style.display = "none";
        styledFolder.style.height = "0px";
        styledFolder.style.overflow = "hidden";

        (manager as any).restoreProcessedFolders();

        expect(styledFolder.style.display).toBe("grid");
        expect(styledFolder.style.height).toBe("24px");
        expect(styledFolder.style.overflow).toBe("auto");
        expect(styledFolder.hasClass("obsidian-hide-folders--hidden")).toBe(false);
    });

    it("does not continue delayed plugin startup after unload", async () => {
        vi.useFakeTimers();
        const plugin = createPlugin();
        plugin.settings.myPlugins.desktop.shortDelaySeconds = 1;
        plugin.settings.myPlugins.desktop.delayBetweenPlugins = 0;
        plugin.settings.myPlugins.desktop.plugins.foo = { startupType: LoadingMethod.short };

        const obsidianPlugins = {
            enabledPlugins: new Set<string>(),
            manifests: { foo: { id: "foo", name: "Foo" } },
            plugins: {},
            disablePluginAndSave: vi.fn(async () => undefined),
            enablePluginAndSave: vi.fn(async () => undefined),
            enablePlugin: vi.fn(async () => undefined)
        };
        const app = { plugins: obsidianPlugins };
        const manager = new PluginsManager(app as any, plugin as any);

        await manager.onload();
        manager.onunload();
        vi.advanceTimersByTime(1500);
        await flush();

        expect(obsidianPlugins.enablePlugin).not.toHaveBeenCalled();
        expect(plugin.statusBarManager.refreshAfterSoftStartup).not.toHaveBeenCalled();
        expect(plugin.sidebarManager.refreshAfterSoftStartup).not.toHaveBeenCalled();
    });

    it("ignores stale plugin startup operations after a newer setting wins", async () => {
        const plugin = createPlugin();
        plugin.settings.myPlugins.desktop.plugins.foo = { startupType: LoadingMethod.instant };

        let releaseEnable: (() => void) | null = null;
        const enabledPlugins = new Set<string>();
        const runningPlugins: Record<string, { _loaded?: boolean }> = {};
        const obsidianPlugins = {
            enabledPlugins,
            manifests: { foo: { id: "foo", name: "Foo" } },
            plugins: runningPlugins,
            disablePluginAndSave: vi.fn(async (pluginId: string) => {
                enabledPlugins.delete(pluginId);
                delete runningPlugins[pluginId];
            }),
            enablePluginAndSave: vi.fn(async (pluginId: string) => {
                await new Promise<void>(resolve => { releaseEnable = resolve; });
                enabledPlugins.add(pluginId);
                runningPlugins[pluginId] = { _loaded: true };
            }),
            enablePlugin: vi.fn(async () => undefined)
        };
        const app = { plugins: obsidianPlugins };
        const manager = new PluginsManager(app as any, plugin as any);

        await manager.onload();
        await flush();
        expect(obsidianPlugins.enablePluginAndSave).toHaveBeenCalledTimes(1);

        plugin.settings.myPlugins.desktop.plugins.foo = { startupType: LoadingMethod.disabled };
        const applyLatestSetting = manager.setPluginStartup("foo");
        await flush();
        expect(obsidianPlugins.disablePluginAndSave).not.toHaveBeenCalled();

        if (releaseEnable) releaseEnable();
        await applyLatestSetting;
        await flushAll();

        expect(obsidianPlugins.disablePluginAndSave).toHaveBeenCalledTimes(1);
        expect(enabledPlugins.has("foo")).toBe(false);
        expect(runningPlugins.foo).toBeUndefined();
        expect(plugin.statusBarManager.refreshAfterSoftStartup).not.toHaveBeenCalled();
        expect(plugin.sidebarManager.refreshAfterSoftStartup).not.toHaveBeenCalled();
    });

    it("waits for layout ready before changing plugin lifecycle state", async () => {
        const plugin = createPlugin();
        plugin.settings.myPlugins.desktop.plugins.foo = { startupType: LoadingMethod.instant };
        const layoutReadyCallbacks: Array<() => void> = [];
        const obsidianPlugins = {
            enabledPlugins: new Set<string>(),
            manifests: { foo: { id: "foo", name: "Foo" } },
            plugins: {},
            disablePluginAndSave: vi.fn(async () => undefined),
            enablePluginAndSave: vi.fn(async () => undefined),
            enablePlugin: vi.fn(async () => undefined)
        };
        const app = {
            plugins: obsidianPlugins,
            workspace: {
                layoutReady: false,
                onLayoutReady: vi.fn((callback: () => void) => layoutReadyCallbacks.push(callback))
            }
        };
        const manager = new PluginsManager(app as any, plugin as any);

        await manager.onload();
        await flushAll();
        expect(obsidianPlugins.enablePluginAndSave).not.toHaveBeenCalled();
        expect(layoutReadyCallbacks).toHaveLength(1);

        app.workspace.layoutReady = true;
        layoutReadyCallbacks[0]();
        await flushAll();

        expect(obsidianPlugins.enablePluginAndSave).toHaveBeenCalledTimes(1);
    });

    it("ignores an initial plugin setup that resumes after unload and reload", async () => {
        const plugin = createPlugin();
        plugin.settings.myPlugins.desktop.plugins.foo = { startupType: LoadingMethod.instant };
        const obsidianPlugins = {
            enabledPlugins: new Set<string>(),
            manifests: { foo: { id: "foo", name: "Foo" } },
            plugins: {},
            disablePluginAndSave: vi.fn(async () => undefined),
            enablePluginAndSave: vi.fn(async () => undefined),
            enablePlugin: vi.fn(async () => undefined)
        };
        const manager = new PluginsManager({ plugins: obsidianPlugins } as any, plugin as any);
        manager.manifests = [{ id: "foo", name: "Foo" } as any];

        let releaseFirstRefresh!: () => void;
        const firstRefresh = new Promise<void>(resolve => { releaseFirstRefresh = resolve; });
        vi.spyOn(manager, "refreshDeviceConfiguration")
            .mockImplementationOnce(async () => firstRefresh)
            .mockResolvedValueOnce(undefined);

        const staleLoad = manager.onload();
        await flush();
        manager.onunload();
        await manager.onload();
        await flushAll();

        expect(obsidianPlugins.enablePluginAndSave).toHaveBeenCalledTimes(1);

        releaseFirstRefresh();
        await staleLoad;
        await flushAll();

        expect(obsidianPlugins.enablePluginAndSave).toHaveBeenCalledTimes(1);
    });

    it("keeps reloaded plugin work behind a stale in-flight lifecycle call", async () => {
        vi.useFakeTimers();
        const plugin = createPlugin();
        plugin.settings.myPlugins.desktop.delayBetweenPlugins = 0;
        plugin.settings.myPlugins.desktop.plugins.foo = { startupType: LoadingMethod.instant };

        let lifecycleMutation: string | null = null;
        let releaseEnable!: () => void;
        const enableReady = new Promise<void>(resolve => { releaseEnable = resolve; });
        const enabledPlugins = new Set<string>();
        const runningPlugins: Record<string, { _loaded?: boolean }> = {};
        const completedMutations: string[] = [];
        const obsidianPlugins = {
            enabledPlugins,
            manifests: { foo: { id: "foo", name: "Foo" } },
            plugins: runningPlugins,
            enablePluginAndSave: vi.fn(async (pluginId: string) => {
                if (lifecycleMutation !== null) throw new RangeError("Selection points outside of document");
                lifecycleMutation = "enable";
                await enableReady;
                enabledPlugins.add(pluginId);
                runningPlugins[pluginId] = { _loaded: true };
                completedMutations.push("enable");
                lifecycleMutation = null;
            }),
            disablePluginAndSave: vi.fn(async (pluginId: string) => {
                if (lifecycleMutation !== null) throw new RangeError("Selection points outside of document");
                lifecycleMutation = "disable";
                await Promise.resolve();
                enabledPlugins.delete(pluginId);
                delete runningPlugins[pluginId];
                completedMutations.push("disable");
                lifecycleMutation = null;
            }),
            enablePlugin: vi.fn(async () => undefined)
        };
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const manager = new PluginsManager({ plugins: obsidianPlugins } as any, plugin as any);

        await manager.onload();
        await flushAll();
        expect(obsidianPlugins.enablePluginAndSave).toHaveBeenCalledTimes(1);

        manager.onunload();
        plugin.settings.myPlugins.desktop.plugins.foo = { startupType: LoadingMethod.disabled };
        await manager.onload();
        await flushAll();
        expect(obsidianPlugins.disablePluginAndSave).not.toHaveBeenCalled();

        releaseEnable();
        for (let i = 0; i < 4; i++) {
            await flushAll();
            vi.runOnlyPendingTimers();
        }
        await (manager as any).startupQueue;

        expect(consoleError).not.toHaveBeenCalled();
        expect(obsidianPlugins.disablePluginAndSave).toHaveBeenCalledTimes(1);
        expect(completedMutations).toEqual(["enable", "disable"]);
        expect(lifecycleMutation).toBeNull();
        expect(enabledPlugins.has("foo")).toBe(false);
        expect(runningPlugins.foo).toBeUndefined();
    });

    it("uses the configured delay when a delayed plugin was already active", async () => {
        vi.useFakeTimers();
        const plugin = createPlugin();
        plugin.settings.myPlugins.desktop.shortDelaySeconds = 1;
        plugin.settings.myPlugins.desktop.delayBetweenPlugins = 0;
        plugin.settings.myPlugins.desktop.plugins.foo = { startupType: LoadingMethod.short };
        const enabledPlugins = new Set(["foo"]);
        const runningPlugins: Record<string, { _loaded?: boolean }> = { foo: { _loaded: true } };
        const obsidianPlugins = {
            enabledPlugins,
            manifests: { foo: { id: "foo", name: "Foo" } },
            plugins: runningPlugins,
            disablePluginAndSave: vi.fn(async (pluginId: string) => {
                enabledPlugins.delete(pluginId);
                delete runningPlugins[pluginId];
            }),
            enablePluginAndSave: vi.fn(async () => undefined),
            enablePlugin: vi.fn(async (pluginId: string) => {
                runningPlugins[pluginId] = { _loaded: true };
            })
        };
        const manager = new PluginsManager({ plugins: obsidianPlugins } as any, plugin as any);

        await manager.onload();
        await flushAll();
        vi.advanceTimersByTime(0);
        await flushAll();

        expect(obsidianPlugins.disablePluginAndSave).toHaveBeenCalledTimes(1);
        expect(obsidianPlugins.enablePlugin).not.toHaveBeenCalled();

        vi.advanceTimersByTime(999);
        await flushAll();
        expect(obsidianPlugins.enablePlugin).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        await flushAll();
        expect(obsidianPlugins.enablePlugin).toHaveBeenCalledTimes(1);
        expect(runningPlugins.foo?._loaded).toBe(true);
    });

    it("serializes delayed plugin loads that become ready together", async () => {
        vi.useFakeTimers();
        const plugin = createPlugin();
        plugin.settings.myPlugins.desktop.shortDelaySeconds = 0;
        plugin.settings.myPlugins.desktop.delayBetweenPlugins = 0;
        plugin.settings.myPlugins.desktop.plugins.alpha = { startupType: LoadingMethod.short };
        plugin.settings.myPlugins.desktop.plugins.beta = { startupType: LoadingMethod.short };

        let lifecycleMutation: string | null = null;
        const completedMutations: string[] = [];
        const runningPlugins: Record<string, { _loaded?: boolean }> = {};
        const enablePlugin = vi.fn(async (pluginId: string) => {
            if (lifecycleMutation !== null) {
                throw new RangeError("Selection points outside of document");
            }
            lifecycleMutation = pluginId;
            window.setTimeout(() => {
                completedMutations.push(pluginId);
                runningPlugins[pluginId] = { _loaded: true };
                lifecycleMutation = null;
            }, 0);
        });
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const obsidianPlugins = {
            enabledPlugins: new Set<string>(),
            manifests: {
                alpha: { id: "alpha", name: "Alpha" },
                beta: { id: "beta", name: "Beta" }
            },
            plugins: runningPlugins,
            disablePluginAndSave: vi.fn(async () => undefined),
            enablePluginAndSave: vi.fn(async () => undefined),
            enablePlugin
        };
        const manager = new PluginsManager({ plugins: obsidianPlugins } as any, plugin as any);

        await manager.onload();
        await flushAll();
        vi.runAllTimers();
        for (let i = 0; i < 4; i++) {
            await flushAll();
            vi.runOnlyPendingTimers();
        }
        await (manager as any).startupQueue;
        await flushAll();

        expect(consoleError).not.toHaveBeenCalled();
        expect(enablePlugin).toHaveBeenCalledTimes(2);
        expect(completedMutations).toEqual(["alpha", "beta"]);
        expect(lifecycleMutation).toBeNull();
        expect(plugin.statusBarManager.refreshAfterSoftStartup).toHaveBeenCalledTimes(2);
        expect(plugin.sidebarManager.refreshAfterSoftStartup).toHaveBeenCalledTimes(2);
    });

    it("refreshes mobile plugin device configuration while already loaded", async () => {
        Platform.isMobile = true;

        try {
            const plugin = createPlugin();
            plugin.settings.myPlugins.dualConfigs = false;
            plugin.settings.myPlugins.desktop.plugins.foo = { startupType: LoadingMethod.short };
            plugin.settings.myPlugins.mobile = undefined;

            const obsidianPlugins = {
                enabledPlugins: new Set<string>(),
                manifests: { foo: { id: "foo", name: "Foo" } },
                plugins: {},
                disablePluginAndSave: vi.fn(async () => undefined),
                enablePluginAndSave: vi.fn(async () => undefined),
                enablePlugin: vi.fn(async () => undefined)
            };
            const manager = new PluginsManager({ plugins: obsidianPlugins } as any, plugin as any);

            await manager.onload();
            expect(manager.device).toBe("desktop/global");

            plugin.settings.myPlugins.dualConfigs = true;
            await manager.refreshDeviceConfiguration();

            expect(manager.device).toBe("mobile");
            expect(plugin.settings.myPlugins.mobile?.plugins.foo.startupType).toBe(LoadingMethod.short);
        } finally {
            Platform.isMobile = false;
        }
    });

    it("ignores stale layout-ready callbacks from previous status bar loads", async () => {
        const plugin = createPlugin();
        const { workspace, callbacks } = createDeferredWorkspace();
        const manager = new StatusBarManager({ workspace } as any, plugin as any);
        const initialize = vi.spyOn(manager as any, "initializeManager").mockImplementation(() => undefined);

        await manager.onload();
        manager.onunload();
        await manager.onload();

        document.body.createDiv({ cls: "status-bar" });
        callbacks.forEach(callback => callback());

        expect(initialize).toHaveBeenCalledTimes(1);
    });

    it("restores status bar item visibility and order when disabled", async () => {
        const plugin = createPlugin();
        plugin.settings.myStatusBar.status = {
            "plugin-snippets;1": {
                position: 10,
                visible: false
            }
        };
        const statusBar = document.body.createDiv({ cls: "status-bar" });
        const item = statusBar.createDiv({ cls: "status-bar-item plugin-snippets" });
        item.style.order = "3";

        const manager = new StatusBarManager({ workspace: createWorkspace() } as any, plugin as any);
        await manager.onload();

        expect(item.hasClass("statusbar-organizer-element-hidden")).toBe(true);
        expect(item.style.order).toBe("1");

        manager.onunload();

        expect(item.hasClass("statusbar-organizer-element-hidden")).toBe(false);
        expect(item.style.order).toBe("3");
    });

    it("saves status bar settings only when discovery adds an item", async () => {
        const plugin = createPlugin();
        plugin.settings.myStatusBar.status = {
            "plugin-snippets;1": { position: 1, visible: false },
        };
        const statusBar = document.body.createDiv({ cls: "status-bar" });
        statusBar.createDiv({ cls: "status-bar-item plugin-snippets" });
        const manager = new StatusBarManager({ workspace: createWorkspace() } as any, plugin as any);
        await manager.onload();
        try {
            await manager.consolidateSettingsAndElements();
            expect(plugin.saveSettings).not.toHaveBeenCalled();

            statusBar.createDiv({ cls: "status-bar-item plugin-untracked" });
            await manager.consolidateSettingsAndElements();
            expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
            expect(plugin.settings.myStatusBar.status["plugin-untracked;1"]).toMatchObject({ visible: true });
            expect(plugin.settings.myStatusBar.status["plugin-snippets;1"]).toEqual({ position: 1, visible: false });

            await manager.consolidateSettingsAndElements();
            expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        } finally {
            manager.onunload();
        }
    });

    it("debounces sidebar tabs soft-start refreshes", async () => {
        vi.useFakeTimers();
        const plugin = createPlugin();
        const app = { workspace: createWorkspace() };
        const feature = new SidebarTabsFeature(app as any, plugin as any);
        const scan = vi.spyOn(feature, "scanAndApply").mockResolvedValue(undefined);

        await feature.onload();
        vi.clearAllTimers();

        feature.refreshAfterSoftStartup();
        feature.refreshAfterSoftStartup();
        vi.advanceTimersByTime(249);
        expect(scan).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        await flush();

        expect(scan).toHaveBeenCalledTimes(1);
    });

    it("serializes sidebar tab refreshes while a scan is in flight", async () => {
        vi.useFakeTimers();
        const plugin = createPlugin();
        const app = { workspace: createWorkspace() };
        const feature = new SidebarTabsFeature(app as any, plugin as any);
        let releaseFirst: (() => void) | null = null;
        let calls = 0;
        vi.spyOn(feature, "scanAndApply").mockImplementation(async () => {
            calls++;
            if (calls === 1) {
                await new Promise<void>(resolve => { releaseFirst = resolve; });
            }
        });

        await feature.onload();
        vi.clearAllTimers();

        feature.refreshAfterSoftStartup();
        vi.advanceTimersByTime(250);
        await flush();
        feature.refreshAfterSoftStartup();
        vi.advanceTimersByTime(250);
        await flush();
        expect(calls).toBe(1);

        if (releaseFirst) releaseFirst();
        await flushAll();

        expect(calls).toBe(2);
    });

    it("restores ribbon buttons to their original parent on unload", async () => {
        vi.useFakeTimers();
        const plugin = createPlugin();
        plugin.settings.myPlugins.enabled = false;
        plugin.settings.mySideBar.ribbon.ribbonDisplayDelay = 0;
        const workspace = createWorkspace();
        const app = { workspace };

        const ribbon = document.createElement("div");
        ribbon.addClass("workspace-ribbon");
        ribbon.addClass("mod-left");
        const actions = ribbon.createDiv({ cls: "side-dock-actions" });
        const settings = ribbon.createDiv({ cls: "side-dock-settings" });
        const actionButton = actions.createEl("button");
        actionButton.setAttribute("aria-label", "Action");
        actionButton.innerHTML = '<svg viewBox="0 0 16 16"><path d="M0 0" /></svg>';
        const settingsButton = settings.createEl("button");
        settingsButton.setAttribute("aria-label", "Settings");
        settingsButton.innerHTML = '<svg viewBox="0 0 16 16"><path d="M1 1" /></svg>';
        document.body.appendChild(ribbon);

        const feature = new RibbonFeature(app as any, plugin as any);
        await feature.onload();
        vi.runAllTimers();
        await flush();
        await flush();

        expect(actions.contains(settingsButton)).toBe(true);

        feature.onunload();

        expect(settings.contains(settingsButton)).toBe(true);
    });

    it("does not process ribbon before the startup display delay finishes", async () => {
        vi.useFakeTimers();
        const plugin = createPlugin();
        plugin.settings.myPlugins.enabled = false;
        plugin.settings.mySideBar.ribbon.ribbonDisplayDelay = 1000;
        const app = { workspace: createWorkspace() };

        const ribbon = document.createElement("div");
        ribbon.addClass("workspace-ribbon");
        ribbon.addClass("mod-left");
        ribbon.createDiv({ cls: "side-dock-actions" });
        ribbon.createDiv({ cls: "side-dock-settings" });
        document.body.appendChild(ribbon);

        const feature = new RibbonFeature(app as any, plugin as any);
        const process = vi.spyOn(feature, "processRibbon").mockResolvedValue(undefined);

        await feature.onload();
        feature.refreshAfterSoftStartup();
        vi.advanceTimersByTime(250);
        await flush();

        expect(process).not.toHaveBeenCalled();

        vi.advanceTimersByTime(750);
        await flush();

        expect(process).toHaveBeenCalledTimes(1);
    });

    it.each([
        ["an already-ready layout", true],
        ["a deferred layout-ready callback", false]
    ])("creates one contextual slave during initialization with %s", async (_case, layoutReady) => {
        vi.useFakeTimers();
        const plugin = createPlugin();
        plugin.settings.mySideBar.tabs.bindings = [
            { masterId: "search", slaveId: "outline", splitRatio: 60 }
        ];
        const harness = createContextualSplitHarness({ layoutReady });
        const feature = new ContextualSplitFeature({ workspace: harness.workspace } as any, plugin as any);

        feature.onload();
        if (!layoutReady) {
            expect(harness.createLeafBySplit).not.toHaveBeenCalled();
            harness.markLayoutReady();
        }
        await flushAll();

        expect(harness.createLeafBySplit).toHaveBeenCalledTimes(1);
        expect(harness.createLeafBySplit).toHaveBeenCalledWith(harness.masterLeaf, "horizontal");
        expect(harness.liveLeaves("outline")).toHaveLength(1);
        expect(harness.liveLeaves("outline")[0].view.containerEl.dataset.assistantContextualSlave).toBe("true");

        await feature.handleActiveLeaf(harness.masterLeaf);
        await flushAll();
        expect(harness.createLeafBySplit).toHaveBeenCalledTimes(1);

        feature.onunload();
    });

    it("restores a removed contextual slave on layout change with its saved presentation", async () => {
        vi.useFakeTimers();
        const plugin = createPlugin();
        plugin.settings.mySideBar.tabs.bindings = [
            { masterId: "search", slaveId: "outline", splitRatio: 64 }
        ];
        const harness = createContextualSplitHarness();
        const feature = new ContextualSplitFeature({ workspace: harness.workspace } as any, plugin as any);

        feature.onload();
        await flushAll();
        expect(harness.createLeafBySplit).toHaveBeenCalledTimes(1);

        const removedSlave = harness.createdLeaves[0];
        removedSlave.detach();
        harness.masterParent.setDimension.mockClear();
        expect(harness.liveLeaves("outline")).toHaveLength(0);

        harness.emit("layout-change");
        vi.advanceTimersByTime(250);
        await flushAll();

        expect(harness.createLeafBySplit).toHaveBeenCalledTimes(2);
        const restoredSlave = harness.liveLeaves("outline")[0];
        expect(restoredSlave).toBeDefined();
        expect(restoredSlave.view.containerEl.dataset.assistantContextualSlave).toBe("true");
        expect(restoredSlave.parent.containerEl.hasClass("contextual-split-hidden-header")).toBe(true);
        expect(restoredSlave.parent.setDimension).toHaveBeenCalledWith(64);
        expect(harness.masterParent.setDimension).toHaveBeenCalledWith(36);

        feature.onunload();
    });

    it("reconciles a missing slave when the managed tab layout already matches", async () => {
        vi.useFakeTimers();
        const plugin = createPlugin();
        plugin.settings.mySideBar.tabs.bindings = [
            { masterId: "search", slaveId: "outline", splitRatio: 55 }
        ];
        plugin.settings.mySideBar.tabs.elements = {
            search: { id: "search", side: "left", visible: true, order: 0 },
            outline: { id: "outline", side: "left", visible: false, order: 0.01 }
        };
        const harness = createContextualSplitHarness();
        const app = { workspace: harness.workspace };
        const contextual = new ContextualSplitFeature(app as any, plugin as any);
        contextual.onload();
        await flushAll();

        harness.createdLeaves[0].detach();
        expect(harness.liveLeaves("outline")).toHaveLength(0);

        const tabs = new SidebarTabsFeature(
            app as any,
            plugin as any,
            () => contextual.checkActiveBindingValidity()
        );
        await tabs.onload();
        vi.clearAllTimers();
        await tabs.applyLayout();
        await flushAll();

        expect(harness.createLeafBySplit).toHaveBeenCalledTimes(2);
        expect(harness.liveLeaves("outline")).toHaveLength(1);
        expect(harness.liveLeaves("outline")[0].parent.setDimension).toHaveBeenCalledWith(55);

        tabs.onunload();
        contextual.onunload();
    });

    it("reconciles the contextual slave after a tab layout rebuild without a layout-change event", async () => {
        vi.useFakeTimers();
        const plugin = createPlugin();
        plugin.settings.mySideBar.tabs.bindings = [
            { masterId: "search", slaveId: "outline", splitRatio: 58 }
        ];
        plugin.settings.mySideBar.tabs.elements = {
            search: { id: "search", side: "left", visible: true, order: 0 },
            outline: { id: "outline", side: "left", visible: false, order: 0.01 },
            extra: { id: "extra", side: "left", visible: false, order: 2 }
        };
        const harness = createContextualSplitHarness();
        const app = { workspace: harness.workspace };
        const contextual = new ContextualSplitFeature(app as any, plugin as any);
        contextual.onload();
        await flushAll();

        const initialSlave = harness.liveLeaves("outline")[0];
        harness.masterLeaf.detach = vi.fn(() => {
            const index = harness.split.children.indexOf(harness.masterParent);
            if (index >= 0) harness.split.children.splice(index, 1);
            harness.masterParent.containerEl.remove();
        });

        const extraParentEl = harness.split.containerEl.createDiv();
        const extraEl = extraParentEl.createDiv();
        (extraEl as any).isShown = () => true;
        const extraParent: any = {
            containerEl: extraParentEl,
            children: [],
            parent: harness.split,
            setDimension: vi.fn()
        };
        const extraLeaf: any = {
            view: {
                getViewType: () => "extra",
                containerEl: extraEl
            },
            parent: extraParent,
            getViewState: () => ({ type: "extra" }),
            detach: vi.fn(() => {
                const index = harness.split.children.indexOf(extraParent);
                if (index >= 0) harness.split.children.splice(index, 1);
                extraParentEl.remove();
            })
        };
        extraParent.children.push(extraLeaf);
        harness.split.children.push(extraParent);

        const restoredMasterLeaves: any[] = [];
        harness.workspace.getLeftLeaf = vi.fn(() => {
            const parentEl = harness.split.containerEl.createDiv();
            const leafEl = parentEl.createDiv();
            (leafEl as any).isShown = () => true;
            let viewType = "empty";
            const parent: any = {
                containerEl: parentEl,
                children: [],
                parent: harness.split,
                setDimension: vi.fn()
            };
            const leaf: any = {
                view: {
                    getViewType: () => viewType,
                    containerEl: leafEl
                },
                parent,
                getViewState: () => ({ type: viewType }),
                setViewState: vi.fn(async (state: { type: string }) => { viewType = state.type; }),
                detach: vi.fn(() => {
                    const index = harness.split.children.indexOf(parent);
                    if (index >= 0) harness.split.children.splice(index, 1);
                    parentEl.remove();
                })
            };
            parent.children.push(leaf);
            harness.split.children.push(parent);
            restoredMasterLeaves.push(leaf);
            return leaf;
        });
        harness.workspace.getRightLeaf = vi.fn(() => null);

        const tabs = new SidebarTabsFeature(
            app as any,
            plugin as any,
            () => contextual.checkActiveBindingValidity()
        );
        await tabs.onload();
        vi.clearAllTimers();

        await tabs.applyLayout();
        await flushAll();

        expect(initialSlave.detach).toHaveBeenCalledTimes(1);
        expect(harness.workspace.getLeftLeaf).toHaveBeenCalledTimes(1);
        expect(restoredMasterLeaves).toHaveLength(1);
        expect(harness.createLeafBySplit).toHaveBeenCalledTimes(2);
        expect(harness.liveLeaves("search")).toHaveLength(1);
        expect(harness.liveLeaves("outline")).toHaveLength(1);
        expect(harness.liveLeaves("outline")[0].parent.setDimension).toHaveBeenCalledWith(58);

        tabs.onunload();
        contextual.onunload();
    });

    it("coalesces concurrent contextual split activation while setViewState is pending", async () => {
        vi.useFakeTimers();
        let releaseView!: () => void;
        const viewReady = new Promise<void>(resolve => { releaseView = resolve; });
        const setViewState = vi.fn(async () => viewReady);
        const plugin = createPlugin();
        plugin.settings.mySideBar.tabs.bindings = [
            { masterId: "search", slaveId: "outline", splitRatio: 50 }
        ];
        const harness = createContextualSplitHarness({ setViewState });
        const feature = new ContextualSplitFeature({ workspace: harness.workspace } as any, plugin as any);

        feature.onload();
        const firstActivation = feature.handleActiveLeaf(harness.masterLeaf);
        const secondActivation = feature.handleActiveLeaf(harness.masterLeaf);
        await flushAll();

        expect(harness.createLeafBySplit).toHaveBeenCalledTimes(1);
        expect(setViewState).toHaveBeenCalledTimes(1);

        releaseView();
        await Promise.all([firstActivation, secondActivation]);
        await flushAll();

        expect(harness.createLeafBySplit).toHaveBeenCalledTimes(1);
        expect(harness.liveLeaves("outline")).toHaveLength(1);

        feature.onunload();
    });

    it("honors the latest master when bindings switch during a pending activation", async () => {
        vi.useFakeTimers();
        let releaseFirst!: () => void;
        const firstViewReady = new Promise<void>(resolve => { releaseFirst = resolve; });
        const setViewState = vi.fn(async (_leaf: any, _type: string, creationIndex: number) => {
            if (creationIndex === 0) await firstViewReady;
        });
        const plugin = createPlugin();
        plugin.settings.mySideBar.tabs.bindings = [
            { masterId: "search", slaveId: "outline", splitRatio: 50 },
            { masterId: "files", slaveId: "bookmarks", splitRatio: 40 }
        ];
        const harness = createContextualSplitHarness({ setViewState });

        const filesParentEl = harness.split.containerEl.createDiv();
        const filesEl = filesParentEl.createDiv();
        (filesEl as any).isShown = () => true;
        const filesParent: any = {
            containerEl: filesParentEl,
            children: [],
            parent: harness.split,
            setDimension: vi.fn()
        };
        const filesLeaf: any = {
            view: {
                getViewType: () => "files",
                getDisplayText: () => "Files",
                icon: "folder",
                containerEl: filesEl
            },
            parent: filesParent
        };
        filesParent.children.push(filesLeaf);
        harness.split.children.push(filesParent);

        const feature = new ContextualSplitFeature({ workspace: harness.workspace } as any, plugin as any);
        feature.onload();
        await flushAll();
        expect(harness.createLeafBySplit).toHaveBeenCalledTimes(1);

        const switchBinding = feature.handleActiveLeaf(filesLeaf);
        await flushAll();
        expect(harness.createLeafBySplit).toHaveBeenCalledTimes(1);

        const staleSlave = harness.createdLeaves[0];
        delete staleSlave.view.containerEl.dataset.assistantContextualSlave;
        const pendingLeafFocus = feature.handleActiveLeaf(staleSlave);
        await flushAll();
        releaseFirst();
        await Promise.all([switchBinding, pendingLeafFocus]);
        await flushAll();

        expect(staleSlave.detach).toHaveBeenCalledTimes(1);
        expect(harness.createLeafBySplit).toHaveBeenCalledTimes(2);
        expect(harness.liveLeaves("outline")).toHaveLength(0);
        expect(harness.liveLeaves("bookmarks")).toHaveLength(1);
        expect(harness.liveLeaves("bookmarks")[0].parent.setDimension).toHaveBeenCalledWith(40);
        expect(filesParent.setDimension).toHaveBeenCalledWith(60);

        feature.onunload();
    });

    it("ignores a stale contextual activation failure after unload and a fresh load", async () => {
        vi.useFakeTimers();
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        let rejectFirst!: (reason: Error) => void;
        const firstViewReady = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
        const setViewState = vi.fn(async (_leaf: any, _type: string, creationIndex: number) => {
            if (creationIndex === 0) await firstViewReady;
        });
        const plugin = createPlugin();
        plugin.settings.mySideBar.tabs.bindings = [
            { masterId: "search", slaveId: "outline", splitRatio: 50 }
        ];
        const harness = createContextualSplitHarness({ setViewState });
        const feature = new ContextualSplitFeature({ workspace: harness.workspace } as any, plugin as any);

        feature.onload();
        await flushAll();
        const staleLeaf = harness.createdLeaves[0];
        expect(harness.createLeafBySplit).toHaveBeenCalledTimes(1);

        feature.onunload();
        expect(staleLeaf.detach).toHaveBeenCalledTimes(1);
        expect(harness.liveLeaves("outline")).toHaveLength(0);

        feature.onload();
        await flushAll();
        expect(harness.createLeafBySplit).toHaveBeenCalledTimes(2);
        expect(harness.liveLeaves("outline")).toHaveLength(1);

        rejectFirst(new Error("stale activation failed"));
        await flushAll();
        expect(staleLeaf.detach).toHaveBeenCalledTimes(1);
        expect(harness.liveLeaves("outline")).toHaveLength(1);
        expect((feature as any).activeBindings.get("left")).toBe(plugin.settings.mySideBar.tabs.bindings[0]);

        feature.onunload();
    });

    it("cleans up a failed contextual slave creation and retries successfully", async () => {
        vi.useFakeTimers();
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        let attempts = 0;
        const setViewState = vi.fn(async () => {
            attempts++;
            if (attempts === 1) throw new Error("first setViewState failed");
        });
        const plugin = createPlugin();
        plugin.settings.mySideBar.tabs.bindings = [
            { masterId: "search", slaveId: "outline", splitRatio: 50 }
        ];
        const harness = createContextualSplitHarness({ setViewState });
        const feature = new ContextualSplitFeature({ workspace: harness.workspace } as any, plugin as any);

        feature.onload();
        await flushAll();

        expect(harness.createLeafBySplit).toHaveBeenCalledTimes(1);
        const failedLeaf = harness.createdLeaves[0];
        expect(failedLeaf.detach).toHaveBeenCalledTimes(1);
        expect(failedLeaf.parent.containerEl.isConnected).toBe(false);
        expect(harness.split.children).not.toContain(failedLeaf.parent);
        expect(harness.liveLeaves("outline")).toHaveLength(0);

        await feature.handleActiveLeaf(harness.masterLeaf);
        await flushAll();

        expect(setViewState).toHaveBeenCalledTimes(2);
        expect(harness.createLeafBySplit).toHaveBeenCalledTimes(2);
        expect(harness.liveLeaves("outline")).toHaveLength(1);
        expect(harness.liveLeaves("outline")[0].view.containerEl.dataset.assistantContextualSlave).toBe("true");
        expect(harness.split.children).toHaveLength(2);

        feature.onunload();
    });

    it("removes contextual split hidden-header class when cleaning slave leaves", async () => {
        const plugin = createPlugin();
        const splitEl = document.createElement("div");
        splitEl.addClass("mod-left-split");
        const parentEl = splitEl.createDiv({ cls: "contextual-split-hidden-header" });
        const leafEl = parentEl.createDiv();
        leafEl.dataset.assistantContextualSlave = "true";
        document.body.appendChild(splitEl);

        const leaf = {
            view: {
                getViewType: () => "outline",
                containerEl: leafEl
            },
            detach: vi.fn(),
            parent: {
                containerEl: parentEl
            }
        };
        const workspace = createWorkspace();
        workspace.leftSplit = { children: [leaf], containerEl: splitEl };
        const feature = new ContextualSplitFeature({ workspace } as any, plugin as any);

        await feature.cleanupSplit({ masterId: "search", slaveId: "outline" }, "left");

        expect(parentEl.hasClass("contextual-split-hidden-header")).toBe(false);
        expect(leaf.detach).toHaveBeenCalledTimes(1);
    });
});
