import { describe, expect, it } from "vitest";
import { renderIconLike, sanitizeSvgIcon } from "../src/utils/icon";

describe("SVG icon sanitizing", () => {
    it("removes script, event handlers, and dangerous urls", () => {
        const sanitized = sanitizeSvgIcon(`
            <svg viewBox="0 0 16 16" onclick="alert(1)">
                <script>alert(1)</script>
                <path d="M0 0" fill="url(javascript:alert(1))" onload="alert(2)" />
                <circle cx="1" cy="1" r="1" style="fill:red; background:url(javascript:bad)" />
            </svg>
        `);

        expect(sanitized).toContain("<svg");
        expect(sanitized).not.toContain("script");
        expect(sanitized).not.toContain("onclick");
        expect(sanitized).not.toContain("onload");
        expect(sanitized).not.toContain("javascript:");
        expect(sanitized).not.toContain("url(");
    });

    it("renders lucide icon names through setIcon fallback path", () => {
        const target = document.createElement("span");

        renderIconLike(target, "search");

        expect(target.getAttribute("data-icon")).toBe("search");
    });

    it("falls back for invalid markup", () => {
        const target = document.createElement("span");

        renderIconLike(target, "<img src=x onerror=alert(1)>", "box");

        expect(target.getAttribute("data-icon")).toBe("box");
        expect(target.innerHTML).not.toContain("img");
    });

    it("allows internal svg references but removes external url references", () => {
        const sanitized = sanitizeSvgIcon(`
            <svg viewBox="0 0 16 16">
                <defs><clipPath id="clip"><path d="M0 0" /></clipPath></defs>
                <path d="M0 0" clip-path="url(#clip)" mask="url(https://example.com/mask.svg)" />
            </svg>
        `);

        expect(sanitized).toContain('clip-path="url(#clip)"');
        expect(sanitized).not.toContain("https://example.com");
        expect(sanitized).not.toContain("mask=");
    });
});
