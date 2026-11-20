## Changelog
### 1.0.7
- Increase the default wrap width to 350 px and enlarge note markers and their click targets
- Make recursive folding show the selected node's immediate children while folding or expanding all deeper branches
- Group SVG, PNG, and HTML exports in one menu and add offline PNG export
- Let folding controls use the clicked preview node and fix cursor selection on indented list items
- Migrate the offline preview to Markmap 1.1.1, including MathJax formulas and the new node and options model
- Add a Level menu for folding to a selected depth or expanding all nodes
- Adapt source navigation, gestures, images, and exports to the 1.x renderer
- Markdown paragraphs, tables, and code blocks are now notes; 0.18 options must be updated to their 1.x equivalents

### 1.0.6
- Zoom the mind map with two-finger scrolling, with improved sensitivity
- Reduce momentum zoom when supported by the embedded browser
- Update markmap-view to 0.18.13

### 1.0.5
- Forward native macOS trackpad pinch gestures to the preview, preserving the zoom anchor
- Apply two-finger pan events immediately and interrupt competing viewport animations
- Clarify the center-and-fit toolbar tooltip

### 1.0.4
- Support IntelliJ Platform 2025.3 and later with Java 21 and Kotlin 2.2 compatibility
- Use compatible file navigation and support both bundled and standalone JCEF

### 1.0.3
- Coalesce rapid edits and discard outdated preview updates
- Reduce redundant cursor highlighting and viewport movement
- Parse Markdown once per update while preserving mixed lists, code blocks, and source line mapping

### 1.0.2
- Require IntelliJ Platform 2026.3 or later
- Preserve list items alongside code blocks under the same heading
- Update file saving and file opening API calls
- Update IntelliJ IDEA 2026.3 build tooling and JCEF dependencies

### 1.0.1
- Updated the Markmap Jet plugin icon

### 1.0.0
- Initial release
- Interactive mind map preview for Markdown files
- Theme-aware UI with automatic light/dark mode switching
- Three flexible view modes: Editor, Split, Preview
- Zoom in/out and center controls for easy navigation
- Real-time preview updates as you type
- Click-to-expand/collapse node functionality
- Smooth animations and transitions


