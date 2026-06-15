import { describe, expect, it } from "vitest";
import { createDefaultSettings, LoadingMethod, normalizeSettings } from "../src/settings";

describe("settings normalization", () => {
    it("fills missing status bar defaults from old partial settings", () => {
        const settings = normalizeSettings({
            myStatusBar: {
                enabled: false
            } as any
        });

        expect(settings.myStatusBar.enabled).toBe(false);
        expect(settings.myStatusBar.status).toEqual({});
        expect(settings.myStatusBar.version).toBe("0.0.1");
    });

    it("clamps contextual split ratios and preserves existing bindings", () => {
        const settings = normalizeSettings({
            mySideBar: {
                tabs: {
                    bindings: [
                        { masterId: "search", slaveId: "outline", splitRatio: 2 },
                        { masterId: "files", slaveId: "bookmarks", splitRatio: 120 }
                    ]
                }
            } as any
        });

        expect(settings.mySideBar.tabs.bindings[0].splitRatio).toBe(10);
        expect(settings.mySideBar.tabs.bindings[1].splitRatio).toBe(90);
    });

    it("does not share nested default objects between settings instances", () => {
        const first = createDefaultSettings();
        const second = createDefaultSettings();

        first.myPlugins.desktop.plugins.example = { startupType: "short" as any };
        first.mySideBar.ribbon.elements.example = {
            id: "example",
            name: "Example",
            visible: true,
            order: 1
        };

        expect(second.myPlugins.desktop.plugins.example).toBeUndefined();
        expect(second.mySideBar.ribbon.elements.example).toBeUndefined();
    });

    it("ignores malformed nested records without throwing", () => {
        const settings = normalizeSettings({
            myPlugins: {
                desktop: {
                    plugins: "bad"
                }
            },
            myStatusBar: {
                status: "bad"
            },
            mySideBar: {
                ribbon: {
                    elements: "bad"
                },
                tabs: {
                    elements: "bad",
                    bindings: [
                        null,
                        { masterId: "search", slaveId: "outline", splitRatio: 500 },
                        { masterId: "", slaveId: "ignored" }
                    ]
                }
            }
        } as any);

        expect(settings.myPlugins.desktop.plugins).toEqual({});
        expect(settings.myStatusBar.status).toEqual({});
        expect(settings.mySideBar.ribbon.elements).toEqual({});
        expect(settings.mySideBar.tabs.elements).toEqual({});
        expect(settings.mySideBar.tabs.bindings).toHaveLength(1);
        expect(settings.mySideBar.tabs.bindings[0].splitRatio).toBe(90);
    });

    it("filters invalid plugin startup methods during normalization", () => {
        const settings = normalizeSettings({
            myPlugins: {
                desktop: {
                    defaultStartupType: "bad",
                    plugins: {
                        bad: { startupType: "later" },
                        good: { startupType: LoadingMethod.short }
                    }
                }
            }
        } as any);

        expect(settings.myPlugins.desktop.defaultStartupType).toBeNull();
        expect(settings.myPlugins.desktop.plugins.bad).toBeUndefined();
        expect(settings.myPlugins.desktop.plugins.good.startupType).toBe(LoadingMethod.short);
    });
});
