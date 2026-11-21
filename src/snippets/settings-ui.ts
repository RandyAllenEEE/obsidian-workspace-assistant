import { Setting, TextAreaComponent } from "obsidian";
import { SnippetsManager } from "./manager";
import { setAttributes } from "./util/setAttributes";
import { t } from "../i18n/helpers";

export function renderSnippetsSettings(containerEl: HTMLElement, manager: SnippetsManager) {
    // We access settings via manager.settings which references plugin.settings.mySnippets
    const settings = manager.settings;

    new Setting(containerEl)
        .setName(t("Show Status Bar Icon"))
        .setDesc(t("Toggle the visibility of the snippets icon in the status bar."))
        .addToggle((toggle) => {
            toggle
                .setValue(settings.showStatusBarIcon)
                .onChange(async (value) => {
                    settings.showStatusBarIcon = value;
                    await manager.saveSettings();
                    manager.updateStatusBar();
                });
        });

    const snippetsSection = containerEl.createEl("details", { cls: "assistant-module-frame assistant-settings-subsection" });
    snippetsSection.createEl("summary", {
        cls: "assistant-settings-section-header",
        text: t("Manage Snippets")
    });
    renderSnippetsList(snippetsSection.createDiv(), manager);

    new Setting(containerEl)
        .setName(t("Glass menu effect"))
        .setDesc(
            t("Choose to change the background from the secondary background color of your theme to a glass background.")
        )
        .addToggle((toggle) => {
            toggle
                .setValue(settings.aestheticStyle)
                .onChange(async (value) => {
                    settings.aestheticStyle = value;
                    await manager.saveSettings();
                });
        });

    new Setting(containerEl)
        .setName(t("Auto open new snippet"))
        .setDesc(
            t("Choose whether or not to open CSS snippet files immeditaley after creating them. It will open in your default app.")
        )
        .addToggle((toggle) => {
            toggle
                .setValue(settings.openSnippetFile)
                .onChange(async (value) => {
                    settings.openSnippetFile = value;
                    await manager.saveSettings();
                });
        });
    new Setting(containerEl)
        .setName(t("Set new snippet status"))
        .setDesc(
            t("Choose whether or not to have newly created CSS snippet files toggled on automatically upon creation.")
        )
        .addToggle((toggle) => {
            toggle
                .setValue(settings.snippetEnabledStatus)
                .onChange(async (value) => {
                    settings.snippetEnabledStatus = value;
                    await manager.saveSettings();
                });
        });

    const stylingTemplateSetting = new Setting(containerEl);
    stylingTemplateSetting.settingEl.setAttribute(
        "style",
        "display: grid; grid-template-columns: 1fr;"
    );
    stylingTemplateSetting
        .setName(t("CSS snippet template"))
        .setDesc(
            t("Set default CSS styling as a template for new CSS files you choose to create.")
        );

    const stylingTemplateContent = new TextAreaComponent(
        stylingTemplateSetting.controlEl
    );
    setAttributes(stylingTemplateContent.inputEl, {
        style: "margin-top: 12px; width: 100%;  height: 32vh;",
        class: "ms-css-editor",
    });
    stylingTemplateContent

        .setValue(settings.stylingTemplate)
        .onChange(async (value) => {
            settings.stylingTemplate = value;
            await manager.saveSettings();
        });
}

function renderSnippetsList(containerEl: HTMLElement, manager: SnippetsManager) {
    containerEl.empty();
    const app = manager.app;
    const customCss = app.customCss;
    const currentSnippets = customCss.snippets;

    new Setting(containerEl)
        .setName(t("Scan Snippets"))
        .setDesc(t("Scan and refresh CSS snippet list"))
        .addButton(button => button
            .setButtonText(t("Scan"))
            .onClick(async () => {
                await customCss.requestLoadSnippets();
                renderSnippetsList(containerEl, manager);
            }));

    if (currentSnippets.length === 0) {
        containerEl.createEl("p", { text: t("No CSS snippets found.") });
        return;
    }

    currentSnippets.forEach((snippet: string) => {
        new Setting(containerEl)
            .setName(snippet)
            .addToggle((toggle) => {
                toggle
                    .setValue(customCss.enabledSnippets.has(snippet))
                    .onChange((value) => {
                        customCss.setCssEnabledStatus(snippet, value);
                    });
            });
    });
}


