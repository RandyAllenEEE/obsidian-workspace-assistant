import { App, WorkspaceLeaf, Notice } from "obsidian";
import AssistantPlugin from "../../main";
import { SidebarTabElement } from "../../settings";
import { t } from "../../i18n/helpers";

const IGNORED_VIEW_ICONS = new Set([
    "",
    "help",
    "help-circle",
    "lucide-help-circle",
    "circle-help",
    "lucide-circle-help",
    "alert-triangle",
    "lucide-alert-triangle",
    "file-question",
    "lucide-file-question",
    "ghost",
    "lucide-ghost"
]);

function getSidebarTabIcon(leaf: WorkspaceLeaf): string | undefined {
    const view = leaf.view as any;
    const icon = typeof view.getIcon === "function"
        ? view.getIcon()
        : view.icon;

    if (typeof icon !== "string") return undefined;

    const normalizedIcon = icon.trim();
    if (!normalizedIcon || IGNORED_VIEW_ICONS.has(normalizedIcon)) return undefined;

    return normalizedIcon;
}

type ScanOptions = {
    preserveHidden?: boolean;
};

type WorkspaceParentWithChildren = {
    children?: unknown[];
};

export class SidebarTabsFeature {
    app: App;
    plugin: AssistantPlugin;

    scanTimer: number | null = null;
    private isLoaded = false;
    private refreshTimer: number | null = null;
    private isRefreshing = false;
    private refreshRequestId = 0;
    private appliedRefreshId = 0;
    private loadGeneration = 0;

