# Feature and update review

This document captures the current Rack Designer feature set, the recent security/maintenance update, and suggested next improvements.

## App overview

Rack Designer is a local-first rack planning tool. It runs as a Flask app and renders a browser-based rack layout canvas. Users build layouts by dragging equipment from a categorized palette into one or more racks, annotating items, saving named layouts, and exporting final designs.

## User-facing features

### Rack design and navigation

- Create a layout with a default empty rack.
- Choose common rack heights: 24U, 42U, and 48U.
- Add additional racks.
- Rename racks directly from the rack controls.
- Delete the current rack.
- Navigate between racks.
- Toggle between single-rack and all-rack/multi-rack layout views.
- Use fit, 0.5x, 1x, and 2x zoom controls.

### Equipment placement

- Drag equipment from the left sidebar into the rack canvas.
- Sidebar categories include:
  - Servers & Compute
  - Storage
  - Networking
  - Workstations
  - Displays & KVM
  - Power
  - Vertical PDUs
  - Shelf Items
  - Blanking Panels
- Front/rear display can be toggled where rear stencils exist.
- Vertical PDUs can represent full-height, 20U, and 10U devices.
- Blanking plates can be inserted manually or auto-filled.

### Notes and item details

- Select equipment to open the right-hand info panel.
- Edit equipment labels inline.
- Add or edit item notes.
- Show/hide notes globally.
- Drag/position notes visually.
- Align selected notes horizontally from the context menu.

### Layout persistence

- Save a layout with a filename.
- Save over the current layout.
- Save As under a new name.
- Load existing named layouts.
- Delete named layouts.
- Layout files are stored as JSON in the local racks directory.

### Export

- Export the current layout to PDF.
- Export the current layout to image.

### UI polish

- Light/dark theme toggle.
- Searchable equipment palette.
- Collapsible equipment categories.
- Collapsible right-hand info panel.

## Recent update summary

The latest local update focused on making the app safer, reducing risky JavaScript patterns, and improving maintainability.

### Security hardening

- **Flask debug mode disabled by default**
  - Previous behaviour: `debug=True` was always enabled when running `app1.py`.
  - New behaviour: debug mode only turns on when `FLASK_DEBUG=1`, `true`, or `yes`.

- **Local-only default stance**
  - The app now treats itself as a local desktop tool by default.
  - Non-loopback access is rejected unless `RACK_DESIGNER_ALLOW_REMOTE=1` is explicitly set.

- **Same-origin write protection**
  - Mutating requests (`POST`, `DELETE`, etc.) check `Origin`/`Referer` where supplied.
  - Cross-origin writes are rejected with HTTP 403.

- **Layout payload size limit**
  - Flask `MAX_CONTENT_LENGTH` is set from `RACK_DESIGNER_MAX_UPLOAD_BYTES`, defaulting to 1 MB.

- **Safe layout filenames**
  - Layout names are constrained to safe filename characters.
  - Path traversal and symlink-style escapes are blocked by resolving the final path inside the racks directory.

- **Validated layout saves**
  - Saved layouts must be arrays of rack objects.
  - Rack and equipment counts are bounded.
  - Strings and numeric fields are clamped/truncated.
  - Client-only/transient fields are stripped before saving.

- **Atomic writes**
  - Layout saves now write to a temporary file first, then replace the target file.
  - This reduces the chance of corrupted partial saves.

### JavaScript safety

- **Removed runtime stencil code evaluation**
  - Previous behaviour: SVG stencil strings were evaluated using `new Function(...)`.
  - New behaviour: stencils are plain SVG strings and are loaded directly as image data URLs.

- **Reduced XSS risk in the info panel**
  - User-controlled item fields are no longer interpolated into `innerHTML` for the Type/U-position detail lines.
  - Values are inserted with text nodes instead.

### Maintainability improvements

- **Removed duplicated event logic from `ui.js`**
  - The duplicate event-handling block and self-import were removed.
  - Event ownership is clearer: `events.js` handles interactions; `ui.js` handles UI rendering/actions.

- **Cleaner saved-change comparison**
  - Rack-level comparison now removes equipment before comparing rack metadata.
  - This avoids false positives caused by transient item properties.

- **Removed render context mutation from item data**
  - Rendering no longer writes `__renderCtx` onto equipment objects.
  - This keeps persistent layout data cleaner.

