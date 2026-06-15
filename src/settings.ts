import { StatusBarElementStatus } from './statusbar/types';
import { RibbonElement } from "./sidebar/types";

export interface AssistantSettings {
    myPlugins: MyPluginsSettings;
    myFolders: MyFoldersSettings;
    mySideBar: MySideBarSettings;
    myStatusBar: MyStatusBarSettings;
    mySnippets: MySnippetsSettings;
}

// MyFolders Settings
export interface MyFoldersSettings {
    enabled: boolean;
    areFoldersHidden: boolean;
    matchCaseInsensitive: boolean;
    addHiddenFoldersToObsidianIgnoreList: boolean;
    hideBottomStatusBarIndicatorText: boolean;
    enableCompatQuickExplorer: boolean;
    attachmentFolderNames: string[];
}

export enum LoadingMethod {
    disabled = 'disabled',
    instant = 'instant',
    short = 'short',
    long = 'long'
}

export function isLoadingMethod(value: unknown): value is LoadingMethod {
    return Object.values(LoadingMethod).includes(value as LoadingMethod);
}

export interface PluginSettings {
    startupType?: LoadingMethod;
}

export interface DeviceSettings {
    shortDelaySeconds: number;
    longDelaySeconds: number;
    delayBetweenPlugins: number;
    defaultStartupType: LoadingMethod | null;
    showDescriptions: boolean;
    enableDependencies: boolean;
    plugins: { [pluginId: string]: PluginSettings };
    [key: string]: any;
}

export interface MyPluginsSettings {
    enabled: boolean;
    dualConfigs: boolean;
    showConsoleLog: boolean;
    desktop: DeviceSettings;
    mobile?: DeviceSettings;
}

export interface StatusBarOrganizerSettings {
    status: { [key: string]: StatusBarElementStatus };
    version: string;
}

export interface MyStatusBarSettings extends StatusBarOrganizerSettings {
    enabled: boolean;
}

// MySnippets Settings
export interface MySnippetsSettings {
    aestheticStyle: boolean;
    snippetViewPosition: string;
    openSnippetFile: boolean;
    stylingTemplate: string;
    snippetEnabledStatus: boolean;
    showStatusBarIcon: boolean;
    enabled: boolean;
}

export interface AutoHideSettings {
    enabled: boolean;
    leftSidebar: boolean;
    rightSidebar: boolean;
    syncLeftRight: boolean;
    enforceSameDelay: boolean;
    sidebarDelay: number;
    sidebarExpandDelay: number;
    leftSideBarPixelTrigger: number;
    rightSideBarPixelTrigger: number;
    overlayMode: boolean;
    expandCollapseSpeed: number;
    leftSidebarMaxWidth: number;
    rightSidebarMaxWidth: number;
}

export interface SidebarTabElement {
    id: string;
    side: 'left' | 'right';
    visible: boolean;
    order: number;
    icon?: string;
}

export interface SidebarBinding {
    masterId: string;
    slaveId: string;
    groupSvg?: string;
    groupName?: string;
    splitRatio?: number;
}

export interface SidebarTabsSettings {
    enabled: boolean;
    elements: { [viewType: string]: SidebarTabElement };
    bindings: SidebarBinding[];
}

export interface RibbonSettings {
    enabled: boolean;
    ribbonDisplayDelay: number;
    elements: { [id: string]: RibbonElement };
}

export interface MySideBarSettings {
    enabled: boolean;
    autoHide: AutoHideSettings;
    ribbon: RibbonSettings;
    tabs: SidebarTabsSettings;
}

function deepClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

function isRecord(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordOrEmpty<T = any>(value: unknown): { [key: string]: T } {
    return isRecord(value) ? value as { [key: string]: T } : {};
}

function numberOrDefault(value: unknown, fallback: number, min?: number) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    if (min !== undefined && parsed < min) return fallback;
    return parsed;
}

function normalizeSplitRatio(binding: SidebarBinding) {
    if (binding.splitRatio === undefined) return;
    binding.splitRatio = Math.round(binding.splitRatio);
    if (binding.splitRatio < 10) binding.splitRatio = 10;
    if (binding.splitRatio > 90) binding.splitRatio = 90;
}

