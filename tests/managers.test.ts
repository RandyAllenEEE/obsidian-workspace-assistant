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
        manifest: { id: "obsidian-assistant" },
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
        const obsidianPlugins = {
            enabledPlugins: new Set<string>(),
            manifests: { foo: { id: "foo", name: "Foo" } },
            plugins: {},
            disablePluginAndSave: vi.fn(async () => undefined),
            enablePluginAndSave: vi.fn(() => new Promise<void>(resolve => { releaseEnable = resolve; })),
            enablePlugin: vi.fn(async () => undefined)
        };
        const app = { plugins: obsidianPlugins };
        const manager = new PluginsManager(app as any, plugin as any);

        await manager.onload();
        await flush();
        expect(obsidianPlugins.enablePluginAndSave).toHaveBeenCalledTimes(1);

        plugin.settings.myPlugins.desktop.plugins.foo = { startupType: LoadingMethod.disabled };
        await manager.setPluginStartup("foo");
        expect(obsidianPlugins.disablePluginAndSave).toHaveBeenCalledTimes(1);

        if (releaseEnable) releaseEnable();
        await flushAll();

        expect(plugin.statusBarManager.refreshAfterSoftStartup).not.toHaveBeenCalled();
        expect(plugin.sidebarManager.refreshAfterSoftStartup).not.toHaveBeenCalled();
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
