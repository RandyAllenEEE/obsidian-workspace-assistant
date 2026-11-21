import { App, Platform } from "obsidian";
import AssistantPlugin from "../../main";
import { RibbonElement } from "../types";
import { DEFAULT_MY_SIDEBAR_SETTINGS, RibbonSettings } from "../../settings";
import { getElementSvgIcon } from "../../utils/icon";

export class RibbonFeature {
    app: App;
    plugin: AssistantPlugin;
    ribbonActions: HTMLElement | null = null;
    ribbonSettings: HTMLElement | null = null;
    observer: MutationObserver | null = null;

    // Debounce timer for observer
    private observerTimer: number | null = null;
    private initTimer: number | null = null;
    private isInternalChange = false;
    private isLoaded = false;
    private loadGeneration = 0;
    private originalPlacements = new Map<HTMLElement, { parent: HTMLElement, nextSibling: ChildNode | null, marker: Comment }>();

    constructor(app: App, plugin: AssistantPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    get settings(): RibbonSettings {
        if (!this.plugin.settings.mySideBar.ribbon) {
            this.plugin.settings.mySideBar.ribbon = {
                ...DEFAULT_MY_SIDEBAR_SETTINGS.ribbon,
                elements: {}
            };
        }
        return this.plugin.settings.mySideBar.ribbon;
    }

    async onload() {
        if (this.isLoaded || !this.settings.enabled) return;
        this.isLoaded = true;
        const generation = ++this.loadGeneration;

        const runInit = () => {
            if (generation !== this.loadGeneration) return;
            if (!this.isLoaded) return;
            this.init();
        };

        if (this.app.workspace.layoutReady) runInit();
        else this.app.workspace.onLayoutReady(runInit);
    }

    onunload() {
        this.isLoaded = false;
        this.loadGeneration++;
        if (this.initTimer !== null) {
            window.clearTimeout(this.initTimer);
            this.initTimer = null;
        }
        if (this.observerTimer !== null) {
            window.clearTimeout(this.observerTimer);
            this.observerTimer = null;
        }
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        const resetEl = (el: HTMLElement) => {
            el.style.removeProperty("order");
            el.style.removeProperty("display");
            el.removeClass("assistant-ribbon-hidden");
        };

        this.ribbonActions?.removeClass("assistant-ribbon-loading");
        if (this.ribbonActions) Array.from(this.ribbonActions.children).forEach(el => resetEl(el as HTMLElement));
        if (this.ribbonSettings) Array.from(this.ribbonSettings.children).forEach(el => resetEl(el as HTMLElement));
        this.restoreOriginalPlacements();
        this.ribbonActions = null;
        this.ribbonSettings = null;
    }

    private init() {
        if (!this.isLoaded) return;
        if (this.initTimer !== null || this.observer !== null) return;
        const ribbon = document.querySelector(".workspace-ribbon.mod-left");
        if (!ribbon) return;

        this.ribbonActions = ribbon.querySelector(".side-dock-actions") as HTMLElement;
        this.ribbonSettings = ribbon.querySelector(".side-dock-settings") as HTMLElement;

        if (!this.ribbonActions && !this.ribbonSettings) return;

        // Initial process - HIDING
        this.ribbonActions?.addClass("assistant-ribbon-loading");

        // Determine delay
        const configuredDelay = this.plugin.settings.mySideBar.ribbon.ribbonDisplayDelay || 1000;
        let delayMs = configuredDelay;

        if (this.plugin.settings.myPlugins.enabled) {
            // Lazy Load Logic
            const deviceSettings = this.plugin.settings.myPlugins.dualConfigs && Platform.isMobile
                ? (this.plugin.settings.myPlugins.mobile || this.plugin.settings.myPlugins.desktop)
                : this.plugin.settings.myPlugins.desktop;

            const maxDelay = Math.max(deviceSettings.shortDelaySeconds, deviceSettings.longDelaySeconds);
            delayMs = (maxDelay * 1000) + configuredDelay; // Max Delay + Configured Buffer
        } else {
            // Manual Fallback
            delayMs = configuredDelay;
        }

        // Set timeout to reveal
        this.initTimer = window.setTimeout(async () => {
            this.initTimer = null;
            if (!this.isLoaded) return;
            await this.processRibbon();
            if (!this.isLoaded) return;
            this.ribbonActions?.removeClass("assistant-ribbon-loading");

            // Start observing both AFTER initial load is done
            this.observer = new MutationObserver((mutations) => {
                if (this.isInternalChange) return;

                let shouldUpdate = false;
                for (const mutation of mutations) {
                    if (mutation.type === "childList") {
                        shouldUpdate = true;
                        break;
                    }
                }

                if (shouldUpdate) {
                    this.scheduleProcess();
                }
            });

            if (!this.isLoaded) return;
            if (this.ribbonActions) this.observer.observe(this.ribbonActions, { childList: true });
            if (this.ribbonSettings) this.observer.observe(this.ribbonSettings, { childList: true });

        }, delayMs);


    }

    private scheduleProcess() {
        if (!this.isLoaded) return;
        if (this.observerTimer !== null) {
            window.clearTimeout(this.observerTimer);
        }
        this.observerTimer = window.setTimeout(() => {
            if (!this.isLoaded) return;
            void this.processRibbon().catch(e => console.error("Assistant: Failed to process ribbon", e));
            this.observerTimer = null;
        }, 200);
    }

    async processRibbon() {
        if (!this.isLoaded || (!this.ribbonActions && !this.ribbonSettings)) return;

        // Gather current DOM elements from both lists
        const actionsChildren = this.ribbonActions ? Array.from(this.ribbonActions.children) as HTMLElement[] : [];
        const settingsChildren = this.ribbonSettings ? Array.from(this.ribbonSettings.children) as HTMLElement[] : [];

        const domElementsMap = new Map<string, HTMLElement>();

        // Process top actions
        actionsChildren.forEach(el => {
            const ariaLabel = el.getAttribute("aria-label");
            if (ariaLabel && !el.classList.contains("assistant-ghost")) {
                domElementsMap.set(ariaLabel, el);
            }
        });

        settingsChildren.forEach(el => {
            const ariaLabel = el.getAttribute("aria-label");
            if (ariaLabel && !el.classList.contains("assistant-ghost")) {
                domElementsMap.set(ariaLabel, el);
            }
        });

        const settingsElements = this.settings.elements;

        // 1. Check for new elements
        let maxOrder = 0;
        Object.values(settingsElements).forEach(el => {
            if (el.order > maxOrder) maxOrder = el.order;
        });

        let changed = false;
        for (const [id, el] of domElementsMap.entries()) {
            if (!settingsElements[id]) {
                maxOrder++;
                const newEl: RibbonElement = {
                    id: id,
                    name: id,
                    visible: true,
                    order: maxOrder,
                    icon: getElementSvgIcon(el)
                };
                settingsElements[id] = newEl;
                changed = true;
            } else {
                // Update icon
                const icon = getElementSvgIcon(el);
                if (icon && settingsElements[id].icon !== icon) {
                    settingsElements[id].icon = icon;
                    changed = true;
                }
            }
        }

        // 3. Apply Order and Visibility
        this.isInternalChange = true;

        try {
            // We will move all managed elements to the top 'ribbonActions' container to create a unified list.
            // Original DOM positions are remembered so unloading the feature restores Obsidian's structure.

            const sortedIDs = Object.keys(settingsElements).sort((a, b) => settingsElements[a].order - settingsElements[b].order);

            for (const id of sortedIDs) {
                const setting = settingsElements[id];
                const el = domElementsMap.get(id);
                if (el) {
                    // Determine visibility
                    if (setting.visible) {
                        el.style.setProperty("display", "flex", "important");
                        el.removeClass("assistant-ribbon-hidden");
                    } else {
                        el.style.setProperty("display", "none", "important");
                        el.addClass("assistant-ribbon-hidden");
                    }

                    // Apply Order (Physical DOM order)
                    if (this.ribbonActions) {
                        this.rememberPlacement(el);
                        this.ribbonActions.appendChild(el);
                    }
                }
            }
        } finally {
            this.isInternalChange = false;
        }

        if (changed) {
            await this.plugin.saveSettings();
        }
    }

    async toggleVisibility(id: string) {
        if (this.settings.elements[id]) {
            this.settings.elements[id].visible = !this.settings.elements[id].visible;
            await this.plugin.saveSettings();
            await this.processRibbon();
        }
    }

    async saveOrder(newOrder: string[]) {
        newOrder.forEach((id, index) => {
            if (this.settings.elements[id]) {
                this.settings.elements[id].order = index;
            }
        });
        await this.plugin.saveSettings();
        await this.processRibbon();
    }

    refreshAfterSoftStartup() {
        if (!this.isLoaded) return;
        if (this.initTimer !== null) return;
        if (!this.ribbonActions && !this.ribbonSettings) this.init();
        else this.scheduleProcess();
    }

    private rememberPlacement(el: HTMLElement) {
        if (this.originalPlacements.has(el) || !el.parentElement) return;
        const parent = el.parentElement;
        const marker = document.createComment("obsidian-workspace-assistant-ribbon-placement");
        parent.insertBefore(marker, el);
        this.originalPlacements.set(el, {
            parent,
            nextSibling: el.nextSibling,
            marker
        });
    }

    private restoreOriginalPlacements() {
        this.originalPlacements.forEach((placement, el) => {
            if (!el.isConnected) {
                placement.marker.remove();
                return;
            }

            if (placement.marker.parentNode) {
                placement.marker.parentNode.insertBefore(el, placement.marker);
                placement.marker.remove();
                return;
            }

            if (!placement.parent.isConnected || !el.isConnected) return;
            const nextSibling = placement.nextSibling?.parentNode === placement.parent ? placement.nextSibling : null;
            placement.parent.insertBefore(el, nextSibling);
        });
        this.originalPlacements.clear();
    }
}
