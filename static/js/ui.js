// ui.js
import * as api from './api.js';
import { canvas, drawRack, drawRackForExport } from './canvas.js'; // Import canvas directly
import * as constants from './constants.js';
import { getNoteDrawingMetrics } from './renderer.js';
import * as state from './state.js';
import * as ui from './ui.js'; // Make sure ui is imported
import * as utils from './utils.js';

let hasInitializedEvents = false;
let interactionStartedOnUI = false; // NEW: Flag to track where mousedown occurred

/**
 * NEW: Aligns the horizontal position of all selected notes to match the target note.
 */
function alignSelectedNotesHorizontally() {
    if (!state.contextMenuTargetNoteItem || state.selectedNotes.length < 2) {
        console.warn("Align Notes cancelled: Not enough items or no target note.");
        return;
    }

    const { item: targetItem } = state.contextMenuTargetNoteItem;

    if (!targetItem || !targetItem.noteOffset) {
        console.error("Target item for alignment is invalid or has no note offset.");
        return;
    }

    const targetX = targetItem.noteOffset.x;

    // Iterate through all selected parent items
    state.selectedNotes.forEach(sel => {
        const noteOwner = sel.noteOwner;

        // Align the note of the main item itself, if it has one and a noteOffset
        if (noteOwner.notes && noteOwner.noteOffset) {
            noteOwner.noteOffset.x = targetX;
        }
    });

    drawRack();
    ui.updateInfoPanel();
}


/**
 * LOCAL HELPER: Finds which note is under the mouse cursor in single-rack view.
 * @param {{x: number, y: number}} worldPos The mouse position in world coordinates.
 * @returns {object|null} An object { item, parent, rackIndex, noteOwner } if a note is found, otherwise null.
 */
function getNoteUnderMouse(worldPos) {
    // This functionality is only intended for single-rack view.
    if (state.isMultiRackView || state.activeRackIndex === -1) {
        return null;
    }

    const activeRackData = state.racks[state.activeRackIndex];
    if (!activeRackData) return null; // FIX: Ensure the active rack exists before proceeding.

    const actualRackXOffset = 0; // In single rack view, the active rack is drawn at world X=0
    const estimatedNoteFontSize = Math.max(9, Math.min(16, constants.BASE_UNIT_HEIGHT * 0.35));

    // Nested function to check a single item's note
    const checkItemNoteHit = (item, parentItem = null) => {
        if (!item.notes || item.notes.trim() === '') return null;

        let itemRect;
        if (item.type === 'shelf-item') {
            if (!parentItem) return null;
            const parentTopY = parentItem.y * constants.BASE_UNIT_HEIGHT;
            const drawW = item.size.width * constants.SHELF_ITEM_RENDER_SCALE;
            const drawH = item.size.height * constants.SHELF_ITEM_RENDER_SCALE;
            const eqLeft = constants.BASE_UNIT_HEIGHT * 1.25 - constants.BASE_UNIT_HEIGHT * 0.2;
            const drawX = eqLeft + item.x;
            const drawY = parentTopY - drawH;
            itemRect = { x: drawX, y: drawY, w: drawW, h: drawH };
        } else {
            const topY = item.y * constants.BASE_UNIT_HEIGHT;
            const itemHeight = item.u * constants.BASE_UNIT_HEIGHT;
            const railLeft = constants.BASE_UNIT_HEIGHT * 1.25;
            const eqPadding = constants.BASE_UNIT_HEIGHT * 0.2;
            const eqLeft = railLeft - eqPadding;
            const eqWidth = constants.WORLD_WIDTH - (constants.BASE_UNIT_HEIGHT * 1.25 * 2) + (eqPadding * 2);
            itemRect = { x: eqLeft, y: topY, w: eqWidth, h: itemHeight };
        }

        const currentNoteOffset = item.noteOffset || { x: constants.DEFAULT_NOTE_OFFSET_X, y: constants.DEFAULT_NOTE_OFFSET_Y };
        const noteBounds = getNoteDrawingMetrics(item, itemRect, currentNoteOffset, estimatedNoteFontSize, state.scale, true).noteBox;

        if (noteBounds &&
            worldPos.x >= noteBounds.x && worldPos.x <= noteBounds.x + noteBounds.w &&
            worldPos.y >= noteBounds.y && worldPos.y <= noteBounds.y + noteBounds.h) {
            return { item: (parentItem || item), parent: parentItem, rackIndex: state.activeRackIndex, noteOwner: item };
        }
        return null;
    };

    // Iterate through all items in the active rack
    for (const item of activeRackData.equipment) {
        let hit = checkItemNoteHit(item);
        if (hit) return hit;

        if (item.shelfItems) {
            for (const shelfItem of item.shelfItems) {
                hit = checkItemNoteHit(shelfItem, item);
                if (hit) return hit;
            }
        }
    }

    return null; // No note found under the cursor
}


/**
 * Handles the mouse down event on the canvas.
 * @param {MouseEvent} e The mouse down event object.
 */
const handleMouseDown = (e) => {
    // If a rack name is being edited on the canvas, prevent other canvas interactions.
    if (state.editingRackName) {
        e.preventDefault();
        e.stopPropagation();
        return;
    }

    // NEW: if we clicked anywhere in the info-panel, set the flag and skip canvas logic
    if (e.target.closest('#right-info-panel')) {
        interactionStartedOnUI = true;
        return;
    }
    interactionStartedOnUI = false; // Reset flag for canvas interactions

    ui.hideContextMenu();

    // NEW: Shift + Left Click for panning
    if (e.button === 0 && e.shiftKey) {
        e.preventDefault(); // Prevent default browser actions for Shift+click
        state.setIsPanning(true);
        canvas.classList.add('panning');
        state.setPanStart({ x: e.clientX, y: e.clientY });
        return; // Important: return immediately if panning
    }

    // Original middle mouse button panning (keep as an alternative if a mouse is connected)
    if (e.button === 1) { // Middle mouse for panning
        e.preventDefault();
        state.setIsPanning(true);
        canvas.classList.add('panning');
        state.setPanStart({ x: e.clientX, y: e.clientY });
        return; // Important: return immediately if panning
    }

    if (e.button !== 0) return; // Only left-click (and not Shift+Left Click)

    const worldPos = utils.getMouseWorldPos(e);

    // REVISED: Check for note click first, with improved selection and drag logic.
    if (!state.isMultiRackView) {
        // Handle note-specific interactions (selection, dragging)
        const hitNoteInfo = getNoteUnderMouse(worldPos);
        if (hitNoteInfo) {
            const { item: mainItemToSelect, parent: parentItem, rackIndex, noteOwner } = hitNoteInfo;
            const isNoteInSelection = state.selectedNotes.some(sel => sel.noteOwner === noteOwner);

            // If clicking a note in the current selection (and not Alt-clicking), start a group drag.
            if (isNoteInSelection && !e.altKey) {
                state.setIsDraggingNoteSelection(true);
                const initialOffsets = new Map();
                state.selectedNotes.forEach(sel => {
                    initialOffsets.set(sel.noteOwner, { ...sel.noteOwner.noteOffset });
                });
                state.setNoteSelectionDragData({
                    dragStartMouseWorldPos: worldPos,
                    initialOffsets: initialOffsets
                });
                canvas.style.cursor = 'grabbing';
                return; // Group drag initiated, exit.
            }

            // ALT-CLICK: Select/deselect the note itself, independent of equipment
            if (e.altKey) {
                const noteSelectionObject = { noteOwner: noteOwner, rackIndex: rackIndex };
                const existingNoteIndex = state.selectedNotes.findIndex(n => n.noteOwner === noteOwner);

                if (e.ctrlKey) { // Ctrl+Alt+Click to add/remove from note selection
                    if (existingNoteIndex > -1) {
                        state.selectedNotes.splice(existingNoteIndex, 1);
                    } else {
                        state.selectedNotes.push(noteSelectionObject);
                    }
                } else { // Alt+Click to replace note selection
                    if (existingNoteIndex > -1 && state.selectedNotes.length === 1) {
                        state.setSelectedNotes([]); // Deselect if it's the only one selected
                    } else {
                        state.setSelectedNotes([noteSelectionObject]); // Select only this note
                    }
                }

                state.setSelectedItems([]); // Clear equipment selection when selecting notes
                drawRack();
                ui.updateInfoPanel(); // Update panel to show "note selected" message
                return; // Note selection action taken, so we exit.
            }

            // REGULAR CLICK on a single, unselected note: Drag the note, but manage equipment selection
            state.setSelectedNotes([]); // Clear note selection when dragging a single, unselected note
            state.setIsDraggingNote(true);
            const currentNoteOffset = noteOwner.noteOffset || { x: constants.DEFAULT_NOTE_OFFSET_X, y: constants.DEFAULT_NOTE_OFFSET_Y };
            state.setDraggedNoteItemInfo({
                item: noteOwner, // Dragging the specific item that owns the note
                rackIndex: rackIndex,
                initialNoteOffset: { ...currentNoteOffset },
                tempNoteOffset: { ...currentNoteOffset },
                dragStartMouseWorldPos: { x: worldPos.x, y: worldPos.y }
            });
            canvas.style.cursor = 'grab';

            // Handle selection of the note's parent item
            if (e.ctrlKey) {
                const index = state.selectedItems.findIndex(sel => sel.item === mainItemToSelect);
                if (index > -1) {
                    state.selectedItems.splice(index, 1);
                } else {
                    state.selectedItems.push({ item: mainItemToSelect, parent: parentItem, rackIndex });
                }
            } else {
                const isAlreadySelected = state.selectedItems.some(sel => sel.item === mainItemToSelect);
                if (!isAlreadySelected) {
                    state.setSelectedItems([{ item: mainItemToSelect, parent: parentItem, rackIndex }]);
                }
            }

            drawRack();
            ui.updateInfoPanel();
            return; // Note action was taken, so we exit.
        }
    }

    if (state.isMultiRackView) {
        let rackActionTaken = false;
        for (let i = 0; i < state.racks.length; i++) {
            const rackData = state.racks[i];

            const bounds = rackData.deleteBtnBounds;
            if (bounds &&
                worldPos.x >= bounds.x && worldPos.x <= bounds.x + bounds.w &&
                worldPos.y >= bounds.y && worldPos.y <= bounds.y + bounds.h) {
                ui.deleteRack(i);
                rackActionTaken = true;
                break;
            }

            const nameBounds = rackData.nameBounds;
            if (nameBounds &&
                worldPos.x >= nameBounds.x && worldPos.x <= nameBounds.x + nameBounds.w &&
                worldPos.y >= nameBounds.y && worldPos.y <= nameBounds.y + nameBounds.h) {
                // If a drag/reorder is intended, initiate it here.
                // However, for typical UI, a click on name *starts* drag, dbl-click *starts* edit.
                // Since this is handleMouseDown (single click), it should primarily select or start drag.
                // We'll let dblclick handle editing, and single click on name just sets active rack or starts drag
                state.setIsDraggingRack(true);
                state.setDraggedRackIndex(i);
                const rackXStart = i * (constants.WORLD_WIDTH + constants.RACK_SPACING);
                state.setDraggedRackGhost({ x: rackXStart });
                state.setDragAnchor({ offsetX: worldPos.x - rackXStart });
                state.setDropTargetIndex(i);
                rackActionTaken = true;
                break;
            }
        }
        if (rackActionTaken) {
            drawRack();
            ui.updateInfoPanel();
            return;
        }
    }

    const rackInfo = utils.getRackFromWorldPos(worldPos);
    if (!rackInfo) {
        state.setIsSelecting(true);
        state.setIsNoteSelectionMarquee(e.altKey); // Check if it's a note marquee

        if (!e.ctrlKey) {
            state.setSelectedItems([]);
            state.setSelectedNotes([]);
        }
        state.setSelectionRect({
            startX: e.offsetX,
            startY: e.offsetY,
            x: e.offsetX,
            y: e.offsetY,
            w: 0,
            h: 0
        });
        drawRack();
        ui.updateInfoPanel();
        return;
    }

    const { rackIndex, rackData, localX, localY } = rackInfo;

    // IMPORTANT: Set active rack on left-click if different
    if (state.activeRackIndex !== rackIndex) {
        state.setActiveRackIndex(rackIndex);
        ui.updateRackControlsUI();
    }

    // If we had a previous selection on another rack, clear it unless Ctrl is held
    if (state.selectedItems.length > 0 && !e.ctrlKey) {
        const firstItemRack = state.selectedItems[0].rackIndex;
        if (firstItemRack !== rackIndex) {
            state.setSelectedItems([]);
            state.setSelectedNotes([]);
        }
    }

    const railLeft = constants.BASE_UNIT_HEIGHT * 1.25;
    const eqPadding = constants.BASE_UNIT_HEIGHT * 0.2;
    const eqLeft = railLeft - eqPadding;

    let clickedSelection = null;

    // First check shelf items
    for (const parent of [...rackData.equipment].reverse()) {
        if (parent.shelfItems) {
            const parentTopY = parent.y * constants.BASE_UNIT_HEIGHT;
            for (const shelfItem of parent.shelfItems) {
                const drawW = shelfItem.size.width * constants.SHELF_ITEM_RENDER_SCALE;
                const drawH = shelfItem.size.height * constants.SHELF_ITEM_RENDER_SCALE;
                const itemX1 = eqLeft + shelfItem.x;
                const itemY1 = parentTopY - drawH;
                if (
                    localX >= itemX1 && localX < itemX1 + drawW &&
                    localY >= itemY1 && localY < itemY1 + drawH
                ) {
                    clickedSelection = { item: shelfItem, parent, rackIndex };
                    break;
                }
            }
        }
        if (clickedSelection) break;
    }

    // Then check standard items (including V-PDUs)
    if (!clickedSelection) {
        // V-PDU hit test
        const vPduHit = rackData.equipment.find(it => it.type === 'v-pdu' && utils.isVpduUnderMouse(it, localX, localY));
        if (vPduHit) {
            clickedSelection = { item: vPduHit, parent: null, rackIndex };
        } else {
            // Standard equipment hit test
            const standardHit = [...rackData.equipment].reverse().find(it => {
                if (it.type === 'v-pdu') return false;
                const topY = it.y * constants.BASE_UNIT_HEIGHT;
                const bottomY = topY + it.u * constants.BASE_UNIT_HEIGHT;
                return (
                    localY >= topY && localY < bottomY &&
                    localX >= eqLeft && localX < eqLeft + (constants.WORLD_WIDTH - 2 * railLeft) + 2 * eqPadding
                );
            });
            if (standardHit) {
                clickedSelection = { item: standardHit, parent: null, rackIndex };
            }
        }
    }

    if (clickedSelection) {
        const { item } = clickedSelection;
        state.setSelectedNotes([]); // Clear any note selection when an item is clicked

        if (e.ctrlKey) {
            // Toggle selection
            const idx = state.selectedItems.findIndex(sel => sel.item === item);
            if (idx > -1) state.selectedItems.splice(idx, 1);
            else state.selectedItems.push({ ...clickedSelection });

        } else {
            // Replace selection
            if (!state.selectedItems.some(sel => sel.item === item)) {
                state.setSelectedItems([clickedSelection]);
            }
            // Begin dragging
            state.setIsDraggingSelection(true);

            const maxHeightU = state.isMultiRackView && state.racks.length > 0
                ? Math.max(...state.racks.map(r => r.heightU || 42))
                : rackData.heightU;
            const rackYOffset = state.isMultiRackView
                ? (maxHeightU - rackData.heightU) * constants.BASE_UNIT_HEIGHT
                : 0;
            const rackXOffset = state.isMultiRackView
                ? rackIndex * (constants.WORLD_WIDTH + constants.RACK_SPACING)
                : 0;

            // Compute drag anchor
            let anchorX, anchorY;
            if (clickedSelection.item.type === 'shelf-item') {
                anchorX = rackXOffset + eqLeft + clickedSelection.item.x;
                anchorY = rackYOffset + clickedSelection.parent.y * constants.BASE_UNIT_HEIGHT
                    - clickedSelection.item.size.height * constants.SHELF_ITEM_RENDER_SCALE;
            } else {
                anchorX = rackXOffset + eqLeft;
                anchorY = rackYOffset + clickedSelection.item.y * constants.BASE_UNIT_HEIGHT;
            }
            state.setDragAnchor({ offsetX: worldPos.x - anchorX, offsetY: worldPos.y - anchorY, anchorItem: item });

            // Store initial temp positions & drag offsets
            state.selectedItems.forEach(sel => {
                const selItem = sel.item;
                if (selItem.type === 'v-pdu') return;
                let initX, initY;
                const selRackData = state.racks[sel.rackIndex];
                const selYOffset = state.isMultiRackView
                    ? (maxHeightU - selRackData.heightU) * constants.BASE_UNIT_HEIGHT
                    : 0;
                const selXOffset = state.isMultiRackView
                    ? sel.rackIndex * (constants.WORLD_WIDTH + constants.RACK_SPACING)
                    : 0;
                const selEqLeft = selXOffset + constants.BASE_UNIT_HEIGHT * 1.25 - constants.BASE_UNIT_HEIGHT * 0.2;

                if (selItem.type === 'shelf-item') {
                    initX = selEqLeft + selItem.x;
                    initY = selYOffset + sel.parent.y * constants.BASE_UNIT_HEIGHT
                        - selItem.size.height * constants.SHELF_ITEM_RENDER_SCALE;
                } else {
                    initX = selEqLeft;
                    initY = selYOffset + selItem.y * constants.BASE_UNIT_HEIGHT;
                }

                selItem.tempX = initX;
                selItem.tempY = initY;
                sel.dragOffsetX_pixels = initX - anchorX;
                sel.dragOffsetY_pixels = initY - anchorY;
            });
        }
    } else {
        // Clicked empty rack area → begin marquee selection
        state.setIsSelecting(true);
        state.setIsNoteSelectionMarquee(e.altKey); // Check if it's a note marquee
        if (!e.ctrlKey) {
            state.setSelectedItems([]);
            state.setSelectedNotes([]);
        }
        state.setSelectionRect({
            startX: e.offsetX,
            startY: e.offsetY,
            x: e.offsetX,
            y: e.offsetY,
            w: 0,
            h: 0
        });
    }

    drawRack();
    ui.updateInfoPanel();
};

