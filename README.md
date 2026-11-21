# Workspace Assistant

An all-in-one assistant plugin that integrates multiple powerful Obsidian plugins into a unified, modular system. Workspace Assistant combines the functionality of popular plugins while adding improvements in architecture, internationalization, and user experience.

## 🌟 Features

Workspace Assistant provides **five independent modules**, each can be enabled or disabled separately:

### 📝 MySnippets - CSS Snippet Manager
Manage your CSS snippets with ease through a convenient status bar menu.
- Toggle snippets on/off with a single click
- Quick access to snippet files
- Create new snippets with templates
- Reload snippets without restarting Obsidian
- Glass menu effect option

### 📁 MyFolders - Folder Visibility Manager
Hide and show folders in your file explorer to reduce visual clutter.
- Hide specific folders by name
- Support for exact match, `startsWith::`, and `endsWith::` patterns
- Case-insensitive matching option
- Add hidden folders to Obsidian's exclusion list
- Compatible with quick-explorer plugin

### ⚡ MyPlugins - Lazy Plugin Loader  
Optimize Obsidian's startup time by delaying plugin loading.
- Four loading modes: Disabled, Instant, Short delay, Long delay
- Configure individual plugins with different startup times
- Separate desktop/mobile configurations
- Batch operations for quick setup
- Staggered loading to prevent performance spikes

### 🎛️ MyStatusBar - Status Bar Organizer
Customize your status bar by reordering and hiding elements.
- Drag-and-drop reordering
- Toggle element visibility

### 📏 MySideBar - Advanced Sidebar Manager
Complete control over your Obsidian sidebars, tabs, and ribbons.
- **Auto Hide**: Automatically collapse and expand sidebars on hover.
  - **Smart Pinning**: Manually expanding the sidebar "pins" it open.
  - **Overlay Mode**: Sidebars slide over content without resizing the editor.
- **Contextual Groups**: Combine two sidebar tabs (Master & Slave) into a single functional unit.
  - **Split View**: Automatically open the Slave view below the Master view.
  - **Auto-Sort**: Slave tab automatically follows the Master tab.
- **Sidebar Tab Manager**: Drag-and-drop to reorder all sidebar tabs.
- **Ribbon Manager**: Reorder and hide ribbon icons.

---

## 📦 Installation

### From a GitHub Release

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/RandyAllenEEE/obsidian-workspace-assistant/releases/latest).
2. Copy the files to `.obsidian/plugins/obsidian-workspace-assistant/` in your vault.
3. Restart Obsidian and enable Workspace Assistant. For upgrades, replace the three release files and keep `data.json`.

### Migrate an existing Obsidian Assistant installation

If your vault already uses `obsidian-assistant`, download the three new release
attachments into one directory. From a clone of this repository, preview the
migration with Node.js 24:

```sh
node scripts/migrate-installation.mjs "/path/to/vault/.obsidian" "/path/to/release"
```

Close Obsidian on devices using the vault and pause any sync that copies its
configuration. Run the same command with `--apply`, then reopen Obsidian.
The script moves the old installation into a backup next to the vault, preserves
its settings, and updates the enabled-plugin list, shortcuts, and workspace
references. Keep the backup until you have verified your settings. If needed,
close Obsidian, move the new installation out of the plugins directory, then
restore the old plugin folder and the backed-up JSON files to their original
locations.

If a button or automation uses an exact command display name such as
`Obsidian Assistant: …`, update the prefix to `Workspace Assistant: …`.

### Manual Build

```bash
# Clone the repository
git clone https://github.com/RandyAllenEEE/obsidian-workspace-assistant.git
cd obsidian-workspace-assistant

# Install dependencies with Node.js 24
npm ci

# Build the plugin
npm run build
```

The installable files are in `build/`.

### Publishing

Run the checks in [the release workflow](.github/workflows/release.yml) and push the updated default branch. Once its checks pass, push only the `X.Y.Z` tag that matches `manifest.json`. The tag run rebuilds, packages, and verifies the attachments before publishing the GitHub Release.

---

## 🚀 Usage

### Module Management
Each module can be independently enabled or disabled in the plugin settings:
1. Open Settings → Workspace Assistant
2. Navigate to the module you want to configure
3. Toggle the "Enable" switch

### Module-Specific Guides

#### MySnippets
- Click the CSS snippet icon in the status bar
- Use command palette: "Open snippets in status bar" or "Create new CSS snippet"

#### MyFolders
- Configure folders to hide in settings
- Click the ribbon icon or use command: "Toggle visibility of hidden folders"

#### MyPlugins
- Configure plugin loading modes in settings
- Plugins will automatically load with the specified delay on startup

#### MyStatusBar
- Configure element order and visibility in settings

#### MySideBar
- **Auto Hide**: Enable "Auto Hide" for hover expansion.
- **Contextual Groups**: Click "Add Group" to bind two views (e.g. Explorer + Outline).

---

## 🌐 Internationalization

Workspace Assistant supports multiple languages:
- 🇬🇧 English
- 🇨🇳 简体中文 (Simplified Chinese)

The language will automatically match your Obsidian interface language.

---

## 🙏 Acknowledgments

Workspace Assistant integrates and enhances the work of several amazing plugin developers. We are deeply grateful to:

### Original Plugin Authors

1. **[chetachi](https://github.com/chetachiezikeuzor)** - Creator of [MySnippets Plugin](https://github.com/chetachiezikeuzor/mysnippets-plugin)
   - Original CSS snippet manager with status bar integration

2. **[JonasDoesThings](https://github.com/JonasDoesThings)** - Creator of [Hide Folders](https://github.com/JonasDoesThings/obsidian-hide-folders)
   - Original folder visibility management system

3. **[Alan Grainger](https://github.com/alangrainger)** - Creator of [Lazy Plugin Loader](https://github.com/alangrainger/obsidian-lazy-plugins)
   - Original delayed plugin loading mechanism

4. **[Kacper Darowski (opisek)](https://opisek.net/)** - Creator of [Status Bar Organizer](https://github.com/Opisek/obsidian-statusbar-organizer)
   - Original status bar customization system

5. **[Bradley Wyatt](https://github.com/bwya77)** - Creator of [Obsidian Quick Peek Sidebar](https://github.com/bwya77/obsidian-quick-peek-sidebar)
   - Original sidebar auto-hide and hover interaction logic

---

## 📄 License

The combined release is distributed under [GPL-3.0-only](LICENSE). Randy Allen's
original contributions are also available under the [MIT License](licenses/Workspace-Assistant-MIT.txt).
The [third-party notices](THIRD_PARTY_NOTICES.md) identify the upstream terms and
the corresponding source available with each Release.
