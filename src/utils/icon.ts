import { setIcon } from "obsidian";

const SVG_TAGS = new Set([
    "svg", "g", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse",
    "defs", "clipPath", "mask", "linearGradient", "radialGradient", "stop", "title", "desc"
]);

const SVG_ATTRS = new Set([
    "aria-hidden", "aria-label", "class", "clip-path", "cx", "cy", "d", "fill",
    "fill-rule", "height", "id", "mask", "opacity", "points", "r", "rx", "ry",
    "stroke", "stroke-linecap", "stroke-linejoin", "stroke-width", "style",
    "transform", "viewBox", "width", "x", "x1", "x2", "y", "y1", "y2"
]);

const DANGEROUS_VALUE = /(javascript:|data:text\/html|vbscript:)/i;
const EXTERNAL_URL_VALUE = /url\(\s*['"]?(?!#)/i;

function clearElement(el: HTMLElement | Element) {
    while (el.firstChild) el.removeChild(el.firstChild);
}

function isSvgMarkup(value: string) {
    const trimmed = value.trim();
    return trimmed.startsWith("<svg") || trimmed.includes("xmlns=");
}

function sanitizeStyle(value: string) {
    return value
        .split(";")
        .map(item => item.trim())
        .filter(item => item && !DANGEROUS_VALUE.test(item) && !/url\s*\(/i.test(item))
        .join("; ");
}

function sanitizeElement(el: Element): boolean {
    const tag = el.tagName.toLowerCase();
    if (!SVG_TAGS.has(tag)) return false;

    Array.from(el.attributes).forEach(attr => {
        const name = attr.name;
        const lower = name.toLowerCase();
        const value = attr.value;

        if (lower.startsWith("on") || DANGEROUS_VALUE.test(value) || EXTERNAL_URL_VALUE.test(value) || !SVG_ATTRS.has(name)) {
            el.removeAttribute(name);
            return;
        }

        if (lower === "style") {
            const sanitized = sanitizeStyle(value);
            if (sanitized) el.setAttribute(name, sanitized);
            else el.removeAttribute(name);
        }
    });

    Array.from(el.children).forEach(child => {
        if (!sanitizeElement(child)) child.remove();
    });

    return true;
}

export function sanitizeSvgIcon(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (!isSvgMarkup(trimmed)) return undefined;

    const template = document.createElement("template");
    template.innerHTML = trimmed;
    const svg = template.content.firstElementChild;

    if (!svg || svg.tagName.toLowerCase() !== "svg") return undefined;
    if (!sanitizeElement(svg)) return undefined;

    return svg.outerHTML;
}

export function appendSanitizedSvg(target: HTMLElement | Element, svgMarkup: string) {
    const sanitized = sanitizeSvgIcon(svgMarkup);
    if (!sanitized) return false;

    const template = document.createElement("template");
    template.innerHTML = sanitized;
    const svg = template.content.firstElementChild;
    if (!svg) return false;

    target.appendChild(svg);
    return true;
}

export function renderIconLike(target: HTMLElement, icon: string | undefined, fallbackIcon = "box") {
    clearElement(target);
    if (!icon) {
        setIcon(target, fallbackIcon);
        return;
    }

    const trimmed = icon.trim();
    if (isSvgMarkup(trimmed)) {
        if (appendSanitizedSvg(target, trimmed)) return;
        setIcon(target, fallbackIcon);
        return;
    }

    if (!trimmed.includes("<") && !trimmed.includes(">")) {
        setIcon(target, trimmed);
        return;
    }

    setIcon(target, fallbackIcon);
}

export function getElementSvgIcon(el: HTMLElement): string | undefined {
    const svg = el.querySelector("svg");
    return svg ? sanitizeSvgIcon(svg.outerHTML) : undefined;
}