const handleMouseMove = (e) => {
    // If a rack name is being edited on the canvas, prevent other canvas interactions.
    if (state.editingRackName) {
        e.preventDefault();
        e.stopPropagation();
        return;
    }

    // NEW: Handle dragging a selection of notes
    if (state.isDraggingNoteSelection) {
        const worldPos = utils.getMouseWorldPos(e);
        const { dragStartMouseWorldPos, initialOffsets } = state.noteSelectionDragData;

        const deltaX = worldPos.x - dragStartMouseWorldPos.x;
        const deltaY = worldPos.y - dragStartMouseWorldPos.y;

        state.selectedNotes.forEach(sel => {
            const initialOffset = initialOffsets.get(sel.noteOwner);
            if (initialOffset) {
                sel.noteOwner.noteOffset.x = initialOffset.x + deltaX;
                sel.noteOwner.noteOffset.y = initialOffset.y + deltaY;
            }
        });
        drawRack();
        return;
    }

    // NEW: Handle dragging a single note
    if (state.isDraggingNote) {
        canvas.style.cursor = 'grabbing';
        const worldPos = utils.getMouseWorldPos(e);

        // Calculate delta from drag start point
        const deltaX = worldPos.x - state.draggedNoteItemInfo.dragStartMouseWorldPos.x;
        const deltaY = worldPos.y - state.draggedNoteItemInfo.dragStartMouseWorldPos.y;

        // Apply delta to initial note offset
        const newOffsetX = state.draggedNoteItemInfo.initialNoteOffset.x + deltaX;
        const newOffsetY = state.draggedNoteItemInfo.initialNoteOffset.y + deltaY;

        // Update tempNoteOffset for ghost drawing
        state.draggedNoteItemInfo.tempNoteOffset = { x: newOffsetX, y: newOffsetY };

        drawRack(); // Redraw for ghost
        return;
    }

    if (state.isDraggingRack) {
        canvas.style.cursor = 'grabbing';
        const worldPos = utils.getMouseWorldPos(e);
        const newGhostX = worldPos.x - state.dragAnchor.offsetX;
        state.setDraggedRackGhost({ x: newGhostX });
        const rackAndSpacingWidth = constants.WORLD_WIDTH + constants.RACK_SPACING;
        const hoverIndex = Math.floor((worldPos.x + (rackAndSpacingWidth / 2)) / rackAndSpacingWidth);
        const newDropIndex = Math.max(0, Math.min(state.racks.length, hoverIndex));
        if (newDropIndex !== state.dropTargetIndex) {
            state.setDropTargetIndex(newDropIndex);
        }
        drawRack();
        return;
    }

    if (state.isPanning) {
        const dx = e.clientX - state.panStart.x;
        const dy = e.clientY - state.panStart.y;
        state.setViewOffset({ x: state.viewOffset.x + dx, y: state.viewOffset.y + dy });
        state.setPanStart({ x: e.clientX, y: e.clientY });
        drawRack();
        return;
    }

    if (!state.isDraggingSelection && !state.isSelecting) {
        let cursorSet = false;
        // Rack name hover in multi-rack view
        if (state.isMultiRackView && !state.isPanning) {
            const worldPos = utils.getMouseWorldPos(e);
            for (const rackData of state.racks) {
                const nb = rackData.nameBounds;
                if (nb && worldPos.x >= nb.x && worldPos.x <= nb.x + nb.w && worldPos.y >= nb.y && worldPos.y <= nb.y + nb.h) {
                    canvas.style.cursor = 'grab';
                    cursorSet = true;
                    break;
                }
            }
        }

        // NEW: Note block hover in multi-rack view
        if (!cursorSet && state.isMultiRackView && !state.isPanning) {
            const worldPos = utils.getMouseWorldPos(e);
            let foundHover = null;

            for (let i = 0; i < state.racks.length; i++) {
                const rackData = state.racks[i];
                if (rackData.noteLayouts) {
                    for (const layout of rackData.noteLayouts) {
                        const bounds = layout.bounds;
                        if (bounds &&
                            worldPos.x >= bounds.x && worldPos.x <= bounds.x + bounds.w &&
                            worldPos.y >= bounds.y && worldPos.y <= bounds.y + bounds.h) {
                            foundHover = { item: layout.item, rackIndex: i };
                            break;
                        }
                    }
                }
                if (foundHover) break;
            }

            // Only redraw if the hover state has changed
            const currentHovered = state.hoveredNoteItem;
            if ((foundHover && (!currentHovered || foundHover.item !== currentHovered.item)) ||
                (!foundHover && currentHovered)) {
                state.setHoveredNoteItem(foundHover);
                drawRack();
            }

            if (foundHover) {
                canvas.style.cursor = 'pointer';
                cursorSet = true;
            }
        }

        // Note hover in single-rack view
        if (!cursorSet && !state.isMultiRackView && !state.isPanning && state.activeRackIndex > -1) {
            const worldPos = utils.getMouseWorldPos(e);
            if (getNoteUnderMouse(worldPos)) {
                canvas.style.cursor = 'grab';
                cursorSet = true;
            }
        }

        // Reset cursor if no other state has set it
        if (!cursorSet && !canvas.classList.contains('panning')) {
            canvas.style.cursor = 'default';
        }
        return;
    };

    // Handle equipment dragging and marquee selection
    const worldPos = utils.getMouseWorldPos(e);
    if (state.isDraggingSelection) { // This block handles ghosting for item drags
        const newAnchorTempX = worldPos.x - state.dragAnchor.offsetX;
        const newAnchorTempY = worldPos.y - state.dragAnchor.offsetY;
        state.selectedItems.forEach(sel => {
            const { item } = sel;
            if (item.type === 'v-pdu') return;
            item.tempY = newAnchorTempY + sel.dragOffsetY_pixels;
            if (item.type !== 'shelf-item') {
                item.tempX = newAnchorTempX + sel.dragOffsetX_pixels;
            }
        });
    }
    if (state.isSelecting) { // This block handles updating marquee selections (for both notes and items)
        const newRect = { ...state.selectionRect, x: Math.min(e.offsetX, state.selectionRect.startX), y: Math.min(e.offsetY, state.selectionRect.startY), w: Math.abs(e.offsetX - state.selectionRect.startX), h: Math.abs(e.offsetY - state.selectionRect.startY) };
        state.setSelectionRect(newRect);
        ui.updateSelection(e.ctrlKey || e.shiftKey); // Use modified updateSelection
    }
    drawRack();
};

const handleMouseUp = (e) => {
    // If a rack name is being edited on the canvas, prevent other canvas interactions.
    if (state.editingRackName) {
        e.preventDefault();
        e.stopPropagation();
        return;
    }

    // NEW: If interaction started on the UI, abort canvas mouseup logic to prevent focus loss.
    if (interactionStartedOnUI) {
        interactionStartedOnUI = false; // Reset flag for next interaction
        return;
    }

    // NEW: Finish dragging a selection of notes
    if (state.isDraggingNoteSelection) {
        state.setIsDraggingNoteSelection(false);
        state.setNoteSelectionDragData(null);
        canvas.style.cursor = 'default';
        drawRack();
        ui.updateInfoPanel();
        return;
    }

    // NEW: Finish dragging a single note
    if (state.isDraggingNote) {
        if (state.draggedNoteItemInfo && state.draggedNoteItemInfo.item && state.draggedNoteItemInfo.tempNoteOffset) {
            state.draggedNoteItemInfo.item.noteOffset = { ...state.draggedNoteItemInfo.tempNoteOffset }; // Apply final position
            // Clean up temporary drag properties
            delete state.draggedNoteItemInfo.tempNoteOffset; // No longer needed after drag ends
        }
        state.setIsDraggingNote(false);
        state.setDraggedNoteItemInfo(null);
        canvas.style.cursor = 'default';
        drawRack();
        ui.updateInfoPanel();
        return;
    }

    // 1) Finish dragging a rack
    if (state.isDraggingRack) {
        const activeRackId = state.racks[state.activeRackIndex]?.id;
        const movedRack = state.racks.splice(state.draggedRackIndex, 1)[0];
        let finalDropIndex = state.dropTargetIndex;
        if (finalDropIndex > state.draggedRackIndex) {
            finalDropIndex--;
        }
        state.racks.splice(finalDropIndex, 0, movedRack);
        if (activeRackId) {
            state.setActiveRackIndex(state.racks.findIndex(r => r.id === activeRackId));
        }
        state.setIsDraggingRack(false);
        state.setDraggedRackIndex(-1);
        state.setDropTargetIndex(-1);
        state.setDragAnchor(null);
        canvas.style.cursor = 'default';
        drawRack();
        state.setSelectedNotes([]); // Clear note selections after a rack drag
        ui.updateInfoPanel();
        return;
    }

    // 2) Finish panning
    if (state.isPanning) {
        state.setIsPanning(false);
        canvas.classList.remove('panning');
    }

    // 3) Finish dragging equipment selection
    if (state.isDraggingSelection) {
        const worldPos = utils.getMouseWorldPos(e);
        const targetRackInfo = utils.getRackFromWorldPos(worldPos);
        if (targetRackInfo) {
            const { rackIndex: targetRackIndex, rackData: targetRackData } = targetRackInfo;
            const targetEquipment = targetRackData.equipment;
            const draggableStdItems = state.selectedItems.filter(sel => sel.item.type !== 'v-pdu' && sel.item.type !== 'shelf-item');

            if (draggableStdItems.length > 0) {
                let isValidMove = true;
                const maxHeightU = state.isMultiRackView && state.racks.length > 0
                    ? Math.max(...state.racks.map(r => r.heightU || 42))
                    : targetRackData.heightU;
                const targetRackYOffset = state.isMultiRackView
                    ? (maxHeightU - targetRackData.heightU) * constants.BASE_UNIT_HEIGHT
                    : 0;

                const proposedMoves = draggableStdItems.map(sel => {
                    const ghostY = sel.item.tempY - targetRackYOffset;
                    return { sel, newY_U: Math.round(ghostY / constants.BASE_UNIT_HEIGHT) };
                });

                const otherItems = targetEquipment.filter(it =>
                    !draggableStdItems.some(s => s.item === it) && it.type !== 'v-pdu'
                );

                for (const { sel, newY_U } of proposedMoves) {
                    if (
                        newY_U < 0 ||
                        newY_U + sel.item.u > targetRackData.heightU ||
                        otherItems.some(o => newY_U < o.y + o.u && newY_U + sel.item.u > o.y)
                    ) {
                        isValidMove = false;
                        break;
                    }
                }

                if (isValidMove) {
                    // Collect items that were successfully moved to the target rack
                    const newlyMovedItems = [];
                    proposedMoves.forEach(({ sel, newY_U }) => {
                        sel.item.y = newY_U;
                        if (sel.rackIndex !== targetRackIndex) {
                            const srcEquip = state.racks[sel.rackIndex].equipment;
                            const idx = srcEquip.indexOf(sel.item);
                            if (idx > -1) srcEquip.splice(idx, 1);
                            targetEquipment.push(sel.item);
                            sel.rackIndex = targetRackIndex;
                        }
                        newlyMovedItems.push({ item: sel.item, parent: sel.parent, rackIndex: sel.rackIndex });
                    });
                    // Select only the newly moved items
                    state.setSelectedItems(newlyMovedItems);
                }
            }
        }

        // 4) Common cleanup & rerender
        state.setIsDraggingSelection(false);
        state.setIsNoteSelectionMarquee(false);
        state.setIsSelecting(false);
        state.setDragAnchor(null);

        // Remove temporary drag coords
        state.racks.forEach(r =>
            r.equipment.forEach(it => {
                delete it.tempX;
                delete it.tempY;
                if (it.shelfItems) it.shelfItems.forEach(si => {
                    delete si.tempX;
                    delete si.tempY;
                });
            })
        );
        state.selectedItems.forEach(sel => {
            delete sel.dragOffsetX_pixels;
            delete sel.dragOffsetY_pixels;
        });

        drawRack();
        ui.updateInfoPanel();
        return;
    }

    state.setIsDraggingSelection(false); // Make sure this is reset
    state.setIsSelecting(false);
    state.setIsNoteSelectionMarquee(false);
    state.setDragAnchor(null);

    // Remove temporary drag coords
    state.racks.forEach(r =>
        r.equipment.forEach(it => {
            delete it.tempX;
            delete it.tempY;
            if (it.shelfItems) it.shelfItems.forEach(si => {
                delete si.tempX;
                delete si.tempY;
            });
        })
    );
    state.selectedItems.forEach(sel => {
        delete sel.dragOffsetX_pixels;
        delete sel.dragOffsetY_pixels;
    });

    drawRack(); // Ensure any selection highlight is removed if nothing was clicked/dragged
    ui.updateInfoPanel();
};

const handleWheel = (e) => {
    // If a rack name is being edited on the canvas, prevent other canvas interactions.
    if (state.editingRackName) {
        e.preventDefault();
        e.stopPropagation();
        return;
    }

    e.preventDefault();
    const zoomIntensity = 0.1;
    const mousePos = { x: e.offsetX, y: e.offsetY };
    const worldPosBefore = utils.getMouseWorldPos(e);
    const newScale = state.scale * (1 - Math.sign(e.deltaY) * zoomIntensity);
    const clampedScale = Math.max(0.1, Math.min(10, newScale));
    state.setScale(clampedScale);
    const newViewOffset = { x: mousePos.x - worldPosBefore.x * state.scale, y: mousePos.y - worldPosBefore.y * state.scale };
    state.setViewOffset(newViewOffset);
    drawRack();
    ui.updateZoomButtons();
};

