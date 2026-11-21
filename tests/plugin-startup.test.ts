import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginsManager } from '../src/plugins/manager';
import { LoadingMethod, normalizeSettings } from '../src/settings';

function harness(type = LoadingMethod.short) {
    vi.useFakeTimers();
    const plugin = {
        manifest: { id: 'obsidian-assistant' }, settings: normalizeSettings(),
        saveSettings: vi.fn(async () => undefined),
        statusBarManager: { refreshAfterSoftStartup: vi.fn() },
        sidebarManager: { refreshAfterSoftStartup: vi.fn() }
    };
    Object.assign(plugin.settings.myPlugins.desktop, {
        shortDelaySeconds: 0, delayBetweenPlugins: 0,
        plugins: { alpha: { startupType: type }, beta: { startupType: type } }
    });
    const plugins = {
        enabledPlugins: new Set<string>(),
        manifests: { alpha: { id: 'alpha', name: 'Alpha' }, beta: { id: 'beta', name: 'Beta' } },
        plugins: {} as Record<string, { _loaded?: boolean }>,
        loadingPluginId: null as string | null,
        enablePlugin: vi.fn(async (id: string) => { plugins.plugins[id] = { _loaded: true }; return true; }),
        enablePluginAndSave: vi.fn(async (id: string) => {
            const ok = await plugins.enablePlugin(id);
            if (ok) plugins.enabledPlugins.add(id);
            return ok;
        }),
        disablePlugin: vi.fn(async (id: string) => { delete plugins.plugins[id]; }),
        disablePluginAndSave: vi.fn(async (id: string) => {
            plugins.enabledPlugins.delete(id); delete plugins.plugins[id];
        })
    };
    const manager = new PluginsManager({ plugins, workspace: { layoutReady: true } } as any, plugin as any);
    return { manager, plugins, plugin };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('managed plugin startup failures', () => {
    it('cleans a false-result partial instance, continues the queue and permits retry', async () => {
        const { manager, plugins, plugin } = harness();
        const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        plugins.enablePlugin.mockImplementationOnce(async id => {
            plugins.plugins[id] = { _loaded: true };
            return false;
        });
        await manager.onload(); await vi.runAllTimersAsync();
        expect(plugins.disablePlugin).toHaveBeenCalledWith('alpha');
        expect(plugins.plugins.alpha).toBeUndefined();
        expect(plugins.plugins.beta?._loaded).toBe(true);
        expect(log).toHaveBeenCalled();
        expect(plugin.statusBarManager.refreshAfterSoftStartup).toHaveBeenCalledTimes(1);
        const retry = manager.setPluginStartup('alpha');
        await vi.runAllTimersAsync(); await retry;
        expect(plugins.plugins.alpha?._loaded).toBe(true);
        expect(plugin.statusBarManager.refreshAfterSoftStartup).toHaveBeenCalledTimes(2);
        expect(plugins.disablePluginAndSave).not.toHaveBeenCalled();
    });

    it('cleans a thrown initialization failure on the instant path without saving a disable', async () => {
        const { manager, plugins, plugin } = harness(LoadingMethod.instant);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        plugins.enablePlugin.mockImplementationOnce(async id => {
            plugins.plugins[id] = { _loaded: true };
            throw new Error('onload failed');
        });
        await manager.onload(); await vi.runAllTimersAsync();
        expect(plugins.plugins.alpha).toBeUndefined();
        expect(plugins.enabledPlugins.has('alpha')).toBe(false);
        expect(plugins.plugins.beta?._loaded).toBe(true);
        expect(plugin.sidebarManager.refreshAfterSoftStartup).toHaveBeenCalledTimes(1);
        expect(plugins.disablePluginAndSave).not.toHaveBeenCalled();
    });

    it('preserves an existing instance when enabling is refused before a new load', async () => {
        const { manager, plugins } = harness(LoadingMethod.instant);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const existing = { _loaded: true };
        plugins.plugins.alpha = existing;
        plugins.enablePluginAndSave.mockResolvedValueOnce(false);
        await manager.onload(); await vi.runAllTimersAsync();
        expect(plugins.plugins.alpha).toBe(existing);
        expect(plugins.disablePlugin).not.toHaveBeenCalled();
    });

    it('waits for native startup to finish before starting its own plugin lifecycle', async () => {
        const { manager, plugins } = harness(LoadingMethod.instant);
        plugins.loadingPluginId = 'obsidian-assistant';
        await manager.onload();
        await vi.advanceTimersByTimeAsync(100);
        expect(plugins.enablePluginAndSave).not.toHaveBeenCalled();
        plugins.loadingPluginId = null;
        await vi.runAllTimersAsync();
        expect(plugins.enablePluginAndSave).toHaveBeenCalledTimes(2);
    });
});
