// --- START OF FILE ui.js ---


// ui.js
import * as api from './api.js';
import { canvas, drawRack, drawRackForExport } from './canvas.js'; // Import canvas directly
import * as constants from './constants.js';
import * as state from './state.js';
import * as utils from './utils.js'; // NEW: Import utils for state comparison

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
 * Updates the list of selected items based on the marquee selection rectangle.
 * @param {boolean} isCtrlHeld - If true, adds to the current selection; otherwise, replaces it.
 */
export function updateSelection(isCtrlHeld) {
    const selWorldX1 = (state.selectionRect.x - state.viewOffset.x) / state.scale;
    const selWorldY1 = (state.selectionRect.y - state.viewOffset.y) / state.scale;
    const selWorldX2 = ((state.selectionRect.x + state.selectionRect.w) - state.viewOffset.x) / state.scale;
    const selWorldY2 = ((state.selectionRect.y + state.selectionRect.h) - state.viewOffset.y) / state.scale;

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

    // UPDATED: Logic for 'fill-blanks'
    const fillBlanksLi = state.contextMenu.querySelector('li[data-action="fill-blanks"]');
    if (fillBlanksLi) {
        // Enable if an active rack exists, regardless of single/multi-rack view
        fillBlanksLi.classList.toggle('disabled', state.activeRackIndex === -1 || state.racks.length === 0);
    }
    // Context menu item for editing notes. Re-enable its state logic if it's in the HTML
    const editNotesLi = state.contextMenu.querySelector('li[data-action="edit-notes"]');
    if (editNotesLi) {
        // 'Edit Notes' should only be enabled if exactly one item is selected
        editNotesLi.classList.toggle('disabled', state.selectedItems.length !== 1);
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
    const openCategories = ['Servers & Compute', 'Storage', 'Networking', 'Shelf Items', 'Blanking Panels'];
    const arrowSVGString = `<svg class="arrow" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>`;

    categories.forEach(cat => {
        const details = document.createElement('details');
        details.className = 'sidebar-panel';
        details.open = openCategories.includes(cat.category);

        const summary = document.createElement('summary');
        summary.textContent = cat.category; // Set text content first

        // NEW: Create a temporary div to parse the SVG string into an actual SVG element
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = arrowSVGString;
        const svgElement = tempDiv.firstChild; // Get the SVG element

        if (svgElement && svgElement.nodeType === 1) { // Ensure it's an element node
            summary.appendChild(svgElement); // Append the actual SVG element
        } else {
            console.warn("Failed to parse arrow SVG string into an element.");
            // Fallback: If SVG parsing fails, just append the raw string as text or do nothing
            summary.textContent += ' (Toggle)'; // Add a visual hint if arrow is missing
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
                e.dataTransfer.setData('label', itemEl.textContent);
                e.dataTransfer.setData('type', itemEl.dataset.type);
                e.dataTransfer.setData('stencil', itemEl.dataset.stencil);
                e.dataTransfer.setData('stencilRear', itemEl.dataset.stencilRear);
                if (itemEl.dataset.u) e.dataTransfer.setData('u', itemEl.dataset.u);
                if (itemEl.dataset.size) e.dataTransfer.setData('size', itemEl.dataset.size);
                const isShelfItem = itData.type === 'shelf-item';
                const ghostHeight = isShelfItem ? itData.size.height * constants.SHELF_ITEM_RENDER_SCALE * state.scale : (itData.u || 1) * constants.BASE_UNIT_HEIGHT * state.scale;
                const ghostWidth = isShelfItem ? itData.size.width * constants.SHELF_ITEM_RENDER_SCALE * state.scale : (itData.type === 'v-pdu' ? constants.BASE_UNIT_HEIGHT * 0.75 : constants.WORLD_WIDTH - (constants.BASE_UNIT_HEIGHT * 1.25 * 2) + (constants.BASE_UNIT_HEIGHT * 0.2 * 2)) * state.scale;
                const ghost = document.createElement('div');
                ghost.style.cssText = `position:fixed;pointer-events:none;z-index:9999;width:${ghostWidth}px;height:${ghostHeight}px;background:${utils.getColorByType(itData.type)};color:#fff;font-size:14px;font-weight:700;padding-left:10px;border-radius:4px;display:flex;align-items:center;justify-content:center;box-shadow:0 5px 15px rgba(0,0,0,0.2);top:${e.clientY - ghostHeight / 2}px;left:${e.clientX - ghostWidth / 2}px;`;
                ghost.textContent = itData.label;
                state.setActiveDragGhost(ghost);
                document.body.appendChild(ghost);
                const trans = document.createElement('canvas');
                trans.width = 1; trans.height = 1;
                e.dataTransfer.setDragImage(trans, 0, 0);
            });
            itemEl.addEventListener('drag', e => { if (state.activeDragGhost && e.clientX > 1 && e.clientY > 1) { state.activeDragGhost.style.top = `${e.clientY - state.activeDragGhost.offsetHeight / 2}px`; state.activeDragGhost.style.left = `${e.clientX - state.activeDragGhost.offsetWidth / 2}px`; } });
            itemEl.addEventListener('dragend', () => { if (state.activeDragGhost) { document.body.removeChild(state.activeDragGhost); state.setActiveDragGhost(null); } });
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
        // Recalculate zoom to adjust canvas for the changed panel size
        setZoom('fit');
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
        // Recalculate zoom to adjust canvas for the changed panel size
        setZoom('fit');
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

    // 1) No selection
    if (state.selectedItems.length === 0) {
        infoPanelContent.innerHTML =
            '<p class="no-selection-message">Select an item on the canvas to see its details.</p>';
        return;
    }

    // 2) Sort selected items for consistent order
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

    // 3) Filter by active rack if not in multi view
    const itemsToDisplay = state.isMultiRackView
        ? sortedSelectedItems
        : sortedSelectedItems.filter(s => s.rackIndex === state.activeRackIndex);

    if (itemsToDisplay.length === 0) {
        infoPanelContent.innerHTML =
            '<p class="no-selection-message">Select an item in the current rack to see its details.</p>';
        return;
    }

    // 4) Render each selected item compactly
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
                uPosText = `${currentRack.heightU - parentRackItem.y}U (on ${parentRackItem.label})`;
            } else {
                uPosText = 'N/A (Shelf Item)';
            }
        } else {
            uPosText = `${currentRack.heightU - item.y}U`;
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
        notesTextarea.addEventListener('input', e => {
            item.notes = e.target.value;
        });
        notesTextarea.addEventListener('blur', () => {
            drawRack(); // Redraw in case notes were previously empty and now display on canvas (single rack view)
        });
        notesSectionDiv.appendChild(notesTextarea);
        contentDiv.appendChild(notesSectionDiv);

        // NEW: Removed Note Position Control from info panel as it's now handled by dragging
        // This entire block is now gone:
        // const notePositionDiv = document.createElement('div');
        // notePositionDiv.className = 'item-note-position-control';
        // notePositionDiv.style.marginTop = '1rem';
        // notePositionDiv.style.display = 'flex';
        // notePositionDiv.style.alignItems = 'center';
        // notePositionDiv.style.gap = '0.5rem';
        // ...
        // notePositionDiv.appendChild(notePositionSelect);
        // contentDiv.appendChild(notePositionDiv);


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
    // The original canvas font size was `constants.BASE_UNIT_HEIGHT * 0.5`
    input.style.fontSize = `${constants.BASE_UNIT_HEIGHT * 0.5 * state.scale}px`;
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


// --- NEW: Save As Modal Functions (Reused for 'Save' when currentFilename is null) ---

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

// New Export functions
export async function exportToImage() {
    if (!state.racks.length) {
        return alert("No racks to export!");
    }

    // Show a loading indicator
    const exportBtn = document.getElementById('export-image-btn');
    if (!exportBtn) {
        console.error("Export Image Button not found in DOM! ID: export-image-btn");
        alert("Export button not found. Please check HTML.");
        return;
    }
    const originalText = exportBtn.textContent;
    exportBtn.textContent = 'Generating…';
    exportBtn.disabled = true;

    // 1) Compute the _logical_ dimensions of the content (world coords for drawing)
    const U = constants.BASE_UNIT_HEIGHT;
    const maxRackHeightU = state.racks.length > 0 ? Math.max(...state.racks.map(r => r.heightU || 42)) : 42;
    // Total logical height includes padding for top/bottom header space that drawRackForExport expects to draw.
    const logicalContentHeight = U * (maxRackHeightU + 4);

    // Calculate total logical width for all racks + spacing
    const logicalRackOnlyWidth = state.racks.length * constants.WORLD_WIDTH
        + (state.racks.length - 1) * constants.RACK_SPACING;

    // Calculate horizontal space needed for notes
    let notesWidthAdded = 0;
    state.racks.forEach(rack => {
        rack.equipment.forEach(item => {
            if (item.notes && item.notes.trim()) {
                const lines = item.notes.split('\n').map(l => l.trim());
                // Estimate width based on character count (rough) and a max line width
                const estimatedLineWidth = 150; // Max estimated logical width for a single note's content
                const avgCharWidth = 8; // Average logical pixels per character
                const estimatedNoteWidth = Math.min(estimatedLineWidth, Math.max(...lines.map(l => l.length)) * avgCharWidth) + 40; // rough: char * avgCharWidth + padding
                notesWidthAdded = Math.max(notesWidthAdded, estimatedNoteWidth);
            }
        });
    });
    // Total logical width includes racks, spacing, notes, and a gutter for spacing notes from racks
    const logicalContentWidth = logicalRackOnlyWidth + notesWidthAdded + 20; // +20px gutter between racks and notes

    // 2) Define desired physical output resolution for the image.
    // This is a multiplier for the *logical* content dimensions to get the final physical pixel dimensions.
    const exportResolutionScale = 2; // e.g., 2 physical pixels per logical 'world' unit

    // Calculate the physical pixel dimensions of the off-screen canvas for export
    const canvas = document.createElement('canvas');
    canvas.width = logicalContentWidth * exportResolutionScale;
    canvas.height = logicalContentHeight * exportResolutionScale;
    const ctx = canvas.getContext('2d');

    // Ensure image smoothing for quality
    ctx.imageSmoothingEnabled = true;
    ctx.webkitImageSmoothingEnabled = true;
    ctx.mozImageSmoothingEnabled = true;
    ctx.msImageSmoothingEnabled = true;

    // 3) Draw the racks into it, passing the physical canvas dimensions and logical content dimensions
    drawRackForExport(ctx, state.racks, {
        isMultiRackView: true,
        isShowingRear: state.isShowingRear,
        targetCanvasWidth: canvas.width,    // Physical width of temp canvas
        targetCanvasHeight: canvas.height,  // Physical height of temp canvas
        logicalContentWidth: logicalContentWidth, // Logical width of content to fit
        logicalContentHeight: logicalContentHeight, // Logical height of content to fit
        forPdfExport: false // Set to false: does not remove extra padding
    });

    // 4) Trigger download
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `${state.currentFilename || 'rack_layout'}_full-bleed.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

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
                    uPosText = `${rackData.heightU - item.y}U`; // Calculate U from bottom
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