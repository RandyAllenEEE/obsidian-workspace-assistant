import { afterEach, vi } from "vitest";

declare global {
    interface Element {
        addClass(cls: string): void;
        removeClass(cls: string): void;
        toggleClass(cls: string, force?: boolean): void;
        hasClass(cls: string): boolean;
        empty(): void;
        createEl<K extends keyof HTMLElementTagNameMap>(tag: K, options?: { text?: string, cls?: string }): HTMLElementTagNameMap[K];
        createDiv(options?: { text?: string, cls?: string }): HTMLDivElement;
        createSpan(options?: { text?: string, cls?: string }): HTMLSpanElement;
        setText(text: string): void;
    }
}

Element.prototype.addClass = function (cls: string) {
    this.classList.add(cls);
};

Element.prototype.removeClass = function (cls: string) {
    this.classList.remove(cls);
};

Element.prototype.toggleClass = function (cls: string, force?: boolean) {
    this.classList.toggle(cls, force);
};

Element.prototype.hasClass = function (cls: string) {
    return this.classList.contains(cls);
};

Element.prototype.empty = function () {
    while (this.firstChild) this.removeChild(this.firstChild);
};

Element.prototype.createEl = function (tag: string, options?: { text?: string, cls?: string }) {
    const el = document.createElement(tag);
    if (options?.text !== undefined) el.textContent = options.text;
    if (options?.cls) el.className = options.cls;
    this.appendChild(el);
    return el;
} as any;

Element.prototype.createDiv = function (options?: { text?: string, cls?: string }) {
    return this.createEl("div", options);
};

Element.prototype.createSpan = function (options?: { text?: string, cls?: string }) {
    return this.createEl("span", options);
};

Element.prototype.setText = function (text: string) {
    this.textContent = text;
};

afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
    document.head.innerHTML = "";
});
