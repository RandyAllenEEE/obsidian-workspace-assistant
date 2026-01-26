# Obsidian Assistant

An all-in-one assistant plugin that integrates multiple powerful Obsidian plugins into a unified, modular system. Obsidian Assistant combines the functionality of popular plugins while adding improvements in architecture, internationalization, and user experience.

## 🌟 Features

Obsidian Assistant provides **five independent modules**, each can be enabled or disabled separately:

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

### Manual Build

```bash
# Clone the repository
git clone https://github.com/yourusername/obsidian-assistant.git
cd obsidian-assistant

# Install dependencies
npm install

# Build the plugin
npm run build
```

---

## 🚀 Usage

### Module Management
Each module can be independently enabled or disabled in the plugin settings:
1. Open Settings → Obsidian Assistant
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

Obsidian Assistant supports multiple languages:
- 🇬🇧 English
- 🇨🇳 简体中文 (Simplified Chinese)

The language will automatically match your Obsidian interface language.

---

## 🙏 Acknowledgments

Obsidian Assistant integrates and enhances the work of several amazing plugin developers. We are deeply grateful to:

### Original Plugin Authors

1. **[chetachi](https://github.com/chetachiezikeuzor)** - Creator of [MySnippets Plugin](https://github.com/chetachiezikeuzor/mysnippets-plugin)
   - Original CSS snippet manager with status bar integration

2. **[JonasDoesThings](https://github.com/JonasDoesThings)** - Creator of [Hide Folders](https://github.com/JonasDoesThings/obsidian-hide-folders)
   - Original folder visibility management system

3. **[Alan Grainger](https://github.com/alangrainger)** - Creator of [Lazy Plugin Loader](https://github.com/alangrainger/obsidian-lazy-plugins)
   - Original delayed plugin loading mechanism

4. **[Kacper Darowski (opisek)](https://opisek.net/)** - Creator of [Status Bar Organizer](https://github.com/Phrisk/obsidian-statusbar-organizer)
   - Original status bar customization system

5. **[Mara V (marah)](https://github.com/marah)** - Creator of [Obsidian Quick Peek Sidebar](https://github.com/marah/obsidian-quick-peek-sidebar)
   - Original sidebar auto-hide and hover interaction logic

---

## 📄 License

MIT License

Copyright (c) 2026 Randy Allen

This project integrates code from multiple open-source plugins (see Acknowledgments). Each original plugin retains its original license and copyright. The integration work, TypeScript refactoring, and enhancements are licensed under MIT.