    constructor(app: App, plugin: AssistantPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    async onload() {
        if (this.isLoaded || !this.plugin.settings.mySideBar.tabs?.enabled) return;
        this.isLoaded = true;
        const generation = ++this.loadGeneration;

        const scheduleScan = () => {
            if (generation !== this.loadGeneration) return;
            if (!this.isLoaded) return;
            if (this.scanTimer !== null) return;
            // Initial delayed scan/apply to let other plugins load
            this.scanTimer = window.setTimeout(() => {
                if (generation !== this.loadGeneration) return;
                if (!this.isLoaded) return;
                void this.scanAndApply({ preserveHidden: true }).catch(e => console.error("Assistant: Failed to scan sidebar tabs", e));
                this.scanTimer = null;
            }, 1000);
        };

        if (this.app.workspace.layoutReady) scheduleScan();
        else this.app.workspace.onLayoutReady(scheduleScan);
    }

    async scanAndApply(options: ScanOptions = {}) {
        if (!this.isLoaded || !this.plugin.settings.mySideBar.tabs.enabled) return;

        // 1. Scan current tabs to populate settings with any new ones
        await this.scan(options);
        if (!this.isLoaded || !this.plugin.settings.mySideBar.tabs.enabled) return;

        // 2. Apply saved layout
        await this.applyLayout();
    }

    async scan(options: ScanOptions = {}) {
        const settings = this.plugin.settings.mySideBar.tabs;
        let changed = false;
        let order = 0;
        const slaveIds = new Set((settings.bindings || []).map(binding => binding.slaveId));

        const processSplit = (split: any, side: 'left' | 'right') => {
            if (!split) return;
            // Iterate all leaves within this sidebar split
            this.iterateLeavesInSplit(split, (leaf) => {
                const viewType = leaf.view.getViewType();
                // Ignore Contextual Slaves
                if (leaf.view.containerEl.dataset.assistantContextualSlave === "true") return;

                const icon = getSidebarTabIcon(leaf);

                if (slaveIds.has(viewType)) {
                    if (!settings.elements[viewType]) {
                        settings.elements[viewType] = {
                            id: viewType,
                            side: side,
                            visible: false,
                            order: order,
                            icon: icon
                        };
                        changed = true;
                    } else if (icon && settings.elements[viewType].icon !== icon) {
                        settings.elements[viewType].icon = icon;
                        changed = true;
                    }
                    return;
                }

                if (!settings.elements[viewType]) {
                    settings.elements[viewType] = {
                        id: viewType,
                        side: side,
                        visible: true,
                        order: order,
                        icon: icon
                    };
                    changed = true;
                } else {
                    const element = settings.elements[viewType];

                    // Startup layout restore can briefly expose hidden tabs before we apply saved layout.
                    if (options.preserveHidden && !element.visible) {
                        if (icon && element.icon !== icon) {
                            element.icon = icon;
                            changed = true;
                        }
                        return;
                    }

                    if (element.side !== side) {
                        element.side = side;
                        changed = true;
                    }
                    if (!element.visible) {
                        element.visible = true;
                        changed = true;
                    }
                    if (element.order !== order) {
                        element.order = order;
                        changed = true;
                    }
                    if (icon && element.icon !== icon) {
                        element.icon = icon;
                        changed = true;
                    }
                }

                order++;
            });
        };

        processSplit(this.app.workspace.leftSplit, 'left');
        processSplit(this.app.workspace.rightSplit, 'right');

        for (const binding of settings.bindings || []) {
            const master = settings.elements[binding.masterId];
            const slave = settings.elements[binding.slaveId];
            if (!master || !slave) continue;

            if (slave.visible) {
                slave.visible = false;
                changed = true;
            }
            if (slave.side !== master.side) {
                slave.side = master.side;
                changed = true;
            }
            if (slave.order !== master.order + 0.01) {
                slave.order = master.order + 0.01;
                changed = true;
            }
        }

        if (changed) {
            await this.plugin.saveSettings();
        }
        return settings.elements;
    }

    async applyLayout() {
        const settings = this.plugin.settings.mySideBar.tabs;
        if (!this.isLoaded || !settings.enabled) return;

        const elements = Object.values(settings.elements);
        const leftItems = elements.filter(e => e.side === 'left' && e.visible).sort((a, b) => a.order - b.order);
        const rightItems = elements.filter(e => e.side === 'right' && e.visible).sort((a, b) => a.order - b.order);

        // Steady-State Check: If current layout matches target, do nothing.
        // This preserves plugin leaf instances (like Quiet Outline) if they are already correct.
        const getSplitIds = (split: any) => {
            if (!split) return [];
            const ids: string[] = [];
            this.iterateLeavesInSplit(split, (leaf) => {
                if (leaf.view.containerEl.dataset.assistantContextualSlave === "true") return;
                ids.push(leaf.view.getViewType());
            });
            return ids;
        };

        const currentLeft = getSplitIds(this.app.workspace.leftSplit);
        const currentRight = getSplitIds(this.app.workspace.rightSplit);

        const targetLeftIds = leftItems.map(e => e.id);
        const targetRightIds = rightItems.map(e => e.id);

        // JSON stringify is a quick way to check array equality (order matters)
        const isLeftMatch = JSON.stringify(currentLeft) === JSON.stringify(targetLeftIds);
        const isRightMatch = JSON.stringify(currentRight) === JSON.stringify(targetRightIds);

        if (isLeftMatch && isRightMatch) {
            // Layout is already perfect. Do not disturb.
            return;
        }

        const viewStates: { [id: string]: any } = {};
        const leavesToDetach: WorkspaceLeaf[] = [];

        // Helper to capture state and mark for detach
        const processSide = (split: any, isMatch: boolean) => {
            if (isMatch) return; // Don't touch this side if it matches
            if (!split) return;

            this.iterateLeavesInSplit(split, (leaf) => {
                const type = leaf.view.getViewType();
                // If it's a managed type, we capture and detach.
                // If it's unmanaged (new plugin appeared after scan?), we might detach it if we are strict.
                // But `scan` runs right before `applyLayout`, so everything should be managed.
                if (settings.elements[type]) {
                    viewStates[type] = leaf.getViewState();
                    leavesToDetach.push(leaf);
                }
            });
        };

        // If Left mismatches, we rebuild Left. If Right mismatches, rebuild Right.
        processSide(this.app.workspace.leftSplit, isLeftMatch);
        processSide(this.app.workspace.rightSplit, isRightMatch);

        if (!this.isLoaded || !settings.enabled) return;
        leavesToDetach.forEach(leaf => leaf.detach());

        // Rebuild only needed sides
        if (!this.isLoaded || !settings.enabled) return;
        if (!isLeftMatch) await this.openInSplit(leftItems, 'left', viewStates);
        if (!this.isLoaded || !settings.enabled) return;
        if (!isRightMatch) await this.openInSplit(rightItems, 'right', viewStates);
    }

    async openInSplit(items: SidebarTabElement[], side: 'left' | 'right', viewStates: { [id: string]: any }) {
        for (const item of items) {
            if (!this.isLoaded || !this.plugin.settings.mySideBar.tabs.enabled) return;
            const leaf = side === 'left'
                ? this.app.workspace.getLeftLeaf(false)
                : this.app.workspace.getRightLeaf(false);

            if (!leaf) {
                console.error(`Assistant: Failed to create ${side} sidebar leaf for ${item.id}`);
                continue;
            }

            let state = viewStates[item.id];
            if (!state) {
                // Try default create if state missing
                state = { type: item.id };
            }

            try {
                await leaf.setViewState(state);
                if (!this.isLoaded || !this.plugin.settings.mySideBar.tabs.enabled) {
                    leaf.detach();
                    return;
                }
            } catch (e) {
                console.error(`Assistant: Failed to restore tab ${item.id}`, e);
                leaf.detach();
            }
        }
    }

    // Helper to toggle side or visibility
    async updateTab(id: string, updates: Partial<SidebarTabElement>) {
        const settings = this.plugin.settings.mySideBar.tabs;
        if (settings.elements[id]) {
            const oldSide = settings.elements[id].side;

            Object.assign(settings.elements[id], updates);

            // Binding Check: If side changed, remove any conflicting bindings
            if (updates.side && updates.side !== oldSide && settings.bindings) {
                const initialLength = settings.bindings.length;
                settings.bindings = settings.bindings.filter(b => {
                    // Check if this tab is part of a binding
                    if (b.masterId === id || b.slaveId === id) {
                        const masterSide = settings.elements[b.masterId]?.side;
                        const slaveSide = settings.elements[b.slaveId]?.side;
                        // Filter out if sides don't match (one of them just changed)
                        return masterSide === slaveSide;
                    }
                    return true;
                });

                if (settings.bindings.length < initialLength) {
                    new Notice(t('Binding Removed'));
                }
            }

            await this.plugin.saveSettings();
            await this.applyLayout(); // Immediate reflection
        }
    }

    onunload() {
        this.isLoaded = false;
        this.loadGeneration++;
        if (this.scanTimer) {
            window.clearTimeout(this.scanTimer);
            this.scanTimer = null;
        }
        if (this.refreshTimer !== null) {
            window.clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }
        this.isRefreshing = false;
        this.refreshRequestId = 0;
        this.appliedRefreshId = 0;
    }

    refreshAfterSoftStartup() {
        if (!this.isLoaded || !this.plugin.settings.mySideBar.tabs.enabled) return;
        this.refreshRequestId++;
        if (this.isRefreshing) {
            return;
        }
        if (this.refreshTimer !== null) {
            window.clearTimeout(this.refreshTimer);
        }
        this.refreshTimer = window.setTimeout(() => {
            this.refreshTimer = null;
            void this.runSoftStartupRefresh().catch(e => console.error("Assistant: Failed to refresh sidebar tabs", e));
        }, 250);
    }

    private async runSoftStartupRefresh() {
        if (!this.isLoaded || !this.plugin.settings.mySideBar.tabs.enabled) return;

        if (this.isRefreshing) {
            return;
        }

        this.isRefreshing = true;

        try {
            while (
                this.appliedRefreshId < this.refreshRequestId &&
                this.isLoaded &&
                this.plugin.settings.mySideBar.tabs.enabled
            ) {
                this.appliedRefreshId = this.refreshRequestId;
                await this.scanAndApply({ preserveHidden: true });
            }
        } finally {
            this.isRefreshing = false;
            if (
                this.appliedRefreshId < this.refreshRequestId &&
                this.isLoaded &&
                this.plugin.settings.mySideBar.tabs.enabled
            ) {
                void this.runSoftStartupRefresh().catch(e => console.error("Assistant: Failed to refresh sidebar tabs", e));
            }
        }
    }

    private iterateLeavesInSplit(split: unknown, callback: (leaf: WorkspaceLeaf) => void) {
        const visit = (item: unknown) => {
            const maybeLeaf = item as Partial<WorkspaceLeaf>;
            if (maybeLeaf.view && typeof maybeLeaf.view.getViewType === "function") {
                callback(maybeLeaf as WorkspaceLeaf);
                return;
            }

            const parent = item as WorkspaceParentWithChildren;
            parent.children?.forEach(child => visit(child));
        };

        visit(split);
    }
}
