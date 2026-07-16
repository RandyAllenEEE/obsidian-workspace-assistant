import { App, WorkspaceLeaf, WorkspaceItem, setIcon, debounce, EventRef } from "obsidian";
import AssistantPlugin from "../../main";
import { SidebarBinding } from "../../settings";
import { renderIconLike } from "../../utils/icon";

type WorkspaceParentWithChildren = {
    children?: unknown[];
};

type SidebarSide = 'left' | 'right';

export class ContextualSplitFeature {
    app: App;
    plugin: AssistantPlugin;

    // Store original visual states of master tabs: { "side-viewType": { icon: string, title: string } }
    // Key format: "left-viewType" or "right-viewType" to support same viewType on both sidebars
    private originalStates: Map<string, { icon: string, title: string }> = new Map();
    // Support independent active splits for left and right sidebars
    private activeBindings: Map<SidebarSide, SidebarBinding> = new Map();
    private sideOperationQueues: Map<SidebarSide, Promise<void>> = new Map();
    private reconciliationQueued: Set<SidebarSide> = new Set();
    private pendingSlaveLeaves: Map<SidebarSide, WorkspaceLeaf> = new Map();
    private preferredMasterLeaves: Map<SidebarSide, { binding: SidebarBinding, leaf: WorkspaceLeaf }> = new Map();
    private listeners: EventRef[] = [];
    private observer: MutationObserver | null = null;
    private isLoaded = false;
    private loadGeneration = 0;