function normalizeBinding(input: unknown): SidebarBinding | null {
    if (!isRecord(input)) return null;
    if (typeof input.masterId !== "string" || typeof input.slaveId !== "string") return null;
    if (!input.masterId || !input.slaveId) return null;

    const binding: SidebarBinding = {
        masterId: input.masterId,
        slaveId: input.slaveId
    };

    if (typeof input.groupSvg === "string") binding.groupSvg = input.groupSvg;
    if (typeof input.groupName === "string") binding.groupName = input.groupName;

    const splitRatio = Number(input.splitRatio);
    if (Number.isFinite(splitRatio)) {
        binding.splitRatio = splitRatio;
        normalizeSplitRatio(binding);
    }

    return binding;
}

function normalizePluginSettings(input: unknown): PluginSettings | null {
    if (!isRecord(input)) return null;
    return isLoadingMethod(input.startupType)
        ? { startupType: input.startupType }
        : null;
}

export function createDefaultFoldersSettings(): MyFoldersSettings {
    return {
        enabled: true,
        areFoldersHidden: true,
        matchCaseInsensitive: true,
        addHiddenFoldersToObsidianIgnoreList: false,
        hideBottomStatusBarIndicatorText: false,
        enableCompatQuickExplorer: false,
        attachmentFolderNames: ["attachments"],
    };
}

export function createDefaultDeviceSettings(): DeviceSettings {
    return {
        shortDelaySeconds: 5,
        longDelaySeconds: 15,
        delayBetweenPlugins: 40,
        defaultStartupType: null,
        showDescriptions: true,
        enableDependencies: false,
        plugins: {}
    };
}

export function createDefaultPluginsSettings(): MyPluginsSettings {
    return {
        enabled: true,
        dualConfigs: false,
        showConsoleLog: false,
        desktop: createDefaultDeviceSettings()
    };
}

export function createDefaultStatusBarSettings(): MyStatusBarSettings {
    return {
        enabled: true,
        status: {},
        version: "0.0.1"
    };
}

export function createDefaultSnippetsSettings(): MySnippetsSettings {
    return {
        aestheticStyle: false,
        snippetViewPosition: "left",
        openSnippetFile: true,
        stylingTemplate: "",
        snippetEnabledStatus: false,
        showStatusBarIcon: true,
        enabled: true
    };
}

export function createDefaultSideBarSettings(): MySideBarSettings {
    return {
        enabled: true,
        autoHide: {
            enabled: true,
            leftSidebar: true,
            rightSidebar: true,
            syncLeftRight: true,
            enforceSameDelay: true,
            sidebarDelay: 500,
            sidebarExpandDelay: 200,
            leftSideBarPixelTrigger: 40,
            rightSideBarPixelTrigger: 40,
            overlayMode: false,
            expandCollapseSpeed: 300,
            leftSidebarMaxWidth: 350,
            rightSidebarMaxWidth: 350,
        },
        ribbon: {
            enabled: true,
            ribbonDisplayDelay: 1000,
            elements: {}
        },
        tabs: {
            enabled: true,
            elements: {},
            bindings: []
        }
    };
}

export function createDefaultSettings(): AssistantSettings {
    return {
        myPlugins: createDefaultPluginsSettings(),
        myFolders: createDefaultFoldersSettings(),
        mySideBar: createDefaultSideBarSettings(),
        myStatusBar: createDefaultStatusBarSettings(),
        mySnippets: createDefaultSnippetsSettings(),
    };
}

export const DEFAULT_MY_FOLDERS_SETTINGS = createDefaultFoldersSettings();
export const DEFAULT_DEVICE_SETTINGS = createDefaultDeviceSettings();
export const DEFAULT_MY_PLUGINS_SETTINGS = createDefaultPluginsSettings();
export const DEFAULT_STATUS_BAR_SETTINGS = createDefaultStatusBarSettings();
export const DEFAULT_MY_SNIPPETS_SETTINGS = createDefaultSnippetsSettings();
export const DEFAULT_MY_SIDEBAR_SETTINGS = createDefaultSideBarSettings();
export const DEFAULT_SETTINGS = createDefaultSettings();

