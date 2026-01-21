# MindNote Plugin Specification

## Overview
MindNote is an Obsidian plugin that organizes vault files using mindmap nodes, providing visual directory operations through the mind-elixir library.

---

## Core Concepts

### Bundle Structure (`.mn` folder)
```
{filename}.mn/          # Bundle root (treated as single entity)
  ├── md/               # Markdown files (one per node)
  ├── img/              # Image resources
  ├── file/             # Other resources (.txt, .pdf, .xlsx, .json)
  └── map.mn            # Mindmap structure (JSON)
```

### Node Data Structure
```typescript
interface MindNode {
  id: string;           // Unique identifier (hex string)
  topic: string;        // Node display text
  filepath: string;     // Associated markdown filename (relative to md/)
  children: MindNode[]; // Child nodes
  expanded: boolean;    // Expansion state
}
```

### Map File (`map.mn`)
```json
{
  "nodeData": {
    "id": "root_id",
    "topic": "Root Topic",
    "filepath": "root.md",
    "children": [...],
    "expanded": true
  }
}
```

---

## Functional Requirements

### FR-1: Bundle Management
| ID | Requirement |
|----|-------------|
| FR-1.1 | Create new MindNote bundles via sidebar menu |
| FR-1.2 | Open existing bundles via right-click context menu |
| FR-1.3 | Register `.mn` file type to open parent bundle |
| FR-1.4 | Close all related files when bundle view closes |

### FR-2: Mindmap Operations
| ID | Requirement |
|----|-------------|
| FR-2.1 | Display mindmap using mind-elixir with all default features |
| FR-2.2 | Apply settings on mindmap open (direction, theme, gaps, etc.) |
| FR-2.3 | Support node creation with automatic markdown file creation |
| FR-2.4 | Support node editing with markdown file renaming |
| FR-2.5 | Support node deletion with cascade resource cleanup |
| FR-2.6 | Support node moving/reparenting |
| FR-2.7 | Enter edit mode on spacebar press |

### FR-3: Node-Markdown Synchronization
| ID | Requirement |
|----|-------------|
| FR-3.1 | Create markdown file when node is created |
| FR-3.2 | Rename markdown file when node topic changes |
| FR-3.3 | Handle illegal filename characters (replace with `_`) |
| FR-3.4 | Handle duplicate filenames (append `_1`, `_2`, etc.) |
| FR-3.5 | Open node's markdown in right pane on click |
| FR-3.6 | Save previous markdown before opening new one |

### FR-4: Image & Resource Handling
| ID | Requirement |
|----|-------------|
| FR-4.1 | Create image nodes on image drop/paste |
| FR-4.2 | Store images in `img/` folder |
| FR-4.3 | Display proportional thumbnails in image nodes |
| FR-4.4 | Open image preview modal on thumbnail double-click |
| FR-4.5 | Edit topic on text double-click (not thumbnail) |
| FR-4.6 | Handle other resources (store in `file/` folder) |

### FR-5: Paste Handling
| ID | Requirement |
|----|-------------|
| FR-5.1 | Detect clipboard content type |
| FR-5.2 | Use default paste for node data |
| FR-5.3 | Create image node for image data |
| FR-5.4 | Parse and create node hierarchy for text data |

### FR-6: History Management
| ID | Requirement |
|----|-------------|
| FR-6.1 | Track all node operations (create, delete, move, edit) |
| FR-6.2 | Support `Ctrl+Z` for undo |
| FR-6.3 | Support `Ctrl+Shift+Z` for redo |
| FR-6.4 | Include resource files in history (markdown, images) |
| FR-6.5 | Use Obsidian internal mechanisms |

### FR-7: Image Preview
| ID | Requirement |
|----|-------------|
| FR-7.1 | Display image with scroll-wheel zoom |
| FR-7.2 | Reset to original size on double-click |
| FR-7.3 | Show close button in top-right corner |

### FR-8: Obsidian Integration
| ID | Requirement |
|----|-------------|
| FR-8.1 | Display node topic in tab (not filename) |
| FR-8.2 | Display node topic in system taskbar |
| FR-8.3 | Prevent manual rename of node-opened markdown |
| FR-8.4 | Intercept resource drops/pastes in bundle markdown |

---

## Plugin Settings

```typescript
interface MindNoteSettings {
  direction: 0 | 1 | 2;       // 0:Left, 1:Right, 2:Both
  theme: 'primary' | 'dark' | 'auto';
  horizontalGap: number;      // --node-gap-x
  verticalGap: number;        // --node-gap-y
  mainHorizontalGap: number;  // --main-gap-x
  mainVerticalGap: number;    // --main-gap-y
  topicPadding: number;       // --topic-padding
  nodeRadius: number;         // --main-radius
  rootRadius: number;         // --root-radius
  lineWidth: number;          // stroke-width
}

const DEFAULT_SETTINGS: MindNoteSettings = {
  direction: 1,
  theme: 'primary',
  horizontalGap: 10,
  verticalGap: 5,
  mainHorizontalGap: 5,
  mainVerticalGap: 5,
  topicPadding: 5,
  nodeRadius: 3,
  rootRadius: 3,
  lineWidth: 1
};
```

---

## Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Use Obsidian API exclusively (no direct filesystem) |
| NFR-2 | Use `Vault.process()` for atomic file operations |
| NFR-3 | Use `FileManager.trashFile()` for deletions |
| NFR-4 | Use `registerEvent()` for automatic cleanup |
| NFR-5 | No stored view references in plugin |
| NFR-6 | Cross-platform path handling with `normalizePath()` |
| NFR-7 | Keyboard accessibility for all interactions |
| NFR-8 | Mobile compatibility (no iOS-incompatible features) |

