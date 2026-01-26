import { App, WorkspaceLeaf, WorkspaceItem, setIcon, debounce, EventRef } from "obsidian";
import AssistantPlugin from "../../main";
import { SidebarBinding } from "../../settings";

export class ContextualSplitFeature {
    app: App;
    plugin: AssistantPlugin;

    // Store original visual states of master tabs: { "side-viewType": { icon: string, title: string } }
    // Key format: "left-viewType" or "right-viewType" to support same viewType on both sidebars
    private originalStates: Map<string, { icon: string, title: string }> = new Map();
    // Support independent active splits for left and right sidebars
    private activeBindings: Map<'left' | 'right', SidebarBinding> = new Map();
    private listeners: EventRef[] = [];
    private observer: MutationObserver | null = null;

    constructor(app: App, plugin: AssistantPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    onload() {
        if (this.listeners.length > 0) {
            this.onunload();
        }

        // MutationObserver to automatically apply styles when tabs are rendered
        this.observer = new MutationObserver(debounce(() => {
            this.applyAllMasquerades();
        }, 50));

        const runInit = () => {
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
                this.applyAllMasquerades();
                this.checkActiveBindingValidity();
            }, 200))
        );

        this.listeners.push(
            this.app.workspace.on('resize', debounce(() => {
                this.saveSplitState();
            }, 500))
        );

        this.listeners.push(
            this.app.workspace.on('active-leaf-change', debounce((leaf) => {
                if (leaf) this.handleActiveLeaf(leaf);
            }, 50, true))
        );
    }

    onunload() {
        this.listeners.forEach(ref => this.app.workspace.offref(ref));
        this.listeners = [];

        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        // Cleanup all active splits
        this.activeBindings.forEach(binding => {
            this.cleanupSplit(binding);
        });
        this.activeBindings.clear();
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
            (this.app.workspace as any).iterateLeaves((leaf: WorkspaceLeaf) => {
                if (leaf.view.containerEl.dataset.assistantContextualSlave === "true") {
                    toDetach.push(leaf);
                }
            }, split);
            toDetach.forEach(l => l.detach());
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
    private getLeafSide(leaf: WorkspaceLeaf): 'left' | 'right' | 'unknown' {
        const container = leaf.view?.containerEl;
        if (!container) return 'unknown';

        if (container.closest('.mod-left-split')) return 'left';
        if (container.closest('.mod-right-split')) return 'right';

        return 'unknown';
    }

    async handleActiveLeaf(leaf: WorkspaceLeaf) {
        if (!this.plugin.settings.mySideBar.tabs?.enabled) return;
        const viewType = leaf.view.getViewType();
        const bindings = this.plugin.settings.mySideBar.tabs.bindings || [];

        const matchingBinding = bindings.find(b => b.masterId === viewType);

        // Determine side
        const side = this.getLeafSide(leaf);
        if (side === 'unknown') return;

        const currentActive = this.activeBindings.get(side);

        if (matchingBinding) {
            // Activate Split (Focused on Master)
            if (currentActive && currentActive !== matchingBinding) {
                await this.cleanupSplit(currentActive);
            }
            this.activeBindings.set(side, matchingBinding);
            await this.activateSplit(leaf, matchingBinding);

        } else {
            // Focused on something else on this side
            if (currentActive) {
                // 1. Is it the Slave?
                if (viewType === currentActive.slaveId) {
                    if (leaf.view.containerEl.dataset.assistantContextualSlave === "true") {
                        return; // Focus is on our slave, keep split open
                    }
                }

                // 2. Is the Master still visible? (e.g. Focus is in Editor, but Sidebar Tab is open)
                if (this.isMasterVisible(currentActive.masterId, side)) {
                    return; // Master is visible, keep split open
                }

                await this.cleanupSplit(currentActive);
                this.activeBindings.delete(side);
            }
        }
    }

    checkActiveBindingValidity() {
        const bindings = this.plugin.settings.mySideBar.tabs.bindings || [];
        const sides: ('left' | 'right')[] = ['left', 'right'];

        sides.forEach(side => {
            const currentActive = this.activeBindings.get(side);

            // 1. Check if any Master is visible on this side
            for (const binding of bindings) {
                if (this.isMasterVisible(binding.masterId, side)) {
                    if (currentActive !== binding) {
                        if (currentActive) this.cleanupSplit(currentActive);

                        this.activeBindings.set(side, binding);
                        const leaves = this.findLeavesByType(binding.masterId);
                        // Filter for leaves on this side
                        const sideLeaf = leaves.find(l => this.getLeafSide(l) === side && l.view.containerEl.isShown());

                        if (sideLeaf) this.activateSplit(sideLeaf, binding);
                    }
                    return; // Found a valid master for this side, move to next side
                }
            }

            // 2. If no Master is visible on this side, cleanup
            if (currentActive) {
                this.cleanupSplit(currentActive);
                this.activeBindings.delete(side);
            }
        });
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
            const slaveLeaf = this.findUniqueSlaveLeaf(binding.slaveId);
            // We need to ensure this slave leaf belongs to the split we are tracking?
            // Since findUniqueSlaveLeaf scans both sides, it might return the wrong one 
            // if both sides have same slave type (unlikely but possible).
            // But since 'slaveId' usually is unique per binding, and we assume 
            // user doesn't bind same slave ID to multiple things differently...
            // Let's rely on checking the side of the found slave leaf.

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
        // Only handles the split logic now, visual is handled globally
        let slaveLeaf = this.findUniqueSlaveLeaf(binding.slaveId);

        if (!slaveLeaf) {
            slaveLeaf = this.app.workspace.createLeafBySplit(masterLeaf, 'horizontal');
            await slaveLeaf.setViewState({ type: binding.slaveId });
            slaveLeaf.view.containerEl.dataset.assistantContextualSlave = "true";
        }

        const parent = (slaveLeaf as any).parent;
        if (parent && parent.containerEl) {
            parent.containerEl.addClass('contextual-split-hidden-header');

            // Restore Dimension with Constraints and Balance Sibling
            if (typeof (parent as any).setDimension === 'function') {
                let dim = binding.splitRatio || 50;
                dim = Math.round(dim);
                if (dim < 10) dim = 10;
                if (dim > 90) dim = 90;

                const split = parent.parent; // WorkspaceSplit (Vertical)
                if (split && split.children) {
                    const others = split.children.filter((c: any) => c !== parent);
                    if (others.length > 0) {
                        const sibling = others[0]; // Master Tabs

                        try {
                            if (typeof (parent as any).setDimension === 'function') {
                                (parent as any).setDimension(dim);
                            }
                            if (typeof (sibling as any).setDimension === 'function') {
                                (sibling as any).setDimension(100 - dim);
                            }
                        } catch (e) {
                            console.error("Assistant Assistant: Failed to set split dimension", e);
                        }
                    } else {
                        // Fallback if no sibling found
                        try {
                            if (typeof (parent as any).setDimension === 'function') {
                                (parent as any).setDimension(dim);
                            }
                        } catch (e) {
                            console.error("Assistant Assistant: Failed to set split dimension (fallback)", e);
                        }
                    }
                }
            }
        }
    }

    async cleanupSplit(binding: SidebarBinding) {
        // Only closes the slave split
        const slaveLeaf = this.findUniqueSlaveLeaf(binding.slaveId);
        if (slaveLeaf) {
            if (slaveLeaf.view.containerEl.dataset.assistantContextualSlave === "true") {
                slaveLeaf.detach();
            }
        }
    }

    findLeavesByType(type: string): WorkspaceLeaf[] {
        const leaves: WorkspaceLeaf[] = [];
        this.app.workspace.iterateAllLeaves(l => {
            if (l.view.getViewType() === type) leaves.push(l);
        });
        return leaves;
    }

    findUniqueSlaveLeaf(type: string): WorkspaceLeaf | null {
        let found: WorkspaceLeaf | null = null;
        const checkSplit = (split: any) => {
            if (!split) return;
            (this.app.workspace as any).iterateLeaves((l: WorkspaceLeaf) => {
                if (l.view.getViewType() === type && l.view.containerEl.dataset.assistantContextualSlave === "true") {
                    found = l;
                }
            }, split);
        };
        checkSplit(this.app.workspace.leftSplit);
        checkSplit(this.app.workspace.rightSplit);
        return found;
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
                        const val = binding.groupSvg.trim();
                        // Check if it looks like SVG code
                        if (val.startsWith('<svg')) {
                            iconEl.empty();
                            iconEl.innerHTML = val;
                        } else {
                            // Fallback to Lucide name if it's not SVG code AND looks safe (no HTML tags)
                            if (!val.includes('<') && !val.includes('>')) {
                                iconEl.empty();
                                setIcon(iconEl as HTMLElement, val);
                            }
                        }
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