- **Safer drag cleanup**
  - Drag ghost cleanup now checks parent existence and uses a one-shot listener.

### Behaviour fixes

- **Fill with Blanking Plates**
  - Existing blanking plates are removed before calculating gaps.
  - Rerunning the command now rebuilds blanks correctly instead of deleting previously filled spaces after the occupancy calculation.

- **Rack resizing**
  - When shrinking a rack, equipment is filtered/repositioned so it remains inside valid rack bounds.

- **Drag finalisation**
  - Mouse-up handling now uses the window so drags can finish even if the pointer leaves the canvas.

## Suggested next updates

### Priority 1 — Reliability and test coverage

1. **Add automated tests for Flask endpoints**
   - Save/load/delete happy paths.
   - Invalid filenames.
   - Cross-origin write rejection.
   - Invalid layout schema rejection.
   - Oversized payload rejection.

2. **Add a small frontend smoke test**
   - Load the app.
   - Confirm there are no console errors.
   - Add/select an item.
   - Verify info panel text rendering.
   - Save/load/delete a layout.

3. **Add dependency files**
   - `requirements.txt` or `pyproject.toml` for Python.
   - Optional `package.json` if frontend tooling/tests are added.

4. **Add CI**
   - Run Python compile/tests.
   - Validate JSON files.
   - Run `node --check` for JavaScript syntax.
   - Run Bandit for Flask security checks.

### Priority 2 — Data model and import/export robustness

1. **Version the layout schema**
   - Add `schemaVersion` to saved layout files.
   - Provide migration logic for older layouts.

2. **Separate client state from persisted layout data**
   - Define one canonical layout DTO/save format.
   - Avoid saving UI-only fields such as selection, drag offsets, render state, temporary IDs, or bounds.

3. **Add backup/restore support**
   - Before overwrite/delete, optionally create a backup copy.
   - Add a recovery screen for recent deleted/overwritten layouts.

4. **Add explicit import/export JSON buttons**
   - Let users download/upload a `.json` layout file without manually browsing the `racks/` folder.

### Priority 3 — UI and workflow improvements

1. **Improve shelf-item movement**
   - Shelf-item drag is currently conservative because commit behaviour needs deeper work.
   - Implement reliable move between parents and positions.

2. **Improve collision/fit feedback**
   - Show visual invalid-drop indicators.
   - Prevent overlapping standard rack items.
   - Warn before placing items outside rack capacity.

3. **Add undo/redo**
   - Most rack design operations would benefit from command-history undo/redo.

4. **Improve notes workflow**
   - Multi-select notes more discoverably.
   - Add note styling options.
   - Add note snap/align guides.

5. **Improve rack presets**
   - Add custom rack sizes.
   - Add common rack templates.
   - Add reusable saved equipment presets.

### Priority 4 — Security and deployment choices

1. **If remote/network access is needed, add authentication**
   - The current protections are appropriate for a local desktop app.
   - If exposed beyond localhost, add real authentication, CSRF tokens, HTTPS, and a reverse proxy config.

2. **Add a Content Security Policy**
   - Restrict script execution.
   - Consider removing third-party font dependency or pinning/serving fonts locally.

3. **Add structured logging**
   - Log save/load/delete actions without exposing layout contents.
   - Log validation failures for debugging.

4. **Package as a desktop app or local service**
   - A local wrapper could manage startup, browser opening, and the racks storage directory.

## Known caveats after this update

- There is still no formal test suite in the repo.
- The app still uses broad client-side global/module state; larger feature changes should avoid expanding that pattern.
- The frontend still contains some `innerHTML` for static SVG/icons and static messages. The high-risk user-data interpolation was addressed, but a future pass should continue reducing unnecessary `innerHTML` usage.
- Shelf-item drag/move behaviour needs a dedicated design pass rather than another quick patch.
- If `RACK_DESIGNER_ALLOW_REMOTE=1` is used, same-origin checks alone are not enough for hostile networks; add authentication before exposing it.

## Recommended release note

> Hardened Rack Designer for safer local use: disabled Flask debug by default, added local/same-origin write protections, validated and atomically saved layouts, removed runtime stencil code evaluation, reduced info-panel XSS risk, removed duplicated event code, and fixed blanking plate/rack resize edge cases.
