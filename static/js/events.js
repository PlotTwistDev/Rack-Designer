import { canvas, drawRack } from './canvas.js';
import * as constants from './constants.js';
import { getNoteDrawingMetrics } from './renderer.js'; // Import the new function
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