import { App } from "obsidian";
import AssistantPlugin from "../main";
import { StatusBarOrganizerSettings } from "./types";
import Spooler from "./spooler";
import { fixOrder } from "./organizer";
import { BarStatus, ExistsStatus, StatusBarElement, StatusBarElementStatus } from "./types";
import { getStatusBarElements, parseElementId } from "./parser";

type StatusBarElementSnapshot = {
    order: string;
    hadHiddenClass: boolean;
};

const HIDDEN_ELEMENT_CLASS = "statusbar-organizer-element-hidden";

export class StatusBarManager {
    app: App;
    plugin: AssistantPlugin;
    settings: StatusBarOrganizerSettings;
    statusBar: HTMLElement | undefined;
    spooler: Spooler | null = null;
    private isLoaded = false;
    private loadGeneration = 0;
    private elementSnapshots = new Map<HTMLElement, StatusBarElementSnapshot>();

    constructor(app: App, plugin: AssistantPlugin) {
        this.app = app;
        this.plugin = plugin;
        // Link to global settings
        this.settings = this.plugin.settings.myStatusBar;
    }

    async onload() {
        if (this.isLoaded) return;
        this.isLoaded = true;
        const generation = ++this.loadGeneration;

        // Find status bar
        this.statusBar = document.querySelector(".status-bar") as HTMLElement;
        if (!this.statusBar) {
            // Try again on layout ready just in case
            this.app.workspace.onLayoutReady(() => {
                if (!this.isLoaded || generation !== this.loadGeneration) return;
                this.statusBar = document.querySelector(".status-bar") as HTMLElement;
                if (this.statusBar) this.initializeManager();
            });
            return;
        }

        this.initializeManager();
    }

    private initializeManager() {
        if (!this.statusBar) return;

        if (this.spooler) this.spooler.dispose();

        // Initialize Spooler
        this.spooler = new Spooler(this, fixOrder);

        // Initial Order Fix
        fixOrder(this);

        this.spooler.enableObserver();
    }

    onunload() {
        if (!this.isLoaded) return;
        this.isLoaded = false;
        this.loadGeneration++;
        if (this.spooler) this.spooler.dispose();
        this.spooler = null;
        this.restoreManagedElementState();
    }

    refreshAfterSoftStartup() {
        if (!this.isLoaded || !this.statusBar || !this.spooler) return;
        this.spooler.spoolFix(0);
    }

    saveSettings() {
        return this.plugin.saveSettings();
    }

    async saveStatus(currentBarStatus: BarStatus) {
        this.settings.status = currentBarStatus;
        await this.saveSettings();
    }

    rememberElementState(element: HTMLElement) {
        if (this.elementSnapshots.has(element)) return;
        this.elementSnapshots.set(element, {
            order: element.style.order,
            hadHiddenClass: element.hasClass(HIDDEN_ELEMENT_CLASS)
        });
    }

    private restoreManagedElementState() {
        this.elementSnapshots.forEach((snapshot, element) => {
            if (!element.isConnected) return;
            element.style.order = snapshot.order;
            element.toggleClass(HIDDEN_ELEMENT_CLASS, snapshot.hadHiddenClass);
        });
        this.elementSnapshots.clear();
    }

    /**
     * Merge information about status bar elements based on
     * the saved settings and the state of the actual status bar.
     */
    async consolidateSettingsAndElements(): Promise<{
        rows: StatusBarElement[],
        barStatus: BarStatus,
        existsStatus: ExistsStatus
    }> {
        // Initialize status from settings
        const loadedElementStatus: { [key: string]: StatusBarElementStatus } = this.settings.status || {};

        // Aggregate all HTML status bar elements and provisionally assign them default status
        if (!this.statusBar) {
            return { rows: [], barStatus: {}, existsStatus: {} };
        }

        const unorderedStatusBarElements = getStatusBarElements(this.statusBar);
        const defaultElementStatus: { [key: string]: StatusBarElementStatus } = {};
        for (const [index, statusBarElement] of unorderedStatusBarElements.entries()) {
            defaultElementStatus[statusBarElement.id] = {
                position: index,
                visible: true
            };
        }

        // Check which known elements are missing from the current status bar
        const barStatus: BarStatus = {};
        const existsStatus: ExistsStatus = {};
        for (const [index, status] of Object.entries(loadedElementStatus)) {
            barStatus[index] = status;
            existsStatus[index] = index in defaultElementStatus;
        }

        // Append all previously unknown elements to the end of the list
        let insertPosition = Object.keys(barStatus).length + 1;
        let foundNewElement = false;
        for (const element of unorderedStatusBarElements) {
            if (element.id in barStatus) continue;
            const status = defaultElementStatus[element.id];
            status.position = insertPosition++;
            barStatus[element.id] = status;
            existsStatus[element.id] = true;
            foundNewElement = true;
        }

        // Serialize elements missing from the status bar
        const disabledStatusBarElements: StatusBarElement[] = Object.keys(loadedElementStatus)
            .filter(x => !existsStatus[x])
            .map(x => {
                const parsed = parseElementId(x);
                return {
                    name: parsed.name,
                    index: parsed.index,
                    id: x
                };
            });

        // Generate menu entries with correct order of elements
        const rows: StatusBarElement[] = unorderedStatusBarElements
            .concat(disabledStatusBarElements)
            .map(x => [x, barStatus[x.id].position])
            // @ts-ignore
            .sort((a: [any, number], b: [any, number]) => a[1] - b[1])
            // @ts-ignore
            .map((x: [StatusBarElement, any]) => x[0]);

        if (foundNewElement) await this.saveStatus(barStatus);
        this.spooler?.spoolFix(0);

        return {
            rows: rows,
            barStatus: barStatus,
            existsStatus: existsStatus
        }
    }
}