const handleDrop = (e) => {
    // If a rack name is being edited on the canvas, prevent other canvas interactions.
    if (state.editingRackName) {
        e.preventDefault();
        e.stopPropagation();
        return;
    }

    e.preventDefault();

    // NEW: Guard clause to ignore drops that don't originate from our equipment list.
    // A valid drop must have a 'type' set in its dataTransfer.
    const type = e.dataTransfer.getData('type');
    if (!type) {
        console.log("Ignoring drop event with no 'type' data. Likely external text/file drag.");
        return;
    }

    const worldPos = utils.getMouseWorldPos(e);
    const rackInfo = utils.getRackFromWorldPos(worldPos);
    if (!rackInfo) return;
    const { rackIndex, rackData, localX, localY } = rackInfo;
    const rack = rackData.equipment;
    const label = e.dataTransfer.getData('label');
    const stencil = e.dataTransfer.getData('stencil');
    const stencilRear = e.dataTransfer.getData('stencilRear');

    let newItem = null; // Variable to hold the newly created item

    if (type === 'shelf-item') {
        const size = JSON.parse(e.dataTransfer.getData('size'));
        const { newParent, newX } = utils.findValidShelfParent(localY, { size }, rack, localX);
        if (newParent) {
            newItem = { x: newX, label, type, stencil, stencilRear, size, notes: '', noteOffset: { x: constants.DEFAULT_NOTE_OFFSET_X, y: constants.DEFAULT_NOTE_OFFSET_Y } }; // Initialize notes AND noteOffset
            if (!newParent.shelfItems) newParent.shelfItems = [];
            newParent.shelfItems.push(newItem);
            state.setSelectedItems([{ item: newItem, parent: newParent, rackIndex }]); // Select the new item
        }
    } else if (type === 'v-pdu') {
        const uStr = e.dataTransfer.getData('u');
        const u = uStr ? parseInt(uStr, 10) : rackData.heightU;
        const railLeft = constants.BASE_UNIT_HEIGHT * 1.25;
        const railRight = constants.WORLD_WIDTH - railLeft;
        const rackCenterline = railLeft + (railRight - railLeft) / 2;
        const targetSide = (localX < rackCenterline) ? 'left' : 'right';

        const existingPdusOnSide = rack.filter(it => it.type === 'v-pdu' && it.side === targetSide);
        const initialY = Math.max(0, Math.min(rackData.heightU - u, Math.floor(localY / constants.BASE_UNIT_HEIGHT)));
        const newY = utils.findAvailableY(u, initialY, existingPdusOnSide, rackData.heightU);

        if (newY !== -1) {
            newItem = {
                y: newY, u, label, type, stencil, stencilRear, side: targetSide,
                notes: '', noteOffset: { x: constants.DEFAULT_NOTE_OFFSET_X, y: constants.DEFAULT_NOTE_OFFSET_Y },
                isFullHeight: !uStr // Flag to identify full-height PDUs for pasting
            };
            rack.push(newItem);
            state.setSelectedItems([{ item: newItem, parent: null, rackIndex }]); // Select the new item
        } else {
            alert(`No available space for a ${u}U V-PDU on the ${targetSide} side of this rack.`);
        }
    } else { // Handle standard equipment drop (not shelf-item or v-pdu)
        const u = parseInt(e.dataTransfer.getData('u'), 10);
        // Calculate the initial, preferred Y position based on mouse cursor
        const initialY = Math.max(0, Math.min(rackData.heightU - u, Math.floor(localY / constants.BASE_UNIT_HEIGHT)));

        // Filter existing items to only include standard equipment for overlap checks
        const existingStandardEquipment = rack.filter(it => it.type !== 'v-pdu');

        // Find an available Y position
        const newY = utils.findAvailableY(u, initialY, existingStandardEquipment, rackData.heightU);

        if (newY !== -1) { // If an available position was found
            newItem = {
                y: newY, // Use the found Y
                u, label, type, stencil, stencilRear, shelfItems: [],
                notes: '',
                noteOffset: { x: constants.DEFAULT_NOTE_OFFSET_X, y: constants.DEFAULT_NOTE_OFFSET_Y }
            };
            rack.push(newItem);
            state.setSelectedItems([{ item: newItem, parent: null, rackIndex }]); // Select the new item
        } else {
            alert(`Cannot place ${label} anywhere in this rack: No available space found.`); // Only alert if no space found *anywhere*
        }
    }
    drawRack();
    ui.updateInfoPanel();
};

function handleCopy() {
    const copyableItems = state.selectedItems.filter(s => s.item.type !== 'shelf-item');
    if (copyableItems.length === 0) {
        state.setClipboard({ standardItems: [], vpdus: [], originalTopY: null });
        return;
    }
    const standardItems = copyableItems.filter(s => s.item.type !== 'v-pdu');
    const vpdus = copyableItems.filter(s => s.item.type === 'v-pdu');
    let originalTopY = null;
    let clipboardStandardItems = [];
    if (standardItems.length > 0) {
        standardItems.sort((a, b) => a.rackIndex - b.rackIndex || a.item.y - b.item.y);
        const topMostItem = standardItems[0];
        originalTopY = topMostItem.item.y;
        clipboardStandardItems = standardItems.map(s => ({ item: JSON.parse(JSON.stringify(s.item)), relativeY: s.item.y - originalTopY, }));
    }
    const clipboardVPDUs = vpdus.map(s => JSON.parse(JSON.stringify(s.item)));
    state.setClipboard({ standardItems: clipboardStandardItems, vpdus: clipboardVPDUs, originalTopY: originalTopY });
}

function handleCut() {
    handleCopy();
    // Use the batch delete function for cut
    ui.deleteSelectedItem(); // Corrected: Calls deleteSelectedItem which handles batch deletion
    // deleteSelectedItem already clears selection, draws, and updates info panel.
}

function handlePaste() {
    const { standardItems: clipboardStandardItems, vpdus: clipboardVPDUs, originalTopY } = state.clipboard;
    if (clipboardStandardItems.length === 0 && clipboardVPDUs.length === 0) return;
    if (state.activeRackIndex === -1) return;
    const targetRack = state.racks[state.activeRackIndex];
    const newSelectedItems = [];
    let somethingPasted = false;
    if (clipboardStandardItems.length > 0) {
        const existingItems = targetRack.equipment.filter(it => it.type !== 'v-pdu');
        const blockHeight = Math.max(...clipboardStandardItems.map(c => c.relativeY + c.item.u));
        const isSpaceFree = (startY, height, rackItems) => {
            if (startY < 0 || startY + height > targetRack.heightU) return false;
            for (const clipboardItem of clipboardStandardItems) {
                const newY = startY + clipboardItem.relativeY;
                const newU = clipboardItem.item.u;
                // Check if the individual item from clipboard overlaps with existing items in the target rack
                for (const existingItem of rackItems) {
                    if (newY < existingItem.y + existingItem.u && newY + newU > existingItem.y) {
                        return false;
                    }
                }
            }
            return true;
        };
        let pasteY = -1;
        // Try to paste at the original Y if possible
        if (originalTopY !== null && isSpaceFree(originalTopY, blockHeight, existingItems)) {
            pasteY = originalTopY;
        } else { // Otherwise, find the next available space
            for (let y = 0; y <= targetRack.heightU - blockHeight; y++) {
                if (isSpaceFree(y, blockHeight, existingItems)) {
                    pasteY = y;
                    break;
                }
            }
        }

        if (pasteY !== -1) {
            clipboardStandardItems.forEach(clipboardItem => {
                const newItem = JSON.parse(JSON.stringify(clipboardItem.item));
                newItem.y = pasteY + clipboardItem.relativeY;
                if (!newItem.notes) newItem.notes = ''; // Ensure notes property exists
                if (!newItem.shelfItems) newItem.shelfItems = []; // Ensure shelfItems exists
                if (newItem.noteOffset === undefined) newItem.noteOffset = { x: constants.DEFAULT_NOTE_OFFSET_X, y: constants.DEFAULT_NOTE_OFFSET_Y }; // Ensure noteOffset exists for pasted items
                targetRack.equipment.push(newItem);
                newSelectedItems.push({ item: newItem, parent: null, rackIndex: state.activeRackIndex });
            });
            somethingPasted = true;
        } else {
            alert("Not enough contiguous space in the rack to paste the standard items.");
        }
    }
    if (clipboardVPDUs.length > 0) {
        clipboardVPDUs.forEach(pduToPaste => {
            const newItem = JSON.parse(JSON.stringify(pduToPaste));
            // If it's a full-height PDU, adjust its height to the target rack.
            if (newItem.isFullHeight) {
                newItem.u = targetRack.heightU;
            }

            const existingPdusOnSide = targetRack.equipment.filter(it => it.type === 'v-pdu' && it.side === newItem.side);
            const pasteY = utils.findAvailableY(newItem.u, newItem.y, existingPdusOnSide, targetRack.heightU);

            if (pasteY !== -1) {
                newItem.y = pasteY;
                if (!newItem.notes) newItem.notes = ''; // Ensure notes property exists
                if (newItem.noteOffset === undefined) newItem.noteOffset = { x: constants.DEFAULT_NOTE_OFFSET_X, y: constants.DEFAULT_NOTE_OFFSET_Y }; // Ensure noteOffset exists for pasted items
                targetRack.equipment.push(newItem);
                newSelectedItems.push({ item: newItem, parent: null, rackIndex: state.activeRackIndex });
                somethingPasted = true;
            } else {
                alert(`Cannot paste V-PDU on ${newItem.side} side: no available space.`);
            }
        });
    }
    if (somethingPasted) {
        targetRack.equipment.sort((a, b) => a.y - b.y);
        state.setSelectedItems(newSelectedItems);
        drawRack();
        ui.updateInfoPanel();
    }
}

// MODIFIED: Double click handler for rack name editing AND opening item details (via item or note)
const handleDoubleClick = (e) => {
    // Prevent default double-click behavior (e.g., text selection)
    e.preventDefault();
    e.stopPropagation(); // Stop propagation to prevent canvas events immediately below

    // If already editing a rack name, hide the editor before proceeding.
    if (state.editingRackName) {
        ui.hideCanvasRackNameEditor();
        drawRack();
    }

    const worldPos = utils.getMouseWorldPos(e);

    // --- CASE 1: Double-click on a rack name (only in multi-rack view) ---
    if (state.isMultiRackView) {
        for (let i = 0; i < state.racks.length; i++) {
            const rackData = state.racks[i];
            const nameBounds = rackData.nameBounds;

            if (nameBounds &&
                worldPos.x >= nameBounds.x && worldPos.x <= nameBounds.x + nameBounds.w &&
                worldPos.y >= nameBounds.y && worldPos.y <= nameBounds.y + nameBounds.h) {

                state.setEditingRackName(true);
                state.setEditingRackIndex(i);
                ui.showCanvasRackNameEditor(i, rackData);
                drawRack(); // Redraw canvas to hide the name while input is active
                return; // Exit after handling rack name edit
            }
        }
    }

    // --- NEW: Double-click on a NOTE (only in single-rack view) to open item details ---
    if (!state.isMultiRackView) {
        const hitNoteInfo = getNoteUnderMouse(worldPos);
        if (hitNoteInfo) {
            state.setSelectedItems([{ item: hitNoteInfo.item, parent: hitNoteInfo.parent, rackIndex: hitNoteInfo.rackIndex }]);
            ui.openInfoPanel();
            ui.updateInfoPanel();
            drawRack();
            return; // Action handled, exit the function.
        }
    }


    // --- CASE 2: Double-click on an equipment item (in any view) ---
    const rackInfo = utils.getRackFromWorldPos(worldPos);
    if (!rackInfo) {
        return; // Clicked on empty space, do nothing
    }

    const { rackIndex, rackData, localX, localY } = rackInfo;
    const railLeft = constants.BASE_UNIT_HEIGHT * 1.25;
    const eqPadding = constants.BASE_UNIT_HEIGHT * 0.2;
    const eqLeft = railLeft - eqPadding;

    let clickedSelection = null;

    // This hit detection logic is copied from handleMouseDown
    // First check shelf items
    for (const parent of [...rackData.equipment].reverse()) {
        if (parent.shelfItems) {
            const parentTopY = parent.y * constants.BASE_UNIT_HEIGHT;
            for (const shelfItem of parent.shelfItems) {
                const drawW = shelfItem.size.width * constants.SHELF_ITEM_RENDER_SCALE;
                const drawH = shelfItem.size.height * constants.SHELF_ITEM_RENDER_SCALE;
                const itemX1 = eqLeft + shelfItem.x;
                const itemY1 = parentTopY - drawH;
                if (
                    localX >= itemX1 && localX < itemX1 + drawW &&
                    localY >= itemY1 && localY < itemY1 + drawH
                ) {
                    clickedSelection = { item: shelfItem, parent, rackIndex };
                    break;
                }
            }
        }
        if (clickedSelection) break;
    }

    // Then check standard items (including V-PDUs)
    if (!clickedSelection) {
        // V-PDU hit test
        const vPduHit = rackData.equipment.find(it => it.type === 'v-pdu' && utils.isVpduUnderMouse(it, localX, localY));
        if (vPduHit) {
            clickedSelection = { item: vPduHit, parent: null, rackIndex };
        } else {
            // Standard equipment hit test
            const standardHit = [...rackData.equipment].reverse().find(it => {
                if (it.type === 'v-pdu') return false;
                const topY = it.y * constants.BASE_UNIT_HEIGHT;
                const bottomY = topY + it.u * constants.BASE_UNIT_HEIGHT;
                return (
                    localY >= topY && localY < bottomY &&
                    localX >= eqLeft && localX < eqLeft + (constants.WORLD_WIDTH - 2 * railLeft) + 2 * eqPadding
                );
            });
            if (standardHit) {
                clickedSelection = { item: standardHit, parent: null, rackIndex };
            }
        }
    }

    // If an item was found, select it and show the info panel
    if (clickedSelection) {
        state.setSelectedItems([clickedSelection]);
        ui.openInfoPanel(); // This will open the panel and redraw the canvas.
        ui.updateInfoPanel(); // Populate panel with item details
        drawRack(); // Redraw canvas to show selection highlight
    }
};


const handleKeyDown = (e) => {
    // If a rack name is being edited on the canvas, allow text input.
    // If it's an input field related to the canvas-based name editor, let key events pass.
    if (state.editingRackName && e.target.classList.contains('canvas-rack-name-editor')) {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.target.blur(); // Trigger blur to save the name
        }
        e.stopPropagation(); // Prevent other keydowns on canvas
        return;
    }

    // If any modal is open, prevent keydown events from propagating to canvas actions
    if (!document.getElementById('save-as-modal').classList.contains('hidden') ||
        !document.getElementById('load-modal').classList.contains('hidden')) {
        if (e.key === 'Escape') {
            if (!document.getElementById('save-as-modal').classList.contains('hidden')) { ui.hideSaveFilenameModal(); }
            else if (!document.getElementById('load-modal').classList.contains('hidden')) { ui.hideLoadModal(); }
        }
        return; // Prevent further keydown processing if a modal is open
    }

    // NEW: Removed SELECT from this check, as the note position control is now removed from the info panel
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
    }
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    if (isCtrlOrCmd && e.key.toLowerCase() === 'c') { e.preventDefault(); handleCopy(); return; }
    if (isCtrlOrCmd && e.key.toLowerCase() === 'x') { e.preventDefault(); handleCut(); return; }
    if (isCtrlOrCmd && e.key.toLowerCase() === 'v') { e.preventDefault(); handlePaste(); return; }
    if (isCtrlOrCmd && e.key.toLowerCase() === 's') { e.preventDefault(); ui.saveLayout(); return; } // NEW: Ctrl+S to save

    // MODIFIED: Use ui.deleteSelectedItem() and include Backspace
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedItems.length > 0) {
        e.preventDefault(); // Prevent browser's default delete behavior
        ui.deleteSelectedItem(); // Call the batch delete function
    }
};

const handleContextMenu = (e) => {
    // If a rack name is being edited on the canvas, prevent other canvas interactions.
    if (state.editingRackName) {
        e.preventDefault();
        e.stopPropagation();
        return;
    }

    e.preventDefault();
    const worldPos = utils.getMouseWorldPos(e);

    // Always hide any currently active context menu first
    ui.hideContextMenu();
    state.setContextMenuTargetNoteItem(null); // NEW: Reset target note at the start

    // --- REVISED LOGIC: Check for note click FIRST ---
    // This is crucial because notes can be outside the formal rack bounds.
    const hitNoteInfo = getNoteUnderMouse(worldPos);
    if (hitNoteInfo) {
        // A note was right-clicked. Set it as the context menu target for alignment.
        state.setContextMenuTargetNoteItem({ item: hitNoteInfo.noteOwner, rackIndex: hitNoteInfo.rackIndex });
        state.setSelectedItems([]); // Clear equipment selection

        // Ensure the active rack is the one containing the note
        if (state.activeRackIndex !== hitNoteInfo.rackIndex) {
            state.setActiveRackIndex(hitNoteInfo.rackIndex);
            ui.updateRackControlsUI();
            state.setSelectedNotes([]); // Clear note selection when switching racks
        }

        // Define the item that should be selected (the main equipment item)
        const clickedSelectionObject = { item: hitNoteInfo.item, parent: hitNoteInfo.parent, rackIndex: hitNoteInfo.rackIndex };

        // If the note's parent item is not already selected, select it.
        // Otherwise, keep the existing selection to allow aligning a group.
        const isClickedNoteAlreadySelected = state.selectedNotes.some(
            sel => sel.noteOwner === hitNoteInfo.noteOwner
        );

        if (!isClickedNoteAlreadySelected) {
            state.setSelectedNotes([{ noteOwner: hitNoteInfo.noteOwner, rackIndex: hitNoteInfo.rackIndex }]);
        }

        drawRack();
        ui.updateInfoPanel();
        ui.showContextMenu(e.clientX, e.clientY);
        return; // Event handled, exit.
    }


    // --- ORIGINAL LOGIC (if no note was clicked) ---
    const rackInfo = utils.getRackFromWorldPos(worldPos);
    if (!rackInfo) {
        // If right-click is not on a rack, just clear selection and return.
        if (state.selectedItems.length > 0) {
            state.setSelectedNotes([]);
            state.setSelectedItems([]);
            ui.updateInfoPanel();
            drawRack(); // Explicitly redraw to remove highlights
        }
        return;
    }

    if (state.activeRackIndex !== rackInfo.rackIndex) {
        state.setActiveRackIndex(rackInfo.rackIndex);
        ui.updateRackControlsUI();
        state.setSelectedNotes([]); // Also clear note selections
        drawRack();
    }

    // Determine the clicked equipment item, if any
    let clickedItem = null;

    // 1. Shelf item hit test
    for (const parent of [...rackInfo.rackData.equipment].sort((a, b) => b.y - a.y)) {
        if (parent.shelfItems) {
            for (const shelfItem of [...parent.shelfItems].reverse()) {
                const drawW = shelfItem.size.width * constants.SHELF_ITEM_RENDER_SCALE;
                const drawH = shelfItem.size.height * constants.SHELF_ITEM_RENDER_SCALE;
                const eqLeft = constants.BASE_UNIT_HEIGHT * 1.25 - constants.BASE_UNIT_HEIGHT * 0.2;
                const itemX1 = eqLeft + shelfItem.x;
                const itemY1 = (parent.y * constants.BASE_UNIT_HEIGHT) - drawH;

                if (rackInfo.localX >= itemX1 && rackInfo.localX < itemX1 + drawW && rackInfo.localY >= itemY1 && rackInfo.localY < itemY1 + drawH) {
                    clickedItem = { item: shelfItem, parent, rackIndex: rackInfo.rackIndex };
                    break;
                }
            }
        }
        if (clickedItem) break;
    }

    // 2. V-PDU hit test
    if (!clickedItem) {
        clickedItem = rackInfo.rackData.equipment.find(it => it.type === 'v-pdu' && utils.isVpduUnderMouse(it, rackInfo.localX, rackInfo.localY));
        if (clickedItem) clickedItem = { item: clickedItem, parent: null, rackIndex: rackInfo.rackIndex };
    }

    // 3. Standard equipment hit test
    if (!clickedItem) {
        clickedItem = [...rackInfo.rackData.equipment].reverse().find(it => !['v-pdu', 'shelf-item'].includes(it.type) && utils.isStandardItemUnderMouse(it, rackInfo.localX, rackInfo.localY));
        if (clickedItem) clickedItem = { item: clickedItem, parent: null, rackIndex: rackInfo.rackIndex };
    }

    // Selection logic for equipment click
    if (clickedItem) {
        state.setSelectedNotes([]); // Clear note selection if equipment is clicked
        const isClickedItemAlreadySelected = state.selectedItems.some(
            sel => sel.item === clickedItem.item && sel.rackIndex === clickedItem.rackIndex
        );
        if (!isClickedItemAlreadySelected) {
            state.setSelectedItems([clickedItem]);
        }
    } else {
        state.setSelectedNotes([]);
        state.setSelectedItems([]);
    }

    drawRack();
    ui.updateInfoPanel();
    ui.showContextMenu(e.clientX, e.clientY);
};