    constructor(app: App, plugin: AssistantPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    onload() {
        if (this.isLoaded) return;
        this.isLoaded = true;
        const generation = ++this.loadGeneration;

        // MutationObserver to automatically apply styles when tabs are rendered
        this.observer = new MutationObserver(debounce(() => {
            if (!this.isLoaded) return;
            this.applyAllMasquerades();
        }, 50));

        const runInit = () => {
            if (generation !== this.loadGeneration) return;
            if (!this.isLoaded) return;
            this.cleanOrphans();
            // observe left and right splits
            const leftSplit = this.app.workspace.leftSplit;
            const rightSplit = this.app.workspace.rightSplit;

            if (leftSplit && (leftSplit as any).containerEl) {
                this.observer?.observe((leftSplit as any).containerEl, { childList: true, subtree: true });
            }
            if (rightSplit && (rightSplit as any).containerEl) {
                this.observer?.observe((rightSplit as any).containerEl, { childList: true, subtree: true });
            }

            this.applyAllMasquerades();
            void this.checkActiveBindingValidity();
        };

        if (this.app.workspace.layoutReady) {
            runInit();
        } else {
            this.app.workspace.onLayoutReady(() => {
                runInit();
            });
        }

        // Re-apply masquerade and check validity on layout changes
        this.listeners.push(
            this.app.workspace.on('layout-change', debounce(() => {
                if (!this.isLoaded) return;
                this.applyAllMasquerades();
                void this.checkActiveBindingValidity();
            }, 200))
        );

        this.listeners.push(
            this.app.workspace.on('resize', debounce(() => {
                if (!this.isLoaded) return;
                this.saveSplitState();
            }, 500))
        );

        this.listeners.push(
            this.app.workspace.on('active-leaf-change', debounce((leaf) => {
                if (this.isLoaded && leaf) void this.handleActiveLeaf(leaf);
            }, 50, true))
        );
    }

    onunload() {
        this.isLoaded = false;
        this.loadGeneration++;
        this.reconciliationQueued.clear();
        this.sideOperationQueues.clear();
        this.preferredMasterLeaves.clear();
        this.listeners.forEach(ref => this.app.workspace.offref(ref));
        this.listeners = [];

        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        this.pendingSlaveLeaves.forEach(leaf => {
            this.removeHiddenHeader(leaf);
            leaf.detach();
        });
        this.pendingSlaveLeaves.clear();

        // Cleanup all active splits
        this.activeBindings.forEach((binding, side) => {
            this.cleanupSplit(binding, side);
        });
        this.activeBindings.clear();
        this.cleanOrphans();
        // Restore all visuals
        const bindings = this.plugin.settings.mySideBar.tabs.bindings || [];
        bindings.forEach(b => {
            const masterLeaves = this.findLeavesByType(b.masterId);
            masterLeaves.forEach(l => this.restoreVisuals(l, b.masterId));
        });
    }

    cleanOrphans() {
        const removeOrphans = (split: any) => {
            if (!split) return;
            const toDetach: WorkspaceLeaf[] = [];
            this.iterateLeavesInSplit(split, (leaf: WorkspaceLeaf) => {
                if (leaf.view.containerEl.dataset.assistantContextualSlave === "true") {
                    toDetach.push(leaf);
                }
            });
            toDetach.forEach(l => {
                this.removeHiddenHeader(l);
                l.detach();
            });
        };
        removeOrphans(this.app.workspace.leftSplit);
        removeOrphans(this.app.workspace.rightSplit);
    }

    applyAllMasquerades() {
        const bindings = this.plugin.settings.mySideBar.tabs.bindings || [];
        bindings.forEach(b => {
            const masterLeaves = this.findLeavesByType(b.masterId);
            masterLeaves.forEach(leaf => this.applyVisualOverride(leaf, b));
        });
    }



    /**
     * Get a unique state key for a leaf that includes its sidebar side
     * This prevents conflicts when the same viewType exists on both sidebars
     */
    private getStateKey(leaf: WorkspaceLeaf): string {
        const viewType = leaf.view.getViewType();
        const side = this.getLeafSide(leaf);
        return `${side}-${viewType}`;
    }

    /**
     * Determine which sidebar a leaf belongs to using DOM traversal
     */
    private getLeafSide(leaf: WorkspaceLeaf): SidebarSide | 'unknown' {
        const container = leaf.view?.containerEl;
        if (!container) return 'unknown';

        if (container.closest('.mod-left-split')) return 'left';
        if (container.closest('.mod-right-split')) return 'right';

        return 'unknown';
    }

    async handleActiveLeaf(leaf: WorkspaceLeaf) {
        if (!this.plugin.settings.mySideBar.tabs?.enabled) return;
        const side = this.getLeafSide(leaf);
        if (side === 'unknown') return;

        const viewType = leaf.view.getViewType();
        const binding = (this.plugin.settings.mySideBar.tabs.bindings || [])
            .find(candidate => candidate.masterId === viewType);
        if (binding) {
            this.preferredMasterLeaves.set(side, { binding, leaf });
        } else if (
            leaf.view.containerEl.dataset.assistantContextualSlave !== "true" &&
            this.pendingSlaveLeaves.get(side) !== leaf
        ) {
            this.preferredMasterLeaves.delete(side);
        }

        await this.requestSideReconciliation(side);
    }

    async checkActiveBindingValidity() {
        if (!this.isLoaded || !this.plugin.settings.mySideBar.tabs?.enabled) return;
        await Promise.all([
            this.requestSideReconciliation('left'),
            this.requestSideReconciliation('right')
        ]);
    }

    private requestSideReconciliation(side: SidebarSide): Promise<void> {
        if (!this.isLoaded || !this.plugin.settings.mySideBar.tabs?.enabled) {
            return Promise.resolve();
        }

        if (this.reconciliationQueued.has(side)) {
            return this.sideOperationQueues.get(side) || Promise.resolve();
        }

        this.reconciliationQueued.add(side);
        return this.enqueueSideOperation(side, async generation => {
            this.reconciliationQueued.delete(side);
            await this.reconcileSide(side, generation);
        });
    }

    private enqueueSideOperation(
        side: SidebarSide,
        operation: (generation: number) => Promise<void>
    ): Promise<void> {
        const generation = this.loadGeneration;
        const previous = this.sideOperationQueues.get(side) || Promise.resolve();
        const run = previous
            .catch(e => console.error(`Assistant: Contextual split ${side} operation failed`, e))
            .then(async () => {
                if (!this.isLoaded || generation !== this.loadGeneration) return;
                await operation(generation);
            })
            .catch(e => console.error(`Assistant: Contextual split ${side} operation failed`, e));

        this.sideOperationQueues.set(side, run);
        const clearQueue = () => {
            if (this.sideOperationQueues.get(side) === run) {
                this.sideOperationQueues.delete(side);
            }
        };
        void run.then(clearQueue, clearQueue);
        return run;
    }

    private async reconcileSide(side: SidebarSide, generation: number) {
        if (!this.isLoaded || generation !== this.loadGeneration) return;

        const desired = this.findVisibleBinding(side);
        const current = this.activeBindings.get(side);

        if (!desired) {
            if (current) {
                await this.cleanupSplit(current, side);
                if (this.bindingsMatch(this.activeBindings.get(side), current)) {
                    this.activeBindings.delete(side);
                }
            }
            this.cleanupOrphanSlavesOnSide(side);
            return;
        }

        if (current && !this.bindingsMatch(current, desired.binding)) {
            await this.cleanupSplit(current, side);
            if (this.bindingsMatch(this.activeBindings.get(side), current)) {
                this.activeBindings.delete(side);
            }
        }

        if (!this.isLoaded || generation !== this.loadGeneration) return;

        const slaveLeaves = this.findSlaveLeaves(desired.binding.slaveId, side);
        const slaveLeaf = slaveLeaves.shift() || null;
        slaveLeaves.forEach(duplicate => {
            this.removeHiddenHeader(duplicate);
            duplicate.detach();
        });
        if (slaveLeaf) {
            const parentEl = (slaveLeaf as any).parent?.containerEl as HTMLElement | undefined;
            const bindingWasInactive = !this.bindingsMatch(current, desired.binding);
            if (bindingWasInactive || !parentEl?.hasClass('contextual-split-hidden-header')) {
                this.applySplitPresentation(slaveLeaf, desired.binding, desired.masterLeaf);
            }
            this.activeBindings.set(side, desired.binding);
            return;
        }

        if (this.bindingsMatch(this.activeBindings.get(side), desired.binding)) {
            this.activeBindings.delete(side);
        }
        await this.activateSplitNow(desired.masterLeaf, desired.binding, side, generation);
    }

    private findVisibleBinding(side: SidebarSide): { binding: SidebarBinding, masterLeaf: WorkspaceLeaf } | null {
        const bindings = this.plugin.settings.mySideBar.tabs.bindings || [];

        const preferred = this.preferredMasterLeaves.get(side);
        if (preferred) {
            const binding = bindings.find(candidate => this.bindingsMatch(candidate, preferred.binding));
            const isVisible = binding &&
                preferred.leaf.view.getViewType() === binding.masterId &&
                this.getLeafSide(preferred.leaf) === side &&
                preferred.leaf.view.containerEl.isShown();
            if (binding && isVisible) return { binding, masterLeaf: preferred.leaf };
            this.preferredMasterLeaves.delete(side);
        }

        const active = this.activeBindings.get(side);
        if (active) {
            const binding = bindings.find(candidate => this.bindingsMatch(candidate, active));
            if (binding) {
                const masterLeaf = this.findVisibleMasterLeaf(binding.masterId, side);
                if (masterLeaf) return { binding, masterLeaf };
            }
        }

        for (const binding of bindings) {
            const masterLeaf = this.findVisibleMasterLeaf(binding.masterId, side);
            if (masterLeaf) return { binding, masterLeaf };
        }
        return null;
    }

    private findVisibleMasterLeaf(masterId: string, side: SidebarSide): WorkspaceLeaf | undefined {
        return this.findLeavesByType(masterId).find(leaf =>
            this.getLeafSide(leaf) === side && leaf.view.containerEl.isShown()
        );
    }

    private bindingsMatch(first: SidebarBinding | undefined, second: SidebarBinding | undefined): boolean {
        return !!first && !!second &&
            first.masterId === second.masterId &&
            first.slaveId === second.slaveId;
    }

    isMasterVisible(masterId: string, side?: 'left' | 'right'): boolean {
        const leaves = this.findLeavesByType(masterId);
        return leaves.some(l => {
            if (!l.view.containerEl.isShown()) return false;
            if (side && this.getLeafSide(l) !== side) return false;
            return true;
        });
    }

    saveSplitState() {
        this.activeBindings.forEach((binding, side) => {
            const slaveLeaf = this.findUniqueSlaveLeaf(binding.slaveId, side);

            if (slaveLeaf) {
                const slaveSide = this.getLeafSide(slaveLeaf);
                if (slaveSide !== side) return; // Not the slave for this side's binding

                const parent = (slaveLeaf as any).parent;
                // Check if parent has dimension property
                if (parent && typeof parent.dimension === 'number') {
                    let dim = parent.dimension;

                    // Enforce Integer and Layout Constraints (10-90)
                    dim = Math.round(dim);
                    if (dim < 10) dim = 10;
                    if (dim > 90) dim = 90;

                    if (binding.splitRatio !== dim) {
                        binding.splitRatio = dim;
                        this.plugin.saveSettings();
                    }
                }
            }
        });
    }

    async activateSplit(masterLeaf: WorkspaceLeaf, binding: SidebarBinding) {
        const side = this.getLeafSide(masterLeaf);
        if (side === 'unknown') return;

        await this.enqueueSideOperation(side, async generation => {
            if (!this.isMasterVisible(binding.masterId, side)) return;
            await this.activateSplitNow(masterLeaf, binding, side, generation);
        });
    }

    private async activateSplitNow(
        masterLeaf: WorkspaceLeaf,
        binding: SidebarBinding,
        side: SidebarSide,
        generation: number
    ) {
        if (!this.isLoaded || generation !== this.loadGeneration) return;

        let slaveLeaf = this.findUniqueSlaveLeaf(binding.slaveId, side);

        if (!slaveLeaf) {
            try {
                slaveLeaf = this.app.workspace.createLeafBySplit(masterLeaf, 'horizontal');
            } catch (e) {
                console.error("Assistant: Failed to create contextual split leaf", e);
                return;
            }
            this.pendingSlaveLeaves.set(side, slaveLeaf);
            slaveLeaf.view.containerEl.dataset.assistantContextualSlave = "true";
            try {
                await slaveLeaf.setViewState({ type: binding.slaveId });
            } catch (e) {
                console.error("Assistant: Failed to create contextual split slave", e);
                const ownsPendingLeaf = this.pendingSlaveLeaves.get(side) === slaveLeaf;
                if (ownsPendingLeaf) {
                    this.pendingSlaveLeaves.delete(side);
                    this.removeHiddenHeader(slaveLeaf);
                    slaveLeaf.detach();
                    if (
                        generation === this.loadGeneration &&
                        this.bindingsMatch(this.activeBindings.get(side), binding)
                    ) {
                        this.activeBindings.delete(side);
                    }
                }
                return;
            }

            if (this.pendingSlaveLeaves.get(side) !== slaveLeaf) return;
            this.pendingSlaveLeaves.delete(side);

            const desired = this.findVisibleBinding(side);
            const isCurrent = this.isLoaded &&
                generation === this.loadGeneration &&
                this.plugin.settings.mySideBar.tabs?.enabled &&
                this.bindingsMatch(desired?.binding, binding) &&
                desired?.masterLeaf === masterLeaf &&
                this.getLeafSide(slaveLeaf) === side &&
                slaveLeaf.view.getViewType() === binding.slaveId;

            if (!isCurrent) {
                this.removeHiddenHeader(slaveLeaf);
                slaveLeaf.detach();
                if (this.bindingsMatch(this.activeBindings.get(side), binding)) {
                    this.activeBindings.delete(side);
                }
                return;
            }
            slaveLeaf.view.containerEl.dataset.assistantContextualSlave = "true";

            if (!desired) return;
            binding = desired.binding;
            masterLeaf = desired.masterLeaf;
        }

        this.applySplitPresentation(slaveLeaf, binding, masterLeaf);
        this.activeBindings.set(side, binding);
    }

    private applySplitPresentation(
        slaveLeaf: WorkspaceLeaf,
        binding: SidebarBinding,
        masterLeaf?: WorkspaceLeaf
    ) {
        const parent = (slaveLeaf as any).parent;
        if (parent && parent.containerEl) {
            parent.containerEl.addClass('contextual-split-hidden-header');

            // Restore Dimension with Constraints and Balance Sibling
            if (typeof (parent as any).setDimension === 'function') {
                let dim = binding.splitRatio ?? 50;
                dim = Math.round(dim);
                if (dim < 10) dim = 10;
                if (dim > 90) dim = 90;

                const split = parent.parent; // WorkspaceSplit (Vertical)
                if (split && split.children) {
                    const others = split.children.filter((c: any) => c !== parent);
                    const masterParent = masterLeaf && (masterLeaf as any).parent?.parent === split
                        ? (masterLeaf as any).parent
                        : null;
                    const sibling = masterParent || others[0];
                    if (sibling) {

                        try {
                            if (typeof (parent as any).setDimension === 'function') {
                                (parent as any).setDimension(dim);
                            }
                            if (typeof (sibling as any).setDimension === 'function') {
                                (sibling as any).setDimension(100 - dim);
                            }
                        } catch (e) {
                            console.error("Assistant: Failed to set split dimension", e);
                        }
                    } else {
                        // Fallback if no sibling found
                        try {
                            if (typeof (parent as any).setDimension === 'function') {
                                (parent as any).setDimension(dim);
                            }
                        } catch (e) {
                            console.error("Assistant: Failed to set split dimension (fallback)", e);
                        }
                    }
                }
            }
        }
    }

    async cleanupSplit(binding: SidebarBinding, side?: 'left' | 'right') {
        // Only closes the slave split
        this.findSlaveLeaves(binding.slaveId, side).forEach(slaveLeaf => {
            if (slaveLeaf.view.containerEl.dataset.assistantContextualSlave === "true") {
                this.removeHiddenHeader(slaveLeaf);
                slaveLeaf.detach();
            }
        });
    }

    private cleanupOrphanSlavesOnSide(side: SidebarSide) {
        const split = side === 'left'
            ? this.app.workspace.leftSplit
            : this.app.workspace.rightSplit;
        if (!split) return;

        const pending = this.pendingSlaveLeaves.get(side);
        const orphanLeaves: WorkspaceLeaf[] = [];
        this.iterateLeavesInSplit(split, leaf => {
            if (leaf !== pending && leaf.view.containerEl.dataset.assistantContextualSlave === "true") {
                orphanLeaves.push(leaf);
            }
        });
        orphanLeaves.forEach(leaf => {
            this.removeHiddenHeader(leaf);
            leaf.detach();
        });
    }

    private removeHiddenHeader(leaf: WorkspaceLeaf) {
        const parent = (leaf as any).parent;
        parent?.containerEl?.removeClass('contextual-split-hidden-header');
    }

    findLeavesByType(type: string): WorkspaceLeaf[] {
        const leaves: WorkspaceLeaf[] = [];
        this.app.workspace.iterateAllLeaves(l => {
            if (l.view.getViewType() === type) leaves.push(l);
        });
        return leaves;
    }

    findUniqueSlaveLeaf(type: string, side?: 'left' | 'right'): WorkspaceLeaf | null {
        return this.findSlaveLeaves(type, side)[0] || null;
    }

    private findSlaveLeaves(type: string, side?: SidebarSide): WorkspaceLeaf[] {
        const found: WorkspaceLeaf[] = [];
        const checkSplit = (split: any) => {
            if (!split) return;
            this.iterateLeavesInSplit(split, (l: WorkspaceLeaf) => {
                if (side && this.getLeafSide(l) !== side) return;
                if (l.view.getViewType() === type && l.view.containerEl.dataset.assistantContextualSlave === "true") {
                    found.push(l);
                }
            });
        };
        checkSplit(this.app.workspace.leftSplit);
        checkSplit(this.app.workspace.rightSplit);
        return found;
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

    applyVisualOverride(leaf: WorkspaceLeaf, binding: SidebarBinding) {
        // Must have at least name or icon to override
        if ((!binding.groupName) && (!binding.groupSvg)) return;

        const viewType = leaf.view.getViewType();
        const stateKey = this.getStateKey(leaf);

        // Snapshot original using composite key (side-viewType)
        if (!this.originalStates.has(stateKey)) {
            const icon = leaf.view.icon;
            const title = leaf.view.getDisplayText();
            this.originalStates.set(stateKey, { icon, title });
        }

        const workspaceTabs = (leaf as any).parent;
        if (workspaceTabs && workspaceTabs.tabHeaderContainerEl) {
            const header = workspaceTabs.tabHeaderContainerEl.querySelector(`.workspace-tab-header[data-type="${viewType}"]`);
            if (header) {
                // NAME
                if (binding.groupName) {
                    const titleEl = header.querySelector('.workspace-tab-header-inner-title');
                    if (titleEl) {
                        titleEl.textContent = binding.groupName;
                        header.setAttribute('aria-label', binding.groupName);
                    }
                }

                // ICON (SVG or Lucide)
                if (binding.groupSvg && binding.groupSvg.trim().length > 0) {
                    const iconEl = header.querySelector('.workspace-tab-header-inner-icon');
                    if (iconEl) {
                        renderIconLike(iconEl as HTMLElement, binding.groupSvg, "box");
                    }
                }

                // Add class to mark as Group
                header.addClass('assistant-contextual-group-tab');
            }
        }
    }

    restoreVisuals(leaf: WorkspaceLeaf, viewType: string) {
        const stateKey = this.getStateKey(leaf);
        const original = this.originalStates.get(stateKey);
        if (!original) return;

        const workspaceTabs = (leaf as any).parent;
        if (workspaceTabs && workspaceTabs.tabHeaderContainerEl) {
            const header = workspaceTabs.tabHeaderContainerEl.querySelector(`.workspace-tab-header[data-type="${viewType}"]`);
            if (header) {
                const titleEl = header.querySelector('.workspace-tab-header-inner-title');
                if (titleEl) {
                    titleEl.textContent = original.title;
                    header.setAttribute('aria-label', original.title);
                }

                const iconEl = header.querySelector('.workspace-tab-header-inner-icon');
                if (iconEl) {
                    iconEl.empty();
                    setIcon(iconEl as HTMLElement, original.icon);
                }
                header.removeClass('assistant-contextual-group-tab');
            }
        }
        this.originalStates.delete(stateKey);
    }
}