export function migrateSettingsData(data: any) {
    if (!data || typeof data !== "object") return data;

    if (data.myStatusBar) {
        delete data.myStatusBar.presets;
        delete data.myStatusBar.activePreset;
        delete data.myStatusBar.activeFullscreenPreset;
        delete data.myStatusBar.separateFullscreenPreset;
        delete data.myStatusBar.presetsOrder;
    }
    delete data.statusBar;
    delete data.statusBarOrganizer;

    return data;
}

function normalizeDeviceSettings(input?: Partial<DeviceSettings> | unknown): DeviceSettings {
    const defaults = createDefaultDeviceSettings();
    const source = isRecord(input) ? input as Partial<DeviceSettings> : {};
    const settings = Object.assign(defaults, source);

    settings.shortDelaySeconds = numberOrDefault(settings.shortDelaySeconds, defaults.shortDelaySeconds, 0);
    settings.longDelaySeconds = numberOrDefault(settings.longDelaySeconds, defaults.longDelaySeconds, 0);
    settings.delayBetweenPlugins = numberOrDefault(settings.delayBetweenPlugins, defaults.delayBetweenPlugins, 0);
    settings.defaultStartupType = isLoadingMethod(settings.defaultStartupType) ? settings.defaultStartupType : null;
    settings.plugins = {};
    Object.entries(recordOrEmpty(source.plugins)).forEach(([pluginId, value]) => {
        const pluginSettings = normalizePluginSettings(value);
        if (pluginSettings) settings.plugins[pluginId] = pluginSettings;
    });

    return settings;
}

export function normalizeSettings(loadedData?: Partial<AssistantSettings> | null): AssistantSettings {
    const data = isRecord(loadedData) ? migrateSettingsData(deepClone(loadedData)) : {};
    const settings = createDefaultSettings();
    const myFolders = recordOrEmpty(data.myFolders);
    const myPlugins = recordOrEmpty(data.myPlugins);
    const myStatusBar = recordOrEmpty(data.myStatusBar);
    const mySnippets = recordOrEmpty(data.mySnippets);
    const mySideBar = recordOrEmpty(data.mySideBar);

    settings.myFolders = Object.assign(settings.myFolders, myFolders);
    if (!Array.isArray(settings.myFolders.attachmentFolderNames)) {
        settings.myFolders.attachmentFolderNames = createDefaultFoldersSettings().attachmentFolderNames;
    }

    settings.myPlugins = Object.assign(settings.myPlugins, myPlugins);
    settings.myPlugins.desktop = normalizeDeviceSettings(myPlugins.desktop);
    if (isRecord(myPlugins.mobile)) {
        settings.myPlugins.mobile = normalizeDeviceSettings(myPlugins.mobile);
    } else {
        delete settings.myPlugins.mobile;
    }

    settings.myStatusBar = Object.assign(settings.myStatusBar, myStatusBar);
    settings.myStatusBar.status = Object.assign({}, recordOrEmpty<StatusBarElementStatus>(myStatusBar.status));

    settings.mySnippets = Object.assign(settings.mySnippets, mySnippets);

    settings.mySideBar = Object.assign(settings.mySideBar, mySideBar);
    const autoHide = recordOrEmpty(mySideBar.autoHide);
    const ribbon = recordOrEmpty(mySideBar.ribbon);
    const tabs = recordOrEmpty(mySideBar.tabs);

    settings.mySideBar.autoHide = Object.assign(createDefaultSideBarSettings().autoHide, autoHide);
    settings.mySideBar.ribbon = Object.assign(createDefaultSideBarSettings().ribbon, ribbon);
    settings.mySideBar.ribbon.elements = Object.assign({}, recordOrEmpty<RibbonElement>(ribbon.elements));
    settings.mySideBar.tabs = Object.assign(createDefaultSideBarSettings().tabs, tabs);
    settings.mySideBar.tabs.elements = Object.assign({}, recordOrEmpty<SidebarTabElement>(tabs.elements));
    settings.mySideBar.tabs.bindings = Array.isArray(tabs.bindings)
        ? tabs.bindings.map(normalizeBinding).filter((binding): binding is SidebarBinding => binding !== null)
        : [];

    return settings;
}