export const initEventListeners = () => {
    // Guard to ensure this only runs once.
    if (hasInitializedEvents) {
        return;
    }
    hasInitializedEvents = true;
    console.log("Event listeners have been initialized (once).");

    // --- All Event Listeners ---
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove); // Moved from document for performance
    canvas.addEventListener('mouseup', handleMouseUp);     // Moved from document for performance

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('dragover', e => e.preventDefault());
    canvas.addEventListener('drop', handleDrop);
    canvas.addEventListener('contextmenu', handleContextMenu);
    canvas.addEventListener('dblclick', handleDoubleClick); // NEW: Double click for renaming

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('click', e => {
        if (!e.target.closest('.context-menu')) {
            ui.hideContextMenu();
        }
    });

    // Left Panel & Footer Buttons
    document.getElementById('equip-search').addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        document.querySelectorAll('.tool-item').forEach(item => {
            const matches = item.textContent.toLowerCase().includes(searchTerm);
            item.style.display = matches ? '' : 'none';
        });
    });
    // --- NEW/UPDATED: Save/Load/Reset Buttons ---
    document.getElementById('save-layout-btn').addEventListener('click', () => ui.saveLayout());
    document.getElementById('load-layout-btn').addEventListener('click', ui.showLoadModal);
    document.getElementById('save-as-btn').addEventListener('click', ui.showSaveFilenameModal); // Add listener for the new button
    document.getElementById('reset-new-btn').addEventListener('click', ui.resetNewLayout);
    // ---------------------------------------------

    document.getElementById('theme-switcher-btn').addEventListener('click', () => {
        const isDark = document.documentElement.classList.contains('dark');
        ui.setTheme(isDark ? 'light' : 'dark');
    });

    // Right Panel & Canvas Controls
    document.getElementById('view-toggle-btn').addEventListener('click', ui.toggleRackView);
    document.getElementById('toggle-layout-view-btn').addEventListener('click', ui.toggleMultiRackView);

    const toggleNotesBtn = document.getElementById('toggle-notes-btn');
    if (toggleNotesBtn) {
        toggleNotesBtn.addEventListener('click', ui.toggleNotesView);
    }

    document.getElementById('zoom-fit').addEventListener('click', () => ui.setZoom('fit'));
    document.getElementById('zoom-0.5x').addEventListener('click', () => ui.setZoom(0.5));
    document.getElementById('zoom-1x').addEventListener('click', () => ui.setZoom(1.0));
    document.getElementById('zoom-2x').addEventListener('click', () => ui.setZoom(2.0));
    document.getElementById('rackSizeSelect').addEventListener('change', ui.updateRackSize);
    document.getElementById('add-rack-btn').addEventListener('click', ui.addNewRack);
    document.getElementById('prev-rack-btn').addEventListener('click', () => ui.switchRack('prev'));
    document.getElementById('next-rack-btn').addEventListener('click', () => ui.switchRack('next'));
    document.getElementById('delete-rack-btn').addEventListener('click', () => {
        if (state.activeRackIndex > -1) ui.deleteRack(state.activeRackIndex);
    });

    // NEW: Event listeners for rack name input
    const rackNameInput = document.getElementById('rack-name-display');
    if (rackNameInput) {
        rackNameInput.addEventListener('blur', ui.handleRackRename);
        rackNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); // Prevent default form submission or new line
                ui.handleRackRename(e);
                e.target.blur(); // Remove focus from the input
            }
        });
    }


    // ---- THE ONE AND ONLY TOGGLE BUTTON LISTENER ----
    document.getElementById('show-info-btn').addEventListener('click', ui.toggleInfoPanel);
    document.getElementById('hide-info-btn').addEventListener('click', ui.toggleInfoPanel);


    // Context Menu
    state.contextMenu.addEventListener('click', e => {
        const li = e.target.closest('li');
        if (!li || li.classList.contains('disabled') || !li.dataset.action) return;

        const action = li.dataset.action;
        const count = parseInt(li.dataset.count, 10);

        if (action === 'fill-blanks') ui.fillRackWithBlanks();
        else if (action === 'edit-notes') {
            ui.openInfoPanel();
        }
        else if (action === 'align-notes-x') alignSelectedNotesHorizontally(); // NEW: Call local function
        else ui.duplicateSelection(action.endsWith('up') ? 'up' : 'down', count);

        ui.hideContextMenu();
    });

    // --- NEW: Save Filename Modal Listeners (reused for "Save As") ---
    const saveAsModal = document.getElementById('save-as-modal'); // This is the overlay div
    const saveAsFilenameInput = document.getElementById('save-as-filename');
    // Keeping these for robustness
    saveAsFilenameInput.addEventListener('mousedown', e => e.stopPropagation());
    saveAsFilenameInput.addEventListener('mouseup', e => e.stopPropagation());

    document.getElementById('save-as-save-btn').addEventListener('click', () => ui.saveLayout(saveAsFilenameInput.value));
    document.getElementById('save-as-cancel-btn').addEventListener('click', ui.hideSaveFilenameModal);
    // MODIFIED: Robust modal closing logic - now uses 'mousedown' instead of 'click'
    saveAsModal.addEventListener('mousedown', (e) => {
        if (e.target === saveAsModal) { // Only hide when the user actually presses down on the overlay background
            ui.hideSaveFilenameModal();
        }
    });
    saveAsFilenameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault(); // Prevent form submission
            ui.saveLayout(saveAsFilenameInput.value);
        }
    });

    // --- NEW: Load Existing Modal Listeners ---
    const loadModal = document.getElementById('load-modal'); // This is the overlay div
    document.getElementById('load-selected-btn').addEventListener('click', ui.handleLoadSelected);
    document.getElementById('delete-selected-btn').addEventListener('click', ui.handleDeleteSelected);
    document.getElementById('load-cancel-btn').addEventListener('click', ui.hideLoadModal);
    // MODIFIED: Robust modal closing logic - now uses 'mousedown' instead of 'click'
    loadModal.addEventListener('mousedown', (e) => {
        if (e.target === loadModal) { // Only hide when the user actually presses down on the overlay background
            ui.hideLoadModal();
        }
    });
    // Double click to load
    document.getElementById('load-file-list').addEventListener('dblclick', (e) => {
        if (e.target.tagName === 'LI' && e.target.dataset.filename) {
            // Find the li element that was double-clicked
            const clickedLi = e.target.closest('li');
            if (clickedLi) {
                // Manually set selectedLayoutToLoad and enable buttons
                ui.setSelectedLayoutToLoad(clickedLi.dataset.filename); // Use a setter if available
                document.getElementById('load-selected-btn').disabled = false;
                document.getElementById('delete-selected-btn').disabled = false;

                // Remove 'selected' from any other li and add to clicked
                const currentSelected = loadModal.querySelector('li.selected');
                if (currentSelected) currentSelected.classList.remove('selected');
                clickedLi.classList.add('selected');

                // Then handle load
                ui.handleLoadSelected();
            }
        }
    });

    // --- NEW: Export Buttons Listeners ---
    const exportPdfBtn = document.getElementById('export-pdf-btn');
    const exportImageBtn = document.getElementById('export-image-btn');
    const exportImageModal = document.getElementById('export-image-modal');

    if (exportPdfBtn) {
        exportPdfBtn.addEventListener('click', ui.exportToPdf);
        console.log('PDF export button listener attached.');
    }

    if (exportImageBtn) {
        exportImageBtn.addEventListener('click', ui.showImageExportModal); // Changed to show modal
        // Add listeners for the new modal buttons
        document.getElementById('export-all-with-notes-btn').addEventListener('click', () => ui.exportAllRacksImage(true));
        document.getElementById('export-all-without-notes-btn').addEventListener('click', () => ui.exportAllRacksImage(false));
        document.getElementById('export-individual-btn').addEventListener('click', ui.exportIndividualRacksImages);
        document.getElementById('export-image-cancel-btn').addEventListener('click', ui.hideImageExportModal);
        exportImageModal.addEventListener('mousedown', (e) => { if (e.target === exportImageModal) ui.hideImageExportModal(); });
        console.log('Image export button listener attached.');
    }
    // ------------------------------------

    // Global Listeners
    window.addEventListener('resize', () => ui.setZoom('fit'));
    // Consolidated modal escape key handling in handleKeyDown

    // NEW: beforeunload event listener for unsaved changes
    window.addEventListener('beforeunload', function (event) {
        // If the layout is already empty, or if there are no unsaved changes,
        // we don't need to show the warning.
        if (utils.isLayoutEffectivelyEmpty() || !utils.hasUnsavedChanges()) {
            console.log("No beforeunload warning needed (layout empty or no changes).");
            return; // Allow the page to unload without a prompt
        }

        // If the layout is NOT empty AND there are unsaved changes, prompt the user.
        // The browser's default message will be used (e.g., "Changes you made may not be saved.")
        event.preventDefault(); // Required for older browsers
        event.returnValue = ''; // Standard for modern browsers
        console.log("Showing beforeunload warning due to unsaved changes in non-empty layout.");
    });
};

let selectedLayoutToLoad = null; // Track selected file in load modal

// NEW: Variable to hold the dynamically created input element for on-canvas name editing
let activeCanvasNameEditorInput = null;

/**
 * Sets the canvas zoom level and view offset to center the content.
 * @param {number|'fit'} level The desired zoom level (e.g., 1.0) or 'fit' to auto-fit content.
 */
export function setZoom(level) {
    // If editing a rack name, hide the editor before zooming as positions will change
    if (state.editingRackName) {
        hideCanvasRackNameEditor();
    }

    const canvasContainer = document.getElementById('canvas-container');

    let totalWorldWidth = constants.WORLD_WIDTH;
    if (state.isMultiRackView && state.racks.length > 0) {
        totalWorldWidth = state.racks.length * constants.WORLD_WIDTH + (state.racks.length - 1) * constants.RACK_SPACING;
    }
    let maxRackHeightU = 42;
    if (state.isMultiRackView) {
        if (state.racks.length > 0) maxRackHeightU = Math.max(...state.racks.map(r => r.heightU || 42));
    } else {
        if (state.activeRackIndex > -1 && state.racks[state.activeRackIndex]) maxRackHeightU = state.racks[state.activeRackIndex].heightU;
    }
    const worldHeight = constants.BASE_UNIT_HEIGHT * (maxRackHeightU + 4); // +4U for top/bottom padding/headers

    let newScale;
    if (level === 'fit') {
        const availableWidth = canvasContainer.clientWidth;
        const availableHeight = canvasContainer.clientHeight;
        const scaleX = availableWidth / totalWorldWidth;
        const scaleY = availableHeight / worldHeight;
        newScale = Math.min(scaleX, scaleY) * 0.9; // 90% of fit to give some margin
    } else {
        newScale = level;
    }
    state.setScale(newScale);

    const newViewOffset = {
        x: (canvasContainer.clientWidth - totalWorldWidth * state.scale) / 2,
        y: (canvasContainer.clientHeight - worldHeight * state.scale) / 2 + (constants.BASE_UNIT_HEIGHT * 1.5 * state.scale) // Adjust for top header space
    };
    state.setViewOffset(newViewOffset);

    drawRack();
    updateZoomButtons();
}

/**
 * Updates the UI of the zoom control buttons to highlight the active zoom level.
 */
export function updateZoomButtons() {
    document.querySelectorAll('#zoom-controls button').forEach(b => b.classList.remove('active'));
    let btnId = `zoom-${state.scale}x`.replace('.0x', 'x');
    if (btnId.indexOf('x') === -1) btnId = 'zoom-fit';
    const activeBtn = document.getElementById(btnId);
    if (activeBtn) activeBtn.classList.add('active');
}

/**
 * Updates the visibility and content of the single-rack navigation controls.
 */
export function updateRackControlsUI() {
    const nameInput = document.getElementById('rack-name-display'); // This is now an input
    const prevBtn = document.getElementById('prev-rack-btn');
    const nextBtn = document.getElementById('next-rack-btn');
    const deleteBtn = document.getElementById('delete-rack-btn');
    const rackSizeSelect = document.getElementById('rackSizeSelect');

    // Always show rack controls but manage internal elements based on view
    document.getElementById('rack-controls').style.display = 'flex';

    const singleViewElementsVisible = !state.isMultiRackView;

    // Manage visibility of the rack name input
    nameInput.style.display = singleViewElementsVisible ? '' : 'none';
    if (singleViewElementsVisible) {
        if (state.racks.length === 0 || state.activeRackIndex < 0) {
            nameInput.value = 'No Racks';
            nameInput.disabled = true; // Disable input if no rack
        } else {
            nameInput.value = state.racks[state.activeRackIndex]?.name || '';
            nameInput.disabled = false; // Enable input if a rack is active
        }
    }

    prevBtn.style.display = singleViewElementsVisible ? '' : 'none';
    nextBtn.style.display = singleViewElementsVisible ? '' : 'none';
    rackSizeSelect.parentElement.style.display = singleViewElementsVisible ? '' : 'none'; // Hide rack size in multi-rack view


    if (state.racks.length === 0 || state.activeRackIndex < 0) {
        prevBtn.style.visibility = 'hidden';
        nextBtn.style.visibility = 'hidden';
        deleteBtn.style.visibility = 'hidden';
    } else {
        const showNav = state.racks.length > 1 && singleViewElementsVisible;
        prevBtn.style.visibility = showNav ? 'visible' : 'hidden';
        nextBtn.style.visibility = showNav ? 'visible' : 'hidden';

        deleteBtn.style.visibility = 'visible';

        if (state.racks[state.activeRackIndex] && state.racks[state.activeRackIndex].heightU) {
            rackSizeSelect.value = state.racks[state.activeRackIndex].heightU;
        }
    }
}

/**
 * Handles renaming the active rack. Called on blur or Enter key press.
 * This is for the name input in the right sidebar (single rack view).
 * @param {Event} e The event object (e.g., blur event, keydown event).
 */
export function handleRackRename(e) {
    if (state.activeRackIndex === -1 || state.racks.length === 0) {
        return; // No rack to rename
    }

    let newName = e.target.value.trim();
    if (!newName) {
        // If empty, revert to a default name
        newName = `Rack ${state.activeRackIndex + 1}`;
    }

    state.racks[state.activeRackIndex].name = newName;
    drawRack(); // Redraw to update the name on canvas if in multi-rack view
    updateRackControlsUI(); // Update the input field value and state
}

/**
 * Toggles the view between the front and rear of the rack(s).
 */
export function toggleRackView() {
    // If editing a rack name, hide the editor before changing view
    if (state.editingRackName) {
        hideCanvasRackNameEditor();
    }
    state.setIsShowingRear(!state.isShowingRear);
    const btn = document.getElementById('view-toggle-btn');
    btn.textContent = state.isShowingRear ? 'Show Front' : 'Show Rear';
    btn.classList.toggle('active', state.isShowingRear);
    drawRack();
}

