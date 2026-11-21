export type EventRef = { id?: string };
export type WorkspaceLeaf = any;
export type WorkspaceItem = any;
export type WorkspaceSplit = any;
export type WorkspaceRibbon = any;
export type PluginManifest = {
    id: string;
    name: string;
    description?: string;
    isDesktopOnly?: boolean;
};

type Listener = (...args: any[]) => void;

export const Platform = {
    isMobile: false
};

export const moment = {
    locale: () => "en"
};

export class App {
    workspace: any;
    vault: any;
}

export class Plugin {
    app: any;
    manifest = { id: "obsidian-workspace-assistant" };
    private data: any = null;

    constructor(app?: any) {
        this.app = app;
    }

    addRibbonIcon(icon: string, title: string, callback: Listener) {
        const button = document.createElement("button");
        button.setAttribute("aria-label", title);
        button.dataset.icon = icon;
        button.addEventListener("click", callback);
        document.body.appendChild(button);
        return button;
    }

    addStatusBarItem() {
        const item = document.createElement("div");
        item.addClass("status-bar-item");
        item.setText = (text: string) => { item.textContent = text; };
        document.body.appendChild(item);
        return item;
    }

    registerDomEvent(target: EventTarget, type: string, callback: Listener) {
        target.addEventListener(type, callback as EventListener);
    }

    addCommand() { }
    addSettingTab() { }
    async loadData() { return this.data; }
    async saveData(data: any) { this.data = data; }
}

export class PluginSettingTab {
    app: any;
    plugin: any;
    containerEl = document.createElement("div");

    constructor(app: any, plugin: any) {
        this.app = app;
        this.plugin = plugin;
    }
}

class ChainableComponent {
    inputEl: HTMLInputElement | HTMLTextAreaElement = document.createElement("input");
    setValue(_value: any) { return this; }
    setPlaceholder(_value: string) { return this; }
    setButtonText(_value: string) { return this; }
    setCta() { return this; }
    setWarning() { return this; }
    onChange(_callback: Listener) { return this; }
    onClick(_callback: Listener) { return this; }
    addOption(_value: string, _label: string) { return this; }
}

export class ToggleComponent extends ChainableComponent { }
export class DropdownComponent extends ChainableComponent { }
export class TextComponent extends ChainableComponent { }
export class TextAreaComponent extends ChainableComponent {
    inputEl = document.createElement("textarea");
}
export class ButtonComponent extends ChainableComponent {
    constructor(_container?: HTMLElement) {
        super();
    }
}

export class Setting {
    settingEl = document.createElement("div");
    infoEl = document.createElement("div");
    controlEl = document.createElement("div");

    constructor(containerEl?: HTMLElement) {
        this.settingEl.appendChild(this.infoEl);
        this.settingEl.appendChild(this.controlEl);
        containerEl?.appendChild(this.settingEl);
    }

    setName(_value: string) { return this; }
    setDesc(_value: string) { return this; }
    setHeading() { return this; }
    addToggle(callback: (component: ToggleComponent) => void) {
        callback(new ToggleComponent());
        return this;
    }
    addDropdown(callback: (component: DropdownComponent) => void) {
        callback(new DropdownComponent());
        return this;
    }
    addText(callback: (component: TextComponent) => void) {
        callback(new TextComponent());
        return this;
    }
    addTextArea(callback: (component: TextAreaComponent) => void) {
        callback(new TextAreaComponent());
        return this;
    }
    addButton(callback: (component: ButtonComponent) => void) {
        callback(new ButtonComponent(this.controlEl));
        return this;
    }
    then(callback: (setting: Setting) => void) {
        callback(this);
        return this;
    }
}

export class Modal {
    contentEl = document.createElement("div");
    app: any;

    constructor(app: any) {
        this.app = app;
    }

    open() { }
    close() { }
}

export class Notice {
    constructor(public message: string) { }
}

export function setIcon(el: HTMLElement | Element, icon: string) {
    el.setAttribute("data-icon", icon);
}

export function debounce<T extends (...args: any[]) => any>(fn: T, timeout: number, immediate?: boolean): T {
    let timer: number | null = null;
    let first = true;

    return function (this: any, ...args: any[]) {
        if (immediate && first) {
            first = false;
            return fn.apply(this, args);
        }
        if (timer !== null) window.clearTimeout(timer);
        timer = window.setTimeout(() => {
            timer = null;
            first = true;
            fn.apply(this, args);
        }, timeout);
    } as T;
}
