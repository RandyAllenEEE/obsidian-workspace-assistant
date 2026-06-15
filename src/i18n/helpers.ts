import { moment } from "obsidian";
import en from "./locales/en";
import zh from "./locales/zh";

const localeMap: { [k: string]: Partial<typeof en> } = {
    en,
    zh,
    "zh-cn": zh,
};

const locale = localeMap[moment.locale()];

export function t(str: string): string {
    const key = str as keyof typeof en;

    if (!locale) {
        return en[key] || str;
    }

    return locale[key] || en[key] || str;
}