/**
 * Toggles the view between a single active rack and an overview of all racks.
 */
export function toggleMultiRackView() {
    console.log("Toggling multi-rack view...");
    // If editing a rack name, hide the editor before changing view
    if (state.editingRackName) {
        hideCanvasRackNameEditor();
    }
    state.setIsMultiRackView(!state.isMultiRackView);
    const btn = document.getElementById('toggle-layout-view-btn');
    btn.innerHTML = '🔲'; // Default to single rack view icon
    btn.title = 'Show All Racks';
    if (state.isMultiRackView) {
        btn.innerHTML = '🔳'; // Multi-rack view icon
        btn.title = 'Show Single Rack';
        console.log("Switched to Multi-Rack View.");
    } else {
        console.log("Switched to Single-Rack View.");
    }

    state.setSelectedItems([]);
    updateRackControlsUI();
    setZoom('fit');
    updateInfoPanel(); // Update info panel as selected items change and view mode affects which items are displayed
}

/**
 * Toggles the visibility of all notes on the canvas.
 */
export function toggleNotesView() {
    state.setIsShowingNotes(!state.isShowingNotes);
    const btn = document.getElementById('toggle-notes-btn');
    if (btn) {
        btn.classList.toggle('active', state.isShowingNotes);
        btn.title = state.isShowingNotes ? 'Hide Notes' : 'Show Notes';
    }
    drawRack();
}

/**
 * NEW: Updates the list of selected notes based on the marquee selection rectangle.
 * @param {boolean} isCtrlHeld - If true, adds to the current selection; otherwise, replaces it.
 */
function updateNoteSelection(isCtrlHeld) {
    const selWorldX1 = (state.selectionRect.x - state.viewOffset.x) / state.scale;
    const selWorldY1 = (state.selectionRect.y - state.viewOffset.y) / state.scale;
    const selWorldX2 = ((state.selectionRect.x + state.selectionRect.w) - state.viewOffset.x) / state.scale;
    const selWorldY2 = ((state.selectionRect.y + state.selectionRect.h) - state.viewOffset.y) / state.scale;

    const originalSelection = isCtrlHeld ? [...state.selectedNotes] : [];
    const notesInRect = [];
    const activeRackData = state.racks[state.activeRackIndex];

    if (!activeRackData || state.isMultiRackView) return; // Only for single-rack view

    const estimatedNoteFontSize = Math.max(9, Math.min(16, constants.BASE_UNIT_HEIGHT * 0.35));

    const checkItemNoteHit = (item, parentItem = null) => {
        if (!item.notes || item.notes.trim() === '') return;
        let itemRect; // Calculate itemRect similar to getNoteUnderMouse
        if (item.type === 'shelf-item') {
            if (!parentItem) return;
            const parentTopY = parentItem.y * constants.BASE_UNIT_HEIGHT;
            itemRect = { x: constants.BASE_UNIT_HEIGHT * 1.25 - constants.BASE_UNIT_HEIGHT * 0.2 + item.x, y: parentTopY - (item.size.height * constants.SHELF_ITEM_RENDER_SCALE), w: item.size.width * constants.SHELF_ITEM_RENDER_SCALE, h: item.size.height * constants.SHELF_ITEM_RENDER_SCALE };
        } else {
            itemRect = { x: constants.BASE_UNIT_HEIGHT * 1.25 - constants.BASE_UNIT_HEIGHT * 0.2, y: item.y * constants.BASE_UNIT_HEIGHT, w: constants.WORLD_WIDTH - (constants.BASE_UNIT_HEIGHT * 1.25 * 2) + (constants.BASE_UNIT_HEIGHT * 0.2 * 2), h: item.u * constants.BASE_UNIT_HEIGHT };
        }
        const metrics = getNoteDrawingMetrics(item, itemRect, item.noteOffset || { x: constants.DEFAULT_NOTE_OFFSET_X, y: constants.DEFAULT_NOTE_OFFSET_Y }, estimatedNoteFontSize, state.scale, true);
        const noteBox = metrics.noteBox;
        if (noteBox && selWorldX1 < noteBox.x + noteBox.w && selWorldX2 > noteBox.x && selWorldY1 < noteBox.y + noteBox.h && selWorldY2 > noteBox.y) {
            notesInRect.push({ noteOwner: item, rackIndex: state.activeRackIndex });
        }
    };

    activeRackData.equipment.forEach(item => {
        checkItemNoteHit(item);
        if (item.shelfItems) item.shelfItems.forEach(si => checkItemNoteHit(si, item));
    });

    const uniqueNotes = new Map();
    [...originalSelection, ...notesInRect].forEach(sel => uniqueNotes.set(sel.noteOwner, sel));
    state.setSelectedNotes(Array.from(uniqueNotes.values()));
}

/**
 * Updates the list of selected items based on the marquee selection rectangle.
 * @param {boolean} isCtrlHeld - If true, adds to the current selection; otherwise, replaces it.
 */
export function updateSelection(isCtrlHeld) {
    const selWorldX1 = (state.selectionRect.x - state.viewOffset.x) / state.scale;
    const selWorldY1 = (state.selectionRect.y - state.viewOffset.y) / state.scale;
    const selWorldX2 = ((state.selectionRect.x + state.selectionRect.w) - state.viewOffset.x) / state.scale;
    const selWorldY2 = ((state.selectionRect.y + state.selectionRect.h) - state.viewOffset.y) / state.scale;

    // NEW: Divert to note selection if applicable
    if (state.isNoteSelectionMarquee) {
        return updateNoteSelection(isCtrlHeld);
    }

    const originalSelection = isCtrlHeld ? [...state.selectedItems] : [];
    const itemsInRect = [];
    const racksToSearch = state.isMultiRackView ? state.racks : (state.activeRackIndex > -1 ? [state.racks[state.activeRackIndex]] : []);

    // Determine maxRackHeightU ONLY IF IN MULTI-RACK VIEW.
    // In single rack view, yOffset for item calculations should be 0, as the active rack's 0U is the world's 0Y for that rack.
    let maxRackHeightUForAlignment = 0;
    if (state.isMultiRackView && state.racks.length > 0) {
        maxRackHeightUForAlignment = Math.max(...state.racks.map(r => r.heightU || 42));
    }


    racksToSearch.forEach((rackData, rackIndexInSearch) => {
        const rackIndex = state.isMultiRackView ? state.racks.indexOf(rackData) : state.activeRackIndex; // Use actual index, not indexInSearch which is 0-based for filtered array
        const xOffset = state.isMultiRackView ? rackIndex * (constants.WORLD_WIDTH + constants.RACK_SPACING) : 0;

        // Correct yOffset calculation:
        // If in multi-rack view, align to floor based on maxRackHeightUForAlignment.
        // If in single-rack view, no y-offset is needed within the rack's world-space, as it's drawn at Y=0.
        const yOffset = state.isMultiRackView
            ? (maxRackHeightUForAlignment - rackData.heightU) * constants.BASE_UNIT_HEIGHT
            : 0; // Fixed: yOffset should be 0 in single-rack view for internal item calculations

        const eqPadding = constants.BASE_UNIT_HEIGHT * 0.2;
        const railWidth = constants.BASE_UNIT_HEIGHT * 1.25;
        const eqWorldLeft = xOffset + railWidth - eqPadding;
        const eqWorldRight = xOffset + constants.WORLD_WIDTH - railWidth + eqPadding;

        rackData.equipment.forEach(item => {
            if (item.type === 'v-pdu') {
                const pduDrawWidth = constants.BASE_UNIT_HEIGHT * 0.75;
                const rackRailRightAbs = xOffset + constants.WORLD_WIDTH - railWidth;
                const pduWorldX1 = (item.side === 'left') ? (xOffset + railWidth) : (rackRailRightAbs - pduDrawWidth);
                const pduWorldY1 = yOffset;

                const pduWorldX2 = pduWorldX1 + pduDrawWidth;
                const pduWorldY2 = pduWorldY1 + (rackData.heightU * constants.BASE_UNIT_HEIGHT);

                if (selWorldX1 < pduWorldX2 && selWorldX2 > pduWorldX1 && selWorldY1 < pduWorldY2 && selWorldY2 > pduWorldY1) {
                    itemsInRect.push({ item, parent: null, rackIndex });
                }
            } else {
                const parentWorldTop = yOffset + item.y * constants.BASE_UNIT_HEIGHT;
                const parentWorldBottom = parentWorldTop + item.u * constants.BASE_UNIT_HEIGHT;
                if (selWorldX1 < eqWorldRight && selWorldX2 > eqWorldLeft && selWorldY1 < parentWorldBottom && selWorldY2 > parentWorldTop) {
                    itemsInRect.push({ item: item, parent: null, rackIndex });
                }

                if (item.shelfItems) {
                    item.shelfItems.forEach(shelfItem => {
                        const drawW = shelfItem.size.width * constants.SHELF_ITEM_RENDER_SCALE;
                        const drawH = shelfItem.size.height * constants.SHELF_ITEM_RENDER_SCALE;
                        const itemWorldX1 = eqWorldLeft + shelfItem.x;
                        const itemWorldY1 = parentWorldTop - drawH;
                        const itemWorldX2 = itemWorldX1 + drawW;
                        const itemWorldY2 = itemWorldY1 + drawH;
                        if (selWorldX1 < itemWorldX2 && selWorldX2 > itemWorldX1 && selWorldY1 < itemWorldY2 && selWorldY2 > itemWorldY1) {
                            itemsInRect.push({ item: shelfItem, parent: item, rackIndex });
                        }
                    });
                }
            }
        });
    });

    const uniqueItems = new Map();
    [...originalSelection, ...itemsInRect].forEach(sel => uniqueItems.set(sel.item, sel));
    state.setSelectedItems(Array.from(uniqueItems.values()));
}

/**
 * Displays the context menu at a specific screen coordinate.
 * @param {number} x - The clientX coordinate.
 * @param {number} y - The clientY coordinate.
 */
export function showContextMenu(x, y) {
    // If editing a rack name, hide the editor before showing context menu
    if (state.editingRackName) {
        hideCanvasRackNameEditor();
        drawRack(); // Redraw immediately
    }
    updateContextMenuState();
    state.contextMenu.style.left = `${x}px`;
    state.contextMenu.style.top = `${y}px`;
    state.contextMenu.style.display = 'block';
}

/**
 * Hides the context menu.
 */
export function hideContextMenu() {
    state.contextMenu.style.display = 'none';
}

function checkDuplicateSpace(direction, count) {
    if (!state.selectedItems.length || state.selectedItems.some(s => s.item.type === 'v-pdu' || s.item.type === 'shelf-item')) return false;
    const rackIndex = state.selectedItems[0].rackIndex;
    if (state.selectedItems.some(s => s.rackIndex !== rackIndex)) return false;
    const currentRack = state.racks[rackIndex];
    const rack = currentRack.equipment;
    const currentRackHeightU = currentRack.heightU;
    const sel = state.selectedItems.map(s => s.item).sort((a, b) => a.y - b.y);
    const minY = sel[0].y;
    const maxY = Math.max(...sel.map(i => i.y + i.u));
    const blockHeight = maxY - minY;
    const otherItems = rack.filter(i => !sel.includes(i) && i.type !== 'v-pdu');
    for (let i = 1; i <= count; i++) {
        const offset = i * blockHeight;
        for (const item of sel) {
            const newY = item.y + (direction === 'down' ? offset : -offset);
            if (newY < 0 || newY + item.u > currentRackHeightU || otherItems.some(o => newY < o.y + o.u && newY + item.u > o.y)) {
                return false;
            }
        }
        // For subsequent duplicates, include previously created duplicates as 'other items'
        if (i < count) { // Only add if more duplicates are still to be checked
            otherItems.push(...sel.map(it => ({ y: it.y + (direction === 'down' ? offset : -offset), u: it.u })));
        }
    }
    return true;
}

export function updateContextMenuState() {
    state.contextMenu.querySelectorAll('li[data-action^="duplicate"]').forEach(li => {
        const dir = li.dataset.action.endsWith('up') ? 'up' : 'down';
        const count = parseInt(li.dataset.count, 10);
        li.classList.toggle('disabled', !checkDuplicateSpace(dir, count));
    });

    // REVISED: Logic for 'Align Horizontally' option
    const alignNotesLi = state.contextMenu.querySelector('li[data-action="align-notes-x"]');
    if (alignNotesLi) {
        // Enable alignment if a note was the target and at least two selected items have notes to align.
        const canAlign = state.contextMenuTargetNoteItem && state.selectedNotes.length > 1;

        // Show the option only if a note was right-clicked.
        alignNotesLi.style.display = state.selectedNotes.length > 0 ? 'block' : 'none';
        alignNotesLi.classList.toggle('disabled', !canAlign);

        // Also ensure the HR separator is only shown when the option is visible
        const hrAfterNotes = alignNotesLi.nextElementSibling;
        if (hrAfterNotes && hrAfterNotes.tagName === 'HR') {
            hrAfterNotes.style.display = alignNotesLi.style.display;
        }
    }

    // UPDATED: Logic for 'fill-blanks'
    const fillBlanksLi = state.contextMenu.querySelector('li[data-action="fill-blanks"]');
    if (fillBlanksLi) {
        // Enable if an active rack exists, regardless of single/multi-rack view
        fillBlanksLi.classList.toggle('disabled', state.activeRackIndex === -1 || state.racks.length === 0);
    }
    // Context menu item for editing notes. Re-enable its state logic if it's in the HTML
    const editNotesLi = state.contextMenu.querySelector('li[data-action="edit-notes"]');
    if (editNotesLi) {
        // 'Edit Notes' should only be enabled if exactly one item is selected, and no notes are selected.
        editNotesLi.classList.toggle('disabled', state.selectedItems.length !== 1 || state.selectedNotes.length > 0);
    }
}

export function duplicateSelection(direction, count) {
    if (!checkDuplicateSpace(direction, count)) return;
    const rackIndex = state.selectedItems[0].rackIndex;
    const rack = state.racks[rackIndex].equipment;
    const sel = state.selectedItems.map(s => s.item).sort((a, b) => a.y - b.y);
    const minY = sel[0].y;
    const maxY = Math.max(...sel.map(i => i.y + i.u));
    const height = maxY - minY;
    const newItems = [];
    for (let i = 1; i <= count; i++) {
        const offset = i * height;
        sel.forEach(item => {
            const newItem = JSON.parse(JSON.stringify(item));
            newItem.y = item.y + (direction === 'down' ? offset : -offset);
            if (!newItem.notes) newItem.notes = ''; // Ensure notes are initialized for new items
            if (!newItem.shelfItems) newItem.shelfItems = []; // Ensure shelfItems are initialized for new items
            if (newItem.noteOffset === undefined) newItem.noteOffset = { x: constants.DEFAULT_NOTE_OFFSET_X, y: constants.DEFAULT_NOTE_OFFSET_Y }; // NEW: Ensure noteOffset for duplicated items
            newItems.push(newItem);
        });
    }
    rack.push(...newItems);
    state.setSelectedItems([]); // Clear selection after duplication
    state.setSelectedNotes([]); // Clear note selection
    drawRack();
    updateInfoPanel(); // Update info panel after duplication
}

/**
 * Fills all empty U-spaces in the active rack with blanking plates.
 * Prioritizes larger blanking plates to fill space efficiently.
 */
