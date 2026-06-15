import { App, debounce, EventRef, setIcon } from "obsidian";
import AssistantPlugin from "../main";
import { MyFoldersSettings } from "../settings";
import { CompatQuickExplorer, getFolderNameWithoutPrefix } from "./compat";
import { t } from "../i18n/helpers";
import { LifecycleScope } from "../utils/lifecycle";

type FolderStyleSnapshot = {
    height: string;
    display: string;
    overflow: string;
};

const HIDDEN_FOLDER_CLASS = "obsidian-hide-folders--hidden";

function escapeCssAttributeValue(value: string) {
    return value
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\r/g, "\\D ")
        .replace(/\n/g, "\\A ")
        .replace(/\f/g, "\\C ");
}

export class FoldersManager {
    app: App;
    plugin: AssistantPlugin;
    ribbonIconButton: HTMLElement | null = null;
    statusBarItem: HTMLElement | null = null;
    mutationObserver: MutationObserver | null = null;
    private layoutChangeRef: EventRef | null = null;
    private renameEventRef: EventRef | null = null;
    private scope = new LifecycleScope();
    private folderStyleSnapshots = new Map<HTMLElement, FolderStyleSnapshot>();
    private isLoaded = false;

    constructor(app: App, plugin: AssistantPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    get settings(): MyFoldersSettings {
        return this.plugin.settings.myFolders;
    }

    public processFolders = debounce(async (recheckPreviouslyHiddenFolders?: boolean) => {
        if (!this.isLoaded || !this.settings.enabled) return;

        if (recheckPreviouslyHiddenFolders) {
            this.restoreProcessedFolders();
        }

        if (this.settings.attachmentFolderNames.length === 0) return;

        this.settings.attachmentFolderNames.forEach(folderName => {
            if (getFolderNameWithoutPrefix(folderName) === "") return;

            const selectorString = [
                this.getQuerySelectorStringForFolderName(folderName),
                this.settings.enableCompatQuickExplorer ? CompatQuickExplorer.getAdditionalDocumentSelectorStringForFolder?.(folderName, this.settings) : null,
            ].filter((o) => o != null).join(", ");

            if (!selectorString) return;

            try {
                const folderElements = document.querySelectorAll<HTMLElement>(selectorString);

                folderElements.forEach((folder) => {
                    if (!folder) {
                        return;
                    }

                    if (this.settings.areFoldersHidden) {
                        this.rememberFolderStyles(folder);
                        folder.addClass(HIDDEN_FOLDER_CLASS);
                        folder.style.height = "0";
                        folder.style.display = "none";
                        folder.style.overflow = "hidden";
                    } else if (this.folderStyleSnapshots.has(folder) || folder.hasClass(HIDDEN_FOLDER_CLASS)) {
                        this.restoreFolder(folder);
                    }
                });
            } catch (e) {
                console.error(`Failed to process folder ${folderName}:`, e);
            }
        });
    }, 100, false);

    getQuerySelectorStringForFolderName(folderName: string) {
        const rawFolderName = folderName.trim();
        const folderNameWithoutPrefix = getFolderNameWithoutPrefix(folderName);
        const escapedRawFolderName = escapeCssAttributeValue(rawFolderName);
        const escapedFolderNameWithoutPrefix = escapeCssAttributeValue(folderNameWithoutPrefix);

        if (folderName.toLowerCase().startsWith("endswith::")) {
            return `*:has(> [data-path$="${escapedFolderNameWithoutPrefix}"${this.settings.matchCaseInsensitive ? " i" : ""}])`;
        } else if (folderName.toLowerCase().startsWith("startswith::")) {
            return `*:has(> .nav-folder-title[data-path^="${escapedFolderNameWithoutPrefix}"${this.settings.matchCaseInsensitive ? " i" : ""}]), *:has(> .nav-folder-title[data-path*="/${escapedFolderNameWithoutPrefix}"${this.settings.matchCaseInsensitive ? " i" : ""}])`;
        } else {
            return `*:has(> [data-path$="/${escapedRawFolderName}"${this.settings.matchCaseInsensitive ? " i" : ""}]), *:has(> [data-path="${escapedRawFolderName}"${this.settings.matchCaseInsensitive ? " i" : ""}])`;
        }
    }

    async toggleFunctionality() {
        this.settings.areFoldersHidden = !this.settings.areFoldersHidden;
        if (this.ribbonIconButton) {
            this.ribbonIconButton.ariaLabel = this.settings.areFoldersHidden ? t('Show hidden folders') : t('Hide hidden folders again');
            setIcon(this.ribbonIconButton, this.settings.areFoldersHidden ? "eye" : "eye-off");
        }
        if (this.statusBarItem) {
            this.statusBarItem.setText(this.settings.areFoldersHidden ? t('Configured folders are hidden') : "");
        }
        await this.processFolders();
        await this.plugin.saveSettings();
        await this.updateObsidianIgnoreList();
    }

    updateUI() {
        if (this.ribbonIconButton) {
            this.ribbonIconButton.ariaLabel = this.settings.areFoldersHidden ? t('Show hidden folders') : t('Hide hidden folders again');
            setIcon(this.ribbonIconButton, this.settings.areFoldersHidden ? "eye" : "eye-off");
        }
        if (this.statusBarItem) {
            this.statusBarItem.setText(this.settings.areFoldersHidden ? t('Configured folders are hidden') : "");
        }
    }

    createIgnoreListRegExpForFolderName(rawFolderName: string) {
        const folderName = this.settings.matchCaseInsensitive
            ? getFolderNameWithoutPrefix(rawFolderName).split("").map(c => c.toLowerCase() != c.toUpperCase() ? `[${c.toLowerCase()}${c.toUpperCase()}]` : c).join("")
            : getFolderNameWithoutPrefix(rawFolderName);

        if (rawFolderName.toLowerCase().startsWith("endswith::")) {
            return `/(${folderName}$)|(${folderName}/)/`;
        } else if (rawFolderName.toLowerCase().startsWith("startswith::")) {
            return `/(^${folderName})|(/${folderName})/`;
        } else {
            return `/${folderName}/`;
        }
    }

    async updateObsidianIgnoreList(processFeatureDisabling?: boolean) {
        if (!this.settings.addHiddenFoldersToObsidianIgnoreList && !processFeatureDisabling) return;

        // @ts-ignore
        let ignoreList = (this.app.vault.getConfig("userIgnoreFilters") ?? []) as string[];

        if (this.settings.areFoldersHidden && !processFeatureDisabling) {
            this.settings.attachmentFolderNames.forEach(folderName => {
                if (getFolderNameWithoutPrefix(folderName).trim() === "") return;
                const regExp = this.createIgnoreListRegExpForFolderName(folderName);
                if (ignoreList.includes(regExp)) return;
                ignoreList.push(regExp);
            });
        } else {
            const folderNameRegexes = this.settings.attachmentFolderNames.map(folderName => this.createIgnoreListRegExpForFolderName(folderName));
            ignoreList = ignoreList.filter((s) => !folderNameRegexes.includes(s));
        }

        // @ts-ignore
        this.app.vault.setConfig("userIgnoreFilters", ignoreList);
    }

    async removeSpecificFoldersFromObsidianIgnoreList(folderNames: string[]) {
        const filtersToRemove = new Set(folderNames.map(folderName => this.createIgnoreListRegExpForFolderName(folderName)));
        // @ts-ignore
        const currentFilters = (this.app.vault.getConfig("userIgnoreFilters") ?? []) as string[];
        const nextFilters = currentFilters.filter(filter => !filtersToRemove.has(filter));

        // @ts-ignore
        this.app.vault.setConfig("userIgnoreFilters", nextFilters);
        this.app.vault.trigger("config-changed");
    }

    createBottomStatusBarIndicatorTextItem() {
        if (this.statusBarItem) return; // prevent multiple instantiations

        // This adds a status bar item to the bottom of the app.
        this.statusBarItem = this.plugin.addStatusBarItem();
        this.statusBarItem.setText(this.settings.areFoldersHidden ? t('Configured folders are hidden') : "");
    }

    private scheduleProcessFolders(delay: number, recheckPreviouslyHiddenFolders?: boolean) {
        this.scope.setTimer(() => {
            if (!this.isLoaded) return;
            this.processFolders(recheckPreviouslyHiddenFolders);
        }, delay);
    }

    private rememberFolderStyles(folder: HTMLElement) {
        if (this.folderStyleSnapshots.has(folder)) return;
        this.folderStyleSnapshots.set(folder, {
            height: folder.style.height,
            display: folder.style.display,
            overflow: folder.style.overflow
        });
    }

    private restoreFolder(folder: HTMLElement) {
        const snapshot = this.folderStyleSnapshots.get(folder);
        folder.style.height = snapshot?.height ?? "";
        folder.style.display = snapshot?.display ?? "";
        folder.style.overflow = snapshot?.overflow ?? "";
        folder.removeClass(HIDDEN_FOLDER_CLASS);
        this.folderStyleSnapshots.delete(folder);
    }

    private restoreProcessedFolders() {
        Array.from(this.folderStyleSnapshots.keys()).forEach((folder) => this.restoreFolder(folder));
        document.querySelectorAll<HTMLElement>(`.${HIDDEN_FOLDER_CLASS}`).forEach((folder) => this.restoreFolder(folder));
        this.folderStyleSnapshots.clear();
    }

    async onload() {
        if (this.isLoaded) return;
        if (!this.settings.enabled) return;
        this.isLoaded = true;
        this.scope.reset();

        console.log(t("Loading MyFolders module"));
        const loadToken = this.scope.token();

        // Ribbon Icon
        this.ribbonIconButton = this.plugin.addRibbonIcon(
            this.settings.areFoldersHidden ? "eye" : "eye-off",
            this.settings.areFoldersHidden ? t('Show hidden folders') : t('Hide hidden folders again'),
            (evt: MouseEvent) => {
                this.toggleFunctionality();
            }
        );

        if (!this.settings.hideBottomStatusBarIndicatorText) {
            this.createBottomStatusBarIndicatorTextItem();
        } else if (this.statusBarItem) {
            this.statusBarItem.remove();
            this.statusBarItem = null;
        }

        // Command is registered in main.ts

        this.mutationObserver = new MutationObserver((mutationRecord) => {
            const feClasses = [
                "nav-folder",
                "nav-files-container",
            ];

            const shouldTriggerProcessFolders = mutationRecord.some((record) => {
                // @ts-ignore
                if (feClasses.some(c => record.target?.parentElement?.classList.contains(c))) return true;
                if (this.settings.enableCompatQuickExplorer && CompatQuickExplorer.shouldMutationRecordTriggerFolderReProcessing?.(record)) return true;

                return false;
            });

            if (!shouldTriggerProcessFolders) return;
            this.processFolders();
        });
        this.scope.add(() => {
            this.mutationObserver?.disconnect();
            this.mutationObserver = null;
        });

        // Optimization: Targeted observation
        this.observeFileExplorers();

        // Re-attach observer when layout changes (File Explorer might be closed/opened)
        this.layoutChangeRef = this.app.workspace.on('layout-change', () => {
            this.observeFileExplorers();
            this.processFolders();
        });
        this.scope.event(this.app.workspace, this.layoutChangeRef);

        // Rename Event
        this.renameEventRef = this.app.vault.on("rename", () => {
            this.scheduleProcessFolders(50); // Increased rename delay slightly
        });
        this.scope.event(this.app.vault, this.renameEventRef);

        // Optimization: Check layoutReady first
        if (this.app.workspace.layoutReady) {
            if (this.settings.areFoldersHidden) {
                this.scheduleProcessFolders(1000);
            }
        } else {
            this.app.workspace.onLayoutReady(() => {
                if (!this.scope.isCurrent(loadToken)) return;
                if (!this.isLoaded || !this.settings.areFoldersHidden) return;
                this.scheduleProcessFolders(1000);
            });
        }
    }

    observeFileExplorers() {
        if (!this.settings.enabled) return;
        if (!this.mutationObserver) return;
        this.mutationObserver.disconnect();

        const fileExplorers = document.querySelectorAll('.nav-files-container');
        if (fileExplorers.length > 0) {
            fileExplorers.forEach(container => {
                this.mutationObserver?.observe(container, { childList: true, subtree: true });
            });
        }
    }

    onunload() {
        console.log(t("Unloading MyFolders module"));
        this.isLoaded = false;
        this.scope.dispose();
        this.renameEventRef = null;
        this.layoutChangeRef = null;
        this.restoreProcessedFolders();

        this.ribbonIconButton?.remove();
        this.ribbonIconButton = null;
        this.statusBarItem?.remove();
        this.statusBarItem = null;
    }
}