export function fillRackWithBlanks() {
    if (state.activeRackIndex === -1 || state.racks.length === 0) {
        console.warn("Operation not permitted: No active rack selected.");
        return;
    }

    const rackData = state.racks[state.activeRackIndex];
    const rackHeightU = rackData.heightU;
    const equipment = rackData.equipment;

    // 1. Identify occupied units
    // Initialize an array representing each U-slot, marking it as false (empty)
    const occupied = new Array(rackHeightU).fill(false);
    equipment.forEach(item => {
        // V-PDUs and shelf items do not occupy standard front U-slots
        if (item.type !== 'v-pdu' && item.type !== 'shelf-item') {
            for (let u = item.y; u < item.y + item.u; u++) {
                if (u >= 0 && u < rackHeightU) { // Ensure U is within rack bounds
                    occupied[u] = true;
                }
            }
        }
    });

    // 2. Find contiguous empty spaces (ranges)
    const emptyRanges = [];
    let currentEmptyStart = -1;
    for (let i = 0; i < rackHeightU; i++) {
        if (!occupied[i]) {
            if (currentEmptyStart === -1) {
                currentEmptyStart = i; // Start of a new empty block
            }
        } else {
            if (currentEmptyStart !== -1) {
                // End of an empty block, add it to ranges
                emptyRanges.push({ startU: currentEmptyStart, sizeU: i - currentEmptyStart });
                currentEmptyStart = -1; // Reset for next empty block
            }
        }
    }
    // After the loop, check if there's an empty block extending to the end of the rack
    if (currentEmptyStart !== -1) {
        emptyRanges.push({ startU: currentEmptyStart, sizeU: rackHeightU - currentEmptyStart });
    }

    // 3. Fill empty spaces with blanking plates
    const newBlanks = [];
    // Use the BLANKING_PLATE_USIZES from constants, which are sorted descending
    const blankingPlateUSizes = constants.BLANKING_PLATE_USIZES;

    emptyRanges.forEach(range => {
        let currentY = range.startU;
        let remainingSize = range.sizeU;

        while (remainingSize > 0) {
            let bestFitU = 0;
            // Find the largest blanking plate that fits the remaining space
            for (const blankU of blankingPlateUSizes) {
                if (blankU <= remainingSize) {
                    bestFitU = blankU;
                    break; // Found the largest possible fit
                }
            }

            if (bestFitU > 0) {
                // Create the new blanking plate object
                const newBlank = {
                    y: currentY,
                    u: bestFitU,
                    label: `${bestFitU}U Blank Panel`,
                    type: 'blank',
                    stencil: `blank-${bestFitU}u`, // Assumes stencils like 'blank-1u', 'blank-2u', etc.
                    stencilRear: `blank-${bestFitU}u-rear`, // Assume rear stencil also, fallback to 1u rear
                    notes: '', // Initialize notes for the new item
                    noteOffset: { x: constants.DEFAULT_NOTE_OFFSET_X, y: constants.DEFAULT_NOTE_OFFSET_Y } // NEW: Initialize noteOffset for new items
                };
                newBlanks.push(newBlank);
                currentY += bestFitU;
                remainingSize -= bestFitU;
            } else {
                // Fallback: If no standard blank fits (e.g., remainingSize is 3U and only 1,2,4 available),
                // use remaining size. This should ideally not happen if 1U is always available.
                // In a robust system, you might only allow exact fits, or only 1U blanks for odd remainders.
                // For this exercise, we ensure it always fills.
                const newBlank = {
                    y: currentY,
                    u: remainingSize,
                    label: `${remainingSize}U Blank Panel`,
                    type: 'blank',
                    stencil: `blank-${remainingSize}u` || 'blank-1u', // Try specific, fallback to 1u
                    stencilRear: `blank-${remainingSize}u-rear` || `blank-1u-rear`, // Try specific, fallback to 1u rear
                    notes: '',
                    noteOffset: { x: constants.DEFAULT_NOTE_OFFSET_X, y: constants.DEFAULT_NOTE_OFFSET_Y } // NEW: Initialize noteOffset for new items
                };
                newBlanks.push(newBlank);
                remainingSize = 0; // Space is now filled
            }
        }
    });

    // 4. Add new blanks to rack and sort
    if (newBlanks.length > 0) {
        // Before adding new blanks, remove existing 'blank' type items to avoid duplicates
        // if user runs this multiple times without clearing.
        rackData.equipment = rackData.equipment.filter(item => item.type !== 'blank');

        rackData.equipment.push(...newBlanks);
        // Re-sort the entire equipment array to maintain order by U position
        rackData.equipment.sort((a, b) => a.y - b.y);
        state.setSelectedItems([]); // Clear any existing selection after modification
        state.setSelectedNotes([]);
        drawRack(); // Redraw the canvas to show the changes
        updateInfoPanel(); // Update info panel after filling
    }
}

/**
 * Deletes all currently selected items from their respective racks/parents.
 * This function is designed to be called without arguments and acts on state.selectedItems.
 */
export function deleteSelectedItem() { // Modified: No itemToDelete argument, operates on state.selectedItems
    if (state.selectedItems.length === 0) {
        // console.warn("No items selected to delete."); // Could be silent, or alert, depending on where it's called
        return;
    }

    const itemsToDelete = [...state.selectedItems]; // Create a copy for iteration
    let confirmationMessage;
    if (itemsToDelete.length === 1) {
        confirmationMessage = `Are you sure you want to delete "${itemsToDelete[0].item.label}"? This action cannot be undone.`;
    } else {
        confirmationMessage = `Are you sure you want to delete ${itemsToDelete.length} selected items? This action cannot be undone.`;
    }

    if (!confirm(confirmationMessage)) {
        return; // User cancelled
    }

    // Group items by rack for efficient deletion
    const itemsByRack = new Map(); // Map<rackIndex, { mainItems: Set<item>, shelfItems: Map<parentItem, Set<shelfItem>> }>
    itemsToDelete.forEach(sel => {
        if (!itemsByRack.has(sel.rackIndex)) {
            itemsByRack.set(sel.rackIndex, { mainItems: new Set(), shelfItems: new Map() });
        }
        const rackGroup = itemsByRack.get(sel.rackIndex);
        if (sel.item.type === 'shelf-item') {
            const parent = sel.parent; // Use the parent from the selected item object
            if (parent) {
                if (!rackGroup.shelfItems.has(parent)) {
                    rackGroup.shelfItems.set(parent, new Set());
                }
                rackGroup.shelfItems.get(parent).add(sel.item);
            } else {
                console.warn("Shelf item has no parent in selection object:", sel.item);
            }
        } else {
            rackGroup.mainItems.add(sel.item);
        }
    });

    itemsByRack.forEach((rackGroup, rackIndex) => {
        const currentRack = state.racks[rackIndex];
        if (!currentRack) return; // Rack might have been deleted previously, or index is invalid

        // 1. Delete main equipment items
        if (rackGroup.mainItems.size > 0) {
            currentRack.equipment = currentRack.equipment.filter(item => !rackGroup.mainItems.has(item));
        }

        // 2. Delete shelf items
        rackGroup.shelfItems.forEach((shelfItemsSet, parentItem) => {
            // Ensure parentItem is still in the rack and has shelfItems before filtering
            const foundParentInRack = currentRack.equipment.find(eq => eq === parentItem);
            if (foundParentInRack && foundParentInRack.shelfItems) {
                foundParentInRack.shelfItems = foundParentInRack.shelfItems.filter(si => !shelfItemsSet.has(si));
            }
        });
    });

    state.setSelectedItems([]); // Clear all selections after deletion
    state.setSelectedNotes([]);
    drawRack();
    updateInfoPanel();
}


export function deleteRack(indexToDelete) {
    if (state.racks.length === 0 || indexToDelete < 0 || indexToDelete >= state.racks.length) return;
    if (!confirm(`Are you sure you want to delete "${state.racks[indexToDelete].name}"? This cannot be undone.`)) return;
    state.racks.splice(indexToDelete, 1);
    if (state.activeRackIndex >= indexToDelete) {
        state.setActiveRackIndex(state.activeRackIndex - 1);
    }
    if (state.racks.length === 0) {
        addNewRack();
    } else {
        if (state.activeRackIndex < 0) state.setActiveRackIndex(0);
        state.setSelectedItems([]);
        state.setSelectedNotes([]);
        updateRackControlsUI();
        drawRack();
        setZoom('fit');
    }
    updateInfoPanel(); // Update info panel after rack deletion
}

export function switchRack(direction) {
    if (state.racks.length <= 1) return;
    if (direction === 'next') {
        state.setActiveRackIndex((state.activeRackIndex + 1) % state.racks.length);
    } else {
        state.setActiveRackIndex((state.activeRackIndex - 1 + state.racks.length) % state.racks.length);
    }
    state.setSelectedItems([]);
    state.setSelectedNotes([]);
    updateRackControlsUI();
    drawRack();
    updateInfoPanel(); // Update info panel after switching rack
}

export function updateRackSize() {
    if (state.activeRackIndex < 0) return;
    const newSize = parseInt(document.getElementById('rackSizeSelect').value);
    state.racks[state.activeRackIndex].heightU = newSize;
    drawRack();
    setZoom('fit');
    updateInfoPanel(); // Update info panel (e.g. if v-pdu is selected, its height will change)
}

export function populateEquipmentList(categories) {
    const container = document.getElementById('equipment-list-container');
    container.innerHTML = '';
    container.classList.add('custom-scrollbar');

    // 1×1 transparent pixel to suppress the browser's built-in drag preview
    const emptyImg = new Image();
    emptyImg.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

    // MODIFIED: Removed 'Shelf Items' and 'Blanking Panels'
    const openCategories = [
        'Servers & Compute',
        'Storage',
        'Networking'
    ];
    const arrowSVGString = `
      <svg class="arrow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M19 9l-7 7-7-7"/>
      </svg>`;

    categories.forEach(cat => {
        const details = document.createElement('details');
        details.className = 'sidebar-panel';
        details.open = openCategories.includes(cat.category);

        const summary = document.createElement('summary');
        summary.textContent = cat.category;
        // Attach arrow icon
        const tmp = document.createElement('div');
        tmp.innerHTML = arrowSVGString;
        if (tmp.firstElementChild) {
            summary.appendChild(tmp.firstElementChild);
        }
        details.appendChild(summary);

        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'tool-category-items';

        cat.items.forEach(itData => {
            const itemEl = document.createElement('div');
            itemEl.className = 'tool-item';
            itemEl.draggable = true;
            itemEl.textContent = itData.label;
            itemEl.dataset.type = itData.type;
            itemEl.dataset.stencil = itData.stencil;
            itemEl.dataset.stencilRear = itData.stencil_rear || '';
            if (itData.u) itemEl.dataset.u = itData.u;
            if (itData.size) itemEl.dataset.size = JSON.stringify(itData.size);

            itemEl.addEventListener('dragstart', e => {
                e.stopPropagation();

                // 1) Suppress the UA drag preview
                e.dataTransfer.setDragImage(emptyImg, 0, 0);
                e.dataTransfer.setData('label', itemEl.textContent);
                e.dataTransfer.setData('type', itemEl.dataset.type);
                e.dataTransfer.setData('stencil', itemEl.dataset.stencil);
                e.dataTransfer.setData('stencilRear', itemEl.dataset.stencilRear);
                if (itemEl.dataset.u) e.dataTransfer.setData('u', itemEl.dataset.u);
                if (itemEl.dataset.size) e.dataTransfer.setData('size', itemEl.dataset.size);
                const isShelfItem = itData.type === 'shelf-item';
                const ghostHeight = isShelfItem ? itData.size.height * constants.SHELF_ITEM_RENDER_SCALE * state.scale : (itData.u || 1) * constants.BASE_UNIT_HEIGHT * state.scale;

                // 2) Compute logical size in world units
                const isShelf = itData.type === 'shelf-item';
                const isVPDU = itData.type === 'v-pdu';
                let logicalW, logicalH;
                if (isShelf) {
                    logicalW = itData.size.width * constants.SHELF_ITEM_RENDER_SCALE;
                    logicalH = itData.size.height * constants.SHELF_ITEM_RENDER_SCALE;
                } else if (isVPDU) {
                    logicalW = constants.BASE_UNIT_HEIGHT * 0.75;
                    const pduHeightU = (itData.u && itData.u !== 'full') ? itData.u : (state.racks[state.activeRackIndex]?.heightU || 42);
                    logicalH = constants.BASE_UNIT_HEIGHT * pduHeightU;
                } else {
                    logicalW = constants.WORLD_WIDTH
                        - (constants.BASE_UNIT_HEIGHT * 1.25 * 2)
                        + (constants.BASE_UNIT_HEIGHT * 0.2 * 2);
                    logicalH = (itData.u || 1) * constants.BASE_UNIT_HEIGHT;
                }

                // 3) Convert to pixel dimensions
                const ghostW = logicalW * state.scale;
                const ghostH = logicalH * state.scale;
                if (ghostW <= 0 || ghostH <= 0) {
                    console.error('Invalid ghost size, falling back.');
                    return;
                }

                // 4) Select the appropriate stencil image
                const cache = state.isShowingRear ? state.stencilRearCache : state.stencilCache;
                const key = state.isShowingRear
                    ? (itData.stencil_rear || `${itData.stencil}-rear`)
                    : itData.stencil;
                let img = cache.get(key);
                if (!img?.complete) {
                    img = cache.get(
                        isShelf
                            ? 'generic-shelf-item'
                            : (isVPDU ? 'generic-v-pdu' : 'generic-equipment')
                    );
                }

                // 5) Draw the ghost canvas
                const ghost = document.createElement('canvas');
                ghost.width = ghostW;
                ghost.height = ghostH;
                const ctx = ghost.getContext('2d');
                ctx.clearRect(0, 0, ghostW, ghostH);
                if (img && img.complete) {
                    ctx.drawImage(img, 0, 0, ghostW, ghostH);
                } else {
                    ctx.fillStyle = utils.getColorByType(itData.type);
                    ctx.fillRect(0, 0, ghostW, ghostH);
                }

                // 6) Stamp the label with black stroke + white fill, centered
                const fontSize = Math.max(12, Math.floor(ghostH * 0.2));
                ctx.font = `bold ${fontSize}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.lineWidth = Math.max(2, fontSize * 0.1);
                ctx.strokeStyle = 'black';
                ctx.fillStyle = 'white';
                const cx = ghostW / 2;
                const cy = ghostH / 2;
                ctx.strokeText(itData.label, cx, cy);
                ctx.fillText(itData.label, cx, cy);

                // 7) Insert and position the ghost
                Object.assign(ghost.style, {
                    position: 'fixed',
                    pointerEvents: 'none',
                    opacity: '0.5',
                    zIndex: '9999',
                    top: `${e.clientY - ghostH / 2}px`,
                    left: `${e.clientX - ghostW / 2}px`
                });
                document.body.appendChild(ghost);

                // 8) Make it follow the cursor
                const move = ev => {
                    ev.preventDefault(); // Allow drop and get correct coordinates
                    ghost.style.top = `${ev.clientY - ghostH / 2}px`;
                    ghost.style.left = `${ev.clientX - ghostW / 2}px`;
                };
                document.addEventListener('dragover', move);

                // 9) Clean up on drag end
                itemEl.addEventListener('dragend', () => {
                    document.body.removeChild(ghost);
                    document.removeEventListener('dragover', move);
                });

                // 10) Copy all dataset values into dataTransfer
                Object.entries(itemEl.dataset).forEach(([k, v]) => {
                    if (v != null) e.dataTransfer.setData(k, v);
                });
            });

            itemsContainer.appendChild(itemEl);
        });

        details.appendChild(itemsContainer);
        container.appendChild(details);
    });
}

export function setTheme(theme, isInitialLoad = false) {
    localStorage.setItem('theme', theme);
    if (theme === 'dark') {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
    if (!isInitialLoad) {
        setTimeout(drawRack, 10);
    }
}

export function applyInitialTheme() {
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = savedTheme || (prefersDark ? 'dark' : 'light');
    setTheme(theme, true);
}

// Renamed from addNewRack to be more generic for creating a new rack instance
export function createNewRackInstance() {
    return {
        id: Date.now(), // Unique ID for the rack
        name: `Rack ${state.racks.length + 1}`,
        equipment: [],
        heightU: parseInt(document.getElementById('rackSizeSelect').value)
    };
}

export function addNewRack() {
    const newRack = createNewRackInstance();
    state.racks.push(newRack);
    state.setSelectedNotes([]);
    state.setActiveRackIndex(state.racks.length - 1);
    state.setSelectedItems([]);
    updateRackControlsUI();
    drawRack();
    setZoom('fit');
    updateInfoPanel();
}

/**
 * Explicitly opens the right info panel if it's currently collapsed.
 */
export function openInfoPanel() {
    const infoPanel = document.getElementById('right-info-panel');
    if (infoPanel.classList.contains('collapsed')) {
        infoPanel.classList.remove('collapsed');
        state.setIsInfoPanelOpen(true);
        // Redraw to resize the canvas to its new container dimensions without changing zoom/pan.
        drawRack();
    }
}

/**
 * Explicitly closes the right info panel if it's currently open.
 */
export function closeInfoPanel() {
    const infoPanel = document.getElementById('right-info-panel');
    if (!infoPanel.classList.contains('collapsed')) {
        infoPanel.classList.add('collapsed');
        state.setIsInfoPanelOpen(false);
        // Redraw to resize the canvas to its new container dimensions without changing zoom/pan.
        drawRack();
    }
}

/**
 * Toggles the visibility of the right info panel.
 */
export function toggleInfoPanel() {
    const infoPanel = document.getElementById('right-info-panel');
    if (infoPanel.classList.contains('collapsed')) {
        openInfoPanel();
    } else {
        closeInfoPanel();
    }
}


/**
 * Populates the info panel with details of selected items.
 * If no items are selected, displays a message.
 */
export function updateInfoPanel() {
    const infoPanelContent = document.getElementById('info-panel-content');
    infoPanelContent.innerHTML = ''; // clear existing

    // 1) Handle "No selection" or "Note selection"
    if (state.selectedNotes.length > 0) {
        infoPanelContent.innerHTML =
            `<p class="no-selection-message">
                ${state.selectedNotes.length} note(s) selected.
                <br><br>
                Right-click on a note to align the selection.
             </p>`;
        return;
    }
    if (state.selectedItems.length === 0) {
        infoPanelContent.innerHTML =
            '<p class="no-selection-message">Select an item on the canvas to see its details.</p>';
        return;
    }

    // 2) Sort selected equipment for consistent order
    const sortedSelectedItems = [...state.selectedItems].sort((a, b) => {
        if (a.rackIndex !== b.rackIndex) {
            return a.rackIndex - b.rackIndex;
        }
        // shelf-items: by parent.y then x
        if (a.item.type === 'shelf-item' && b.item.type === 'shelf-item') {
            const pa = utils.findCurrentParentOf(a.item);
            const pb = utils.findCurrentParentOf(b.item);
            if (pa && pb && pa.y !== pb.y) {
                return pa.y - pb.y;
            }
            return a.item.x - b.item.x;
        }
        // standard equipment: by y
        return a.item.y - b.item.y; // Corrected this line
    });

    // 3) Filter equipment by active rack if not in multi view
    const itemsToDisplay = state.isMultiRackView
        ? sortedSelectedItems
        : sortedSelectedItems.filter(s => s.rackIndex === state.activeRackIndex);

    if (itemsToDisplay.length === 0) {
        infoPanelContent.innerHTML =
            '<p class="no-selection-message">Select an item in the current rack to see its details.</p>';
        return;
    }

    // 4) Render each selected equipment item compactly
    itemsToDisplay.forEach(sel => {
        const { item, rackIndex, parent } = sel;
        const currentRack = state.racks[rackIndex];

        // <details> wrapper
        const details = document.createElement('details');
        details.className = 'item-info-section';
        details.open = true;

        // <summary> header
        const summary = document.createElement('summary');
        summary.textContent = item.label + ' ';
        const arrow = document.createElement('span');
        arrow.className = 'arrow';
        arrow.innerHTML =
            `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
           <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
             d="M19 9l-7 7-7-7"/>
         </svg>`;
        summary.appendChild(arrow);
        details.appendChild(summary);

        // content container
        const contentDiv = document.createElement('div');
        contentDiv.className = 'item-details-content';

        // --- compact info line ---
        const infoLine = document.createElement('div'); // Renamed to avoid 'line' conflict
        infoLine.style.display = 'flex';
        infoLine.style.flexWrap = 'wrap';
        infoLine.style.alignItems = 'center';
        infoLine.style.gap = '1rem';

        // Label: inline input
        const lblLabel = document.createElement('label');
        lblLabel.textContent = 'Label:';
        lblLabel.style.margin = '0';
        infoLine.appendChild(lblLabel);

        const lblInput = document.createElement('input');
        lblInput.type = 'text';
        lblInput.value = item.label;
        lblInput.style.flex = '1';
        lblInput.style.minWidth = '6rem';
        // stop canvas from stealing focus
        lblInput.addEventListener('mousedown', e => e.stopPropagation());
        // update model on change
        lblInput.addEventListener('input', e => {
            item.label = e.target.value;
            drawRack();
        });
        lblInput.addEventListener('blur', updateInfoPanel);
        lblInput.addEventListener('focus', e => e.target.select()); // NEW: Select all text on focus
        lblInput.addEventListener('dragstart', e => e.preventDefault()); // NEW: Prevent dragging from label input
        infoLine.appendChild(lblInput);

        // Type:
        const typeSpan = document.createElement('span');
        typeSpan.innerHTML = `<strong>Type:</strong> ${item.type}`;
        infoLine.appendChild(typeSpan);

        // U Position:
        let uPosText;
        if (item.type === 'v-pdu') {
            uPosText = 'Full Rack Height';
        } else if (item.type === 'shelf-item') {
            const parentRackItem = parent ? currentRack.equipment.find(eq => eq === parent) : null;
            if (parentRackItem) {
                uPosText = `${currentRack.heightU - (parentRackItem.y + parentRackItem.u - 1)}U (on ${parentRackItem.label})`;
            } else {
                uPosText = 'N/A (Shelf Item)';
            }
        } else {
            uPosText = `${currentRack.heightU - (item.y + item.u - 1)}U`;
        }
        const posSpan = document.createElement('span');
        posSpan.innerHTML = `<strong>U Position:</strong> ${uPosText}`;
        infoLine.appendChild(posSpan);

        contentDiv.appendChild(infoLine);

        // --- Notes Textarea ---
        const notesSectionDiv = document.createElement('div');
        notesSectionDiv.className = 'item-notes-section';
        notesSectionDiv.style.marginTop = '1rem';

        const notesLabel = document.createElement('label');
        notesLabel.textContent = 'Notes:';
        notesSectionDiv.appendChild(notesLabel);

        const notesTextarea = document.createElement('textarea');
        notesTextarea.value = item.notes || '';
        notesTextarea.rows = 4; // Adjust as needed
        notesTextarea.placeholder = 'Add notes here...';
        notesTextarea.style.width = '100%'; // Make it fill the available width
        notesTextarea.style.resize = 'vertical'; // Allow vertical resizing
        notesTextarea.style.marginTop = '0.5rem';

        // Prevent canvas interaction when typing in textarea
        notesTextarea.addEventListener('mousedown', e => e.stopPropagation());
        notesTextarea.addEventListener('mouseup', e => e.stopPropagation());
        notesTextarea.addEventListener('dragstart', e => e.preventDefault()); // NEW: Prevent dragging from notes textarea
        notesTextarea.addEventListener('input', e => {
            item.notes = e.target.value;
        });
        notesTextarea.addEventListener('blur', () => {
            drawRack(); // Redraw in case notes were previously empty and now display on canvas (single rack view)
        });
        notesSectionDiv.appendChild(notesTextarea);
        contentDiv.appendChild(notesSectionDiv);

        // --- actions row ---
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'item-actions';
        actionsDiv.style.marginTop = '1rem';
        actionsDiv.style.display = 'flex'; // Enable flexbox
        actionsDiv.style.justifyContent = 'flex-end'; // Align content to the right


        const delBtn = document.createElement('button');
        delBtn.className = 'delete-item-btn small-right-button'; // Add new class
        delBtn.textContent = 'Delete Item';
        delBtn.addEventListener('click', () => deleteSelectedItem()); // MODIFIED: Call deleteSelectedItem without args
        actionsDiv.appendChild(delBtn);

        contentDiv.appendChild(actionsDiv);
        details.appendChild(contentDiv);
        infoPanelContent.appendChild(details);
    });
}

/**
 * Creates and displays an input field directly on the canvas for renaming a rack.
 * @param {number} rackIndex The index of the rack to rename.
 * @param {object} rackData The data object for the rack being renamed.
 */
export function showCanvasRackNameEditor(rackIndex, rackData) {
    // Ensure any existing editor is removed first
    if (activeCanvasNameEditorInput) {
        hideCanvasRackNameEditor();
    }

    const nameBounds = rackData.nameBounds;
    if (!nameBounds) {
        console.warn("Rack name bounds not found for editing.");
        return;
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.value = rackData.name;
    input.classList.add('canvas-rack-name-editor'); // Apply CSS for styling and positioning

    // Calculate screen position and size from world coordinates
    // nameBounds.x/y/w/h are in world coordinates. Scale them to screen pixels.
    // Also consider the overall canvas viewOffset.
    const screenX = nameBounds.x * state.scale + state.viewOffset.x;
    const screenY = nameBounds.y * state.scale + state.viewOffset.y;
    const screenWidth = nameBounds.w * state.scale;
    const screenHeight = nameBounds.h * state.scale;


    input.style.position = 'absolute';
    input.style.left = `${screenX}px`;
    input.style.top = `${screenY}px`;
    input.style.width = `${screenWidth}px`;
    input.style.height = `${screenHeight}px`;

    // Adjust font size based on the current scale to match canvas text visually
    // The canvas font size is now `constants.BASE_UNIT_HEIGHT * 0.65`
    input.style.fontSize = `${constants.BASE_UNIT_HEIGHT * 0.65 * state.scale}px`;
    // Vertically center the text within the input field
    input.style.lineHeight = `${screenHeight}px`;
    input.style.textAlign = 'center';
    input.style.zIndex = '100'; // Ensure it's above canvas

    // Event listeners for the input
    input.addEventListener('blur', () => {
        let newName = input.value.trim();
        if (!newName) {
            newName = `Rack ${rackIndex + 1}`; // Fallback to default name if empty
        }
        rackData.name = newName; // Update the state
        hideCanvasRackNameEditor(); // Hide the input
        drawRack(); // Redraw canvas to show updated name
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault(); // Prevent new line or form submission
            input.blur(); // Trigger blur event to save
        }
    });

    // Append to canvas container to ensure positioning context
    canvas.parentElement.appendChild(input); // Append to parent of canvas
    activeCanvasNameEditorInput = input;
    input.focus();
    input.select(); // Select all text for easy editing
}

/**
 * Hides and removes the on-canvas rack name editor.
 */
export function hideCanvasRackNameEditor() {
    if (activeCanvasNameEditorInput && activeCanvasNameEditorInput.parentElement) {
        activeCanvasNameEditorInput.parentElement.removeChild(activeCanvasNameEditorInput);
    }
    activeCanvasNameEditorInput = null;
    state.setEditingRackName(false);
    state.setEditingRackIndex(-1);
}


// --- NEW: Save As Modal Functions (Reused for initial "Save") ---

// This modal is now used when state.currentFilename is null
export function showSaveFilenameModal() {
    document.getElementById('save-as-modal').classList.remove('hidden');
    document.getElementById('save-as-filename').value = state.currentFilename || ''; // Pre-fill if exists
    document.getElementById('save-as-filename').focus();
}

export function hideSaveFilenameModal() {
    document.getElementById('save-as-modal').classList.add('hidden');
}

/**
 * Handles saving the current layout. If a filename is established, it overwrites.
 * Otherwise, it prompts the user for a new filename.
 * @param {string|null} [filenameToUse=null] Optional: The filename to use directly (e.g., from modal input).
 */
export async function saveLayout(filenameToUse = null) {
    let filename;
    let cameFromSaveAsModal = false; // Flag to track if the call originated from the modal
    if (filenameToUse) {
        // Filename provided directly (e.g., from modal)
        filename = filenameToUse.trim();
        if (!filename) {
            alert('Please enter a filename.');
            return false;
        }
        cameFromSaveAsModal = true;
    } else if (state.currentFilename) {
        // Already loaded/saved a named file, just overwrite it
        filename = state.currentFilename;
        // Show a brief message as it's a silent save (removed alert here as api.js handles it now)
    } else {
        // No current filename, prompt for one
        showSaveFilenameModal();
        return; // Exit, save will happen via modal's save button
    }

    const success = await api.saveLayoutAs(filename); // api.saveLayoutAs now handles overwrite confirmation and sets state.currentFilename
    if (success && cameFromSaveAsModal) { // If save was successful AND it originated from the "Save As" modal (new file or confirmed overwrite)
        hideSaveFilenameModal(); // Hide the save modal
        await showLoadModal(); // Show the load modal to display updated list
    }
    // If it was a quick save (state.currentFilename existed), no additional modal interaction is needed.
}

/**
 * Initiates a new, empty layout.
 */
export function resetNewLayout() {
    // Check if a warning is required based on current state
    const warnRequired = !utils.isLayoutEffectivelyEmpty() && utils.hasUnsavedChanges();

    if (warnRequired) {
        if (!confirm("Are you sure you want to start a new, blank layout? Any unsaved changes will be lost.")) {
            return; // User cancelled
        }
    }

    state.setRacks([]); // Clear all racks
    state.setCurrentFilename(null); // No current file
    addNewRack(); // Add a default new rack (which internally sets activeRackIndex, etc.)
    // The new layout is now blank, so update savedLayoutContent to match this "saved" blank state
    state.setSavedLayoutContent(JSON.parse(JSON.stringify(state.racks)));
    // addNewRack already calls drawRack, setZoom, updateInfoPanel, updateRackControlsUI
    console.log("Layout reset to blank. Warning suppressed or confirmed.");
}

// --- NEW: Load Existing Modal Functions ---

export function setSelectedLayoutToLoad(filename) {
    selectedLayoutToLoad = filename;
}

export async function showLoadModal() {
    // If editing a rack name, hide the editor before showing load modal
    if (state.editingRackName) {
        hideCanvasRackNameEditor();
        drawRack(); // Redraw immediately
    }

    const loadModal = document.getElementById('load-modal');
    loadModal.classList.remove('hidden');
    await updateLoadModalList();
    // selectedLayoutToLoad will be set by updateLoadModalList if current file is found, otherwise it's null
    // Buttons will be enabled/disabled by updateLoadModalList based on this
}

export function hideLoadModal() {
    document.getElementById('load-modal').classList.add('hidden');
}

export async function updateLoadModalList() {
    const fileListDiv = document.getElementById('load-file-list');
    const loadBtn = document.getElementById('load-selected-btn');
    const deleteBtn = document.getElementById('delete-selected-btn');

    fileListDiv.innerHTML = '<p>Loading...</p>';
    const layouts = await api.getAvailableLayouts();
    fileListDiv.innerHTML = ''; // Clear loading message

    if (layouts.length === 0) {
        fileListDiv.innerHTML = '<p class="no-files-message">No saved layouts found.</p>';
        loadBtn.disabled = true;
        deleteBtn.disabled = true;
        selectedLayoutToLoad = null; // No files, so no selection
        return;
    }

    const ul = document.createElement('ul');
    layouts.sort((a, b) => a.localeCompare(b)); // Sort alphabetically

    // Track if the currently loaded file is found in the list and should be pre-selected
    let currentFileFoundAndSelected = false;

    layouts.forEach(filename => {
        const li = document.createElement('li');
        li.textContent = filename;
        li.dataset.filename = filename;
        li.addEventListener('click', () => {
            // Remove 'selected' from previously selected item
            const currentSelected = ul.querySelector('li.selected');
            if (currentSelected) {
                currentSelected.classList.remove('selected');
            }
            // Add 'selected' to clicked item
            li.classList.add('selected');
            setSelectedLayoutToLoad(filename); // Use the setter
            // Enable buttons when an item is selected
            loadBtn.disabled = false;
            deleteBtn.disabled = false;
        });

        // Highlight if this is the currently loaded file
        if (state.currentFilename === filename) {
            li.classList.add('current-file'); // Add new class for styling
            // Also mark it as selected for interactive purposes on modal open
            li.classList.add('selected'); // This is the line that should apply the visual highlighting
            setSelectedLayoutToLoad(filename); // Set this as the initial selection
            currentFileFoundAndSelected = true;
        }
        ul.appendChild(li);
    });
    fileListDiv.appendChild(ul);

    // After populating the list, set initial button states
    // If the current file was found and pre-selected, buttons should be enabled.
    // Otherwise, they should be disabled until a user clicks.
    if (currentFileFoundAndSelected) {
        loadBtn.disabled = false;
        deleteBtn.disabled = false;
    } else {
        // If no file was pre-selected (e.g., starting new, or current file not in list), disable buttons
        loadBtn.disabled = true;
        deleteBtn.disabled = true;
        selectedLayoutToLoad = null; // Explicitly clear selection if nothing is active
    }
}

export async function handleLoadSelected() {
    if (!selectedLayoutToLoad) {
        alert('Please select a layout to load.');
        return;
    }
    const success = await api.loadLayoutByName(selectedLayoutToLoad); // api.loadLayoutByName sets state.currentFilename
    if (success) {
        hideLoadModal();
        updateRackControlsUI();
        setZoom('fit');
        updateInfoPanel();
    }
}

export async function handleDeleteSelected() {
    if (!selectedLayoutToLoad) {
        alert('Please select a layout to delete.');
        return;
    }
    const success = await api.deleteLayout(selectedLayoutToLoad); // api.deleteLayout clears state.currentFilename if it was the active file
    if (success) {
        await updateLoadModalList(); // Refresh list after deletion
        selectedLayoutToLoad = null; // Clear selection after deletion
        // updateLoadModalList will handle disabling buttons if no selection
    }
}

/**
 * Sanitizes a string to be safe for use as a filename.
 * @param {string} name The string to sanitize.
 * @returns {string} The sanitized string.
 */
function sanitizeFilename(name) {
    if (!name) return '';
    // Replaces invalid characters with underscores and collapses multiple underscores
    return name.replace(/[^a-z0-9_.\-]/gi, '_').replace(/_{2,}/g, '_');
}


export function showImageExportModal() {
    document.getElementById('export-image-modal').classList.remove('hidden');
}

export function hideImageExportModal() {
    document.getElementById('export-image-modal').classList.add('hidden');
}

/**
 * Exports an image of all racks, either with or without notes.
 * @param {boolean} withNotes True to include notes, false to omit them.
 */
export async function exportAllRacksImage(withNotes) {
    hideImageExportModal();
    if (state.racks.length === 0) return alert("No racks to export!");

    const originalIsShowingNotes = state.isShowingNotes;
    state.setIsShowingNotes(withNotes); // Temporarily set note visibility

    const exportBtn = document.getElementById('export-image-btn');
    const originalText = exportBtn.textContent;
    exportBtn.textContent = 'Generating…';
    exportBtn.disabled = true;

    // Compute logical dimensions
    const U = constants.BASE_UNIT_HEIGHT;
    const maxRackHeightU = Math.max(...state.racks.map(r => r.heightU || 42));
    const logicalContentHeight = U * (maxRackHeightU + 4);
    const logicalRackOnlyWidth = state.racks.length * constants.WORLD_WIDTH + (state.racks.length - 1) * constants.RACK_SPACING;

    let notesWidthAdded = 0;
    if (withNotes) {
        // Calculate max note width across all racks
        state.racks.forEach(rack => {
            const itemsWithNotes = rack.equipment.flatMap(item => [item, ...(item.shelfItems || [])]).filter(i => i.notes && i.notes.trim());
            itemsWithNotes.forEach(item => {
                const lines = item.notes.split('\n');
                const estimatedNoteWidth = Math.max(...lines.map(l => l.length)) * 8 + (item.noteOffset?.x || constants.DEFAULT_NOTE_OFFSET_X);
                notesWidthAdded = Math.max(notesWidthAdded, estimatedNoteWidth);
            });
        });
    }

    const logicalContentWidth = logicalRackOnlyWidth + notesWidthAdded;
    const resolutionSelect = document.getElementById('export-resolution-select');
    const exportResolutionScale = parseInt(resolutionSelect.value, 10);

    const canvas = document.createElement('canvas');
    canvas.width = logicalContentWidth * exportResolutionScale;
    canvas.height = logicalContentHeight * exportResolutionScale;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;

    drawRackForExport(ctx, state.racks, {
        isMultiRackView: true,
        isShowingRear: state.isShowingRear,
        targetCanvasWidth: canvas.width,
        targetCanvasHeight: canvas.height,
        logicalContentWidth: logicalContentWidth,
        logicalContentHeight: logicalContentHeight,
        forPdfExport: false
    });

    // Trigger download
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    const notesSuffix = withNotes ? '_with_notes' : '_without_notes';
    link.download = `${state.currentFilename || 'rack_layout'}_all_racks${notesSuffix}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Restore original state
    state.setIsShowingNotes(originalIsShowingNotes);
    drawRack(); // Redraw main canvas with original settings
    exportBtn.textContent = originalText;
    exportBtn.disabled = false;
}

/**
 * Exports each rack as a separate PNG image, including its notes.
 */
export async function exportIndividualRacksImages() {
    hideImageExportModal();
    if (state.racks.length === 0) return alert("No racks to export!");

    const originalIsShowingNotes = state.isShowingNotes;
    state.setIsShowingNotes(true); // Individual exports always have notes

    const exportBtn = document.getElementById('export-image-btn');
    const originalText = exportBtn.textContent;
    exportBtn.textContent = 'Generating…';
    exportBtn.disabled = true;

    for (let i = 0; i < state.racks.length; i++) {
        const rackData = state.racks[i];

        // Compute logical dimensions for this single rack
        const U = constants.BASE_UNIT_HEIGHT;
        const logicalRackHeight = U * (rackData.heightU + 4);
        let notesWidthAdded = 0;
        const itemsWithNotes = rackData.equipment.flatMap(item => [item, ...(item.shelfItems || [])]).filter(it => it.notes && it.notes.trim());
        itemsWithNotes.forEach(item => {
            const lines = item.notes.split('\n');
            const estimatedNoteWidth = Math.max(...lines.map(l => l.length)) * 8 + (item.noteOffset?.x || constants.DEFAULT_NOTE_OFFSET_X);
            notesWidthAdded = Math.max(notesWidthAdded, estimatedNoteWidth);
        });

        const logicalContentWidth = constants.WORLD_WIDTH + notesWidthAdded;
        const resolutionSelect = document.getElementById('export-resolution-select');
        const exportResolutionScale = parseInt(resolutionSelect.value, 10);

        const canvas = document.createElement('canvas');
        canvas.width = logicalContentWidth * exportResolutionScale;
        canvas.height = logicalRackHeight * exportResolutionScale;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;

        drawRackForExport(ctx, [rackData], {
            isMultiRackView: false, // Draw as a single rack
            isShowingRear: state.isShowingRear,
            targetCanvasWidth: canvas.width,
            targetCanvasHeight: canvas.height,
            logicalContentWidth: logicalContentWidth,
            logicalContentHeight: logicalRackHeight,
            forPdfExport: false
        });

        // Trigger download
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        const rackNameSanitized = sanitizeFilename(rackData.name);
        link.download = `${state.currentFilename || 'rack_layout'}_rack_${i + 1}_${rackNameSanitized}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Brief pause to prevent browser from getting overwhelmed
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Restore original state
    state.setIsShowingNotes(originalIsShowingNotes);
    drawRack();
    exportBtn.textContent = originalText;
    exportBtn.disabled = false;
}


export async function exportToPdf() {
    console.log('exportToPdf function triggered.');
    if (state.racks.length === 0) {
        return alert("No racks to export to PDF.");
    }

    // Show a loading indicator
    const exportBtn = document.getElementById('export-pdf-btn');
    if (!exportBtn) {
        console.error("Export PDF Button not found in DOM! ID: export-pdf-btn");
        alert("Export button not found. Please check HTML.");
        return;
    }
    const originalText = exportBtn.textContent;
    exportBtn.textContent = 'Generating...';
    exportBtn.disabled = true;

    // Ensure jsPDF is available
    if (typeof window.jspdf === 'undefined') {
        alert("jsPDF library not loaded. Cannot export to PDF.");
        console.error("jsPDF is not defined. Make sure it's loaded via a script tag.");
        exportBtn.textContent = originalText;
        exportBtn.disabled = false;
        return;
    }
    const { jsPDF } = window.jspdf;

    const doc = new jsPDF({
        orientation: 'portrait', // Changed to PORTRAIT
        unit: 'pt',
        format: 'a4'
    });

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const standardPadding = 40; // pt
    const textColumnPadding = 20; // pt between image and text

    const availableContentWidth = pageW - 2 * standardPadding;
    const availableContentHeight = pageH - 2 * standardPadding;

    // Divide page into two columns for image and notes
    const imageColumnWidth = availableContentWidth * 0.45; // ~45% for image
    const notesColumnWidth = availableContentWidth - imageColumnWidth - textColumnPadding; // Remaining for notes


    // Function to draw wrapped text
    const drawWrappedText = (text, x, y, maxWidth, lineHeight, fontSize) => {
        doc.setFontSize(fontSize);
        const lines = doc.splitTextToSize(text, maxWidth);
        for (let j = 0; j < lines.length; j++) {
            doc.text(lines[j], x, y + (j * lineHeight));
        }
        return y + (lines.length * lineHeight); // Return the y position after drawing
    };

    for (let i = 0; i < state.racks.length; i++) {
        const rackData = state.racks[i];
        if (i > 0) doc.addPage(); // Add a new page for each rack after the first

        // 1. Draw Rack Name as Page Title
        const headerTopOffset = standardPadding / 2 + 15; // Y position for the title
        const headerLineY = standardPadding + 20; // Y position for the line below the title
        // const headerHeight = headerLineY - standardPadding; // Height of the header section (20pt) - not directly used in positioning, but good for context

        doc.setFontSize(18);
        doc.text(`Rack: ${rackData.name}`, pageW / 2, headerTopOffset, { align: 'center' });

        // Ensure color is black for lines if in light mode, white if in dark mode
        const isDarkMode = document.documentElement.classList.contains('dark');
        doc.setDrawColor(isDarkMode ? 255 : 0); // 0 for black, 255 for white
        doc.setLineWidth(1);
        doc.line(standardPadding, headerLineY, pageW - standardPadding, headerLineY); // Line below title

        // 2. Prepare Canvas for Rack Image (without notes)
        // This temp canvas will contain only the rack image, which is then added to the PDF.
        // We set forPdfExport to true to ensure that notes (which will be rendered as text columns)
        // are NOT drawn on the canvas image itself.
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');

        // Logical dimensions of the rack content (World units for drawing)
        // We don't need to account for notes here, as notes will be handled as separate text on the PDF
        // and not drawn on the canvas.
        const logicalRackWidth = constants.WORLD_WIDTH; // Rack width in world units
        const logicalRackHeight = rackData.heightU * constants.BASE_UNIT_HEIGHT; // Rack height in world units

        // Define a resolution for the temporary canvas for PDF image. Higher is better for quality.
        // This multiplier determines how many *physical* pixels represent one *logical* unit on the temp canvas.
        const pdfImageResolutionScale = 3; // e.g., 3 physical pixels per world unit

        // Set temp canvas dimensions in physical pixels for high quality rendering
        tempCanvas.width = logicalRackWidth * pdfImageResolutionScale;
        tempCanvas.height = logicalRackHeight * pdfImageResolutionScale;

        // Ensure image smoothing for quality
        tempCtx.imageSmoothingEnabled = true;
        tempCtx.webkitImageSmoothingEnabled = true;
        tempCtx.mozImageSmoothingEnabled = true;
        tempCtx.msImageSmoothingEnabled = true;

        await new Promise(resolve => setTimeout(resolve, 0));

        // Draw this single rack onto the temporary canvas.
        // `targetCanvasWidth` and `targetCanvasHeight` here represent the physical dimensions
        // of the temp canvas. `logicalContentWidth` and `logicalContentHeight` represent the
        // "world" units of the rack itself that `drawRackForExport` needs to fit.
        drawRackForExport(tempCtx, [rackData], { // Pass rackData as an array for single rack view
            isMultiRackView: false, // Force single rack view for this export
            isShowingRear: state.isShowingRear,
            targetCanvasWidth: tempCanvas.width,    // Physical width of temp canvas
            targetCanvasHeight: tempCanvas.height,  // Physical height of temp canvas
            logicalContentWidth: logicalRackWidth,  // Logical width of content to fit (just the rack)
            logicalContentHeight: logicalRackHeight, // Logical height of content to fit (just the rack)
            forPdfExport: true // IMPORTANT: Set to true for PDF export (skips notes drawing on canvas)
        });

        const imgData = tempCanvas.toDataURL('image/jpeg', 1); // 1.0 for max quality

        // 3. Calculate Rack Image Dimensions and Position on PDF
        let imgWidth, imgHeight;
        // Use the logical dimensions for aspect ratio calculation, not the physical canvas size
        const imgAspectRatio = logicalRackWidth / logicalRackHeight;

        // Calculate available space for the rack image below the header, spanning the full content height.
        // Allocate space for the image, leaving some room for the header and notes
        const availableHeightForRackImage = availableContentHeight - (headerLineY - standardPadding) - 10; // header height (from standardPadding to headerLineY) + 10pt buffer
        imgHeight = availableHeightForRackImage;
        imgWidth = imgHeight * imgAspectRatio;

        // If the resulting width (after fitting to height) overflows the image column,
        // then scale down to fit the column width.
        if (imgWidth > imageColumnWidth) {
            imgWidth = imageColumnWidth;
            imgHeight = imgWidth / imgAspectRatio;
        }

        // Position the image: flush below the header, centered horizontally within its column.
        const imgX = standardPadding + (imageColumnWidth - imgWidth) / 2; // Center horizontally within image column
        const imgY = headerLineY + 10; // Position below header, with a small buffer

        doc.addImage(imgData, 'JPEG', imgX, imgY, imgWidth, imgHeight);

        // 4. Collect and Draw Equipment Details
        let mainEquipmentForSorting = [];
        rackData.equipment.forEach(item => {
            // Collect all main equipment (not shelf items)
            if (item.type !== 'shelf-item') {
                mainEquipmentForSorting.push(item);
            }
        });

        // Sort main equipment by their 'y' position (U from top) in DESCENDING order
        // This achieves the bottom-up display order (1U, 2U, ..., 42U)
        mainEquipmentForSorting.sort((a, b) => {
            // Handle V-PDUs sorting separately as they don't have a standard U position
            // Put V-PDUs at the top of the details list if desired, or handle their order specifically.
            // For now, let's put V-PDUs (which usually have y=0) before other items when sorting descending.
            // If both are V-PDUs, maintain their original relative order.
            if (a.type === 'v-pdu' && b.type !== 'v-pdu') return -1;
            if (a.type !== 'v-pdu' && b.type === 'v-pdu') return 1;
            if (a.type === 'v-pdu' && b.type === 'v-pdu') return 0;

            // For standard equipment, sort by y-position (from top) descending for bottom-up U order
            return b.y - a.y; // Higher y means lower U position (closer to bottom of rack)
        });

        let currentNotesY = headerLineY + 20; // Start details below the title line and add a buffer
        const detailLineHeight = 12; // pt
        const detailFontSizeHeader = 12; // For "Rack Equipment Details:" header
        const detailFontSizeItemMain = 10; // For item label, type, U position
        const detailFontSizeItemNotes = 9; // For actual notes text

        const notesColumnX = standardPadding + imageColumnWidth + textColumnPadding;

        if (mainEquipmentForSorting.length > 0) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(detailFontSizeHeader);
            doc.text('Rack Equipment Details:', notesColumnX, currentNotesY);
            currentNotesY += detailLineHeight * 1.5; // Space after "Rack Equipment Details:" header

            mainEquipmentForSorting.forEach(item => {
                // Calculate U Position string for display
                let uPosText = '';
                if (item.type === 'v-pdu') {
                    uPosText = 'Full Rack Height';
                } else if (item.y !== undefined) {
                    uPosText = `${rackData.heightU - (item.y + item.u - 1)}U`;
                }

                doc.setFont('helvetica', 'normal'); // Set to normal font for the main line
                doc.setFontSize(detailFontSizeItemMain);

                let itemLabelText = `${item.label}`;
                if (item.type) {
                    itemLabelText += ` (Type: ${item.type})`;
                }
                if (uPosText) { // Check if uPosText is not empty
                    itemLabelText += ` [U Position: ${uPosText}]`;
                }
                itemLabelText += ':'; // Add a colon at the end of the main info line

                currentNotesY += detailLineHeight * 0.5; // Small space above each new item's details

                currentNotesY = drawWrappedText(itemLabelText, notesColumnX, currentNotesY, notesColumnWidth, detailLineHeight, detailFontSizeItemMain);

                // Draw the notes for the main item
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(isDarkMode ? 200 : 50); // Slightly lighter/darker text for notes based on theme
                doc.setFontSize(detailFontSizeItemNotes);
                if (item.notes && item.notes.trim() !== '') {
                    currentNotesY = drawWrappedText(item.notes, notesColumnX + 10, currentNotesY, notesColumnWidth - 10, detailLineHeight, detailFontSizeItemNotes); // Indent notes
                } else {
                    doc.text('No additional notes.', notesColumnX + 10, currentNotesY); // Indent this message too
                    currentNotesY += detailLineHeight;
                }

                // Now, if this is a shelf item parent, list its shelf items
                if (item.shelfItems && item.shelfItems.length > 0) {
                    currentNotesY += detailLineHeight * 0.5; // Small space before listing shelf items
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(detailFontSizeItemMain - 1); // Slightly smaller bold for shelf item header
                    doc.text('Shelf Items:', notesColumnX + 10, currentNotesY);
                    currentNotesY += detailLineHeight;

                    item.shelfItems.forEach(shelfItem => {
                        doc.setFont('helvetica', 'normal'); // Set to normal font for shelf item line
                        doc.setFontSize(detailFontSizeItemMain - 1); // Slightly smaller font for shelf item

                        let shelfItemLabelText = `${shelfItem.label}`;
                        if (shelfItem.type) {
                            shelfItemLabelText += ` (Type: ${shelfItem.type})`;
                        }
                        shelfItemLabelText += ':';

                        currentNotesY = drawWrappedText(shelfItemLabelText, notesColumnX + 20, currentNotesY, notesColumnWidth - 20, detailLineHeight, detailFontSizeItemMain - 1);

                        doc.setFont('helvetica', 'normal');
                        doc.setTextColor(isDarkMode ? 200 : 50);
                        doc.setFontSize(detailFontSizeItemNotes);
                        if (shelfItem.notes && shelfItem.notes.trim() !== '') {
                            currentNotesY = drawWrappedText(shelfItem.notes, notesColumnX + 30, currentNotesY, notesColumnWidth - 30, detailLineHeight, detailFontSizeItemNotes); // Further indent shelf item notes
                        } else {
                            doc.text('No additional notes.', notesColumnX + 30, currentNotesY);
                            currentNotesY += detailLineHeight;
                        }
                        currentNotesY += detailLineHeight * 0.2; // Smaller space between shelf items
                    });
                }

                currentNotesY += detailLineHeight * 0.5; // Space after entire item block (including its shelf items)
            });
        } else {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(detailFontSizeItemNotes);
            doc.text('No equipment found in this rack.', notesColumnX, currentNotesY + detailLineHeight);
        }

        tempCanvas.remove();
    }

    doc.save(`${state.currentFilename || 'rack_layout'}_all-racks.pdf`);
    console.log('PDF export completed.');

    exportBtn.textContent = originalText;
    exportBtn.disabled = false;
}