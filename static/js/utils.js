// --- START OF FILE utils.js ---

import * as constants from './constants.js';
import * as state from './state.js';

// --- Helper Functions ---
export function getRackFromWorldPos(worldPos) {
    if (!state.isMultiRackView) {
        if (state.activeRackIndex > -1) {
            const rackData = state.racks[state.activeRackIndex];
            const worldHeight = rackData.heightU * constants.BASE_UNIT_HEIGHT;
            // Check if worldPos is within the boundaries of the single active rack's drawn area
            // (even if there's padding or controls around it in screen space, the world space for a single rack starts at 0,0)
            if (worldPos.x >= 0 && worldPos.x < constants.WORLD_WIDTH && worldPos.y >= 0 && worldPos.y < worldHeight) {
                return {
                    rackIndex: state.activeRackIndex,
                    rackData: rackData,
                    localX: worldPos.x,
                    localY: worldPos.y
                };
            }
        }
        return null;
    }

    const maxHeightU = state.racks.length > 0 ? Math.max(...state.racks.map(r => r.heightU || 42)) : 42;
    for (let i = 0; i < state.racks.length; i++) {
        const rackData = state.racks[i];
        const rackXStart = i * (constants.WORLD_WIDTH + constants.RACK_SPACING);
        const rackXEnd = rackXStart + constants.WORLD_WIDTH;

        const yOffset = (maxHeightU - rackData.heightU) * constants.BASE_UNIT_HEIGHT;
        const rackYStart = yOffset;
        const rackYEnd = rackYStart + (rackData.heightU * constants.BASE_UNIT_HEIGHT);

        if (worldPos.x >= rackXStart && worldPos.x < rackXEnd &&
            worldPos.y >= rackYStart && worldPos.y < rackYEnd) {
            return {
                rackIndex: i,
                rackData: rackData,
                localX: worldPos.x - rackXStart,
                localY: worldPos.y - yOffset
            };
        }
    }
    return null;
}

export function findCurrentParentOf(shelfItem) {
    for (const rack of state.racks) {
        const parent = rack.equipment.find(p => p.shelfItems && p.shelfItems.includes(shelfItem));
        if (parent) return parent;
    }
    return null;
}

export function getMouseWorldPos(e) {
    return {
        x: (e.offsetX - state.viewOffset.x) / state.scale,
        y: (e.offsetY - state.viewOffset.y) / state.scale
    };
}

export function getColorByType(type) {
    return constants.COLORS[type] || '#cccccc';
}

export function findValidShelfParent(localY, droppedItem, equipment, localX) {
    const railLeft = constants.BASE_UNIT_HEIGHT * 1.25;
    const eqPadding = constants.BASE_UNIT_HEIGHT * 0.2;
    const eqLeft = railLeft - eqPadding;
    const eqRight = eqLeft + (constants.WORLD_WIDTH - 2 * railLeft) + (2 * eqPadding);

    for (const parent of [...equipment].reverse()) {
        if (parent.type === 'v-pdu' || parent.type === 'monitor') continue;
        const parentTopY = parent.y * constants.BASE_UNIT_HEIGHT;
        const parentBottomY = parentTopY + parent.u * constants.BASE_UNIT_HEIGHT;
        if (localX >= eqLeft && localX <= eqRight && localY >= parentTopY && localY < parentBottomY) {
            // Calculate a horizontal position for the shelf item relative to the shelf's available width
            // This centers the item if dragged to center, or allows off-center placement
            const newX = localX - eqLeft - (droppedItem.size.width * constants.SHELF_ITEM_RENDER_SCALE / 2);
            // Clamp newX to be within the shelf bounds (considering shelf item's width)
            const clampedX = Math.max(0, Math.min(eqRight - eqLeft - (droppedItem.size.width * constants.SHELF_ITEM_RENDER_SCALE), newX)); // Corrected eqWidth to eqRight - eqLeft
            return { newParent: parent, newX: clampedX };
        }
    }
    return { newParent: null, newX: 0 };
}

/**
 * Checks if a V-PDU item is under the given mouse local coordinates.
 * @param {object} pduItem The V-PDU item data.
 * @param {number} localX Mouse X coordinate relative to rack's top-left (0,0).
 * @param {number} localY Mouse Y coordinate relative to rack's top-left (0,0).
 * @param {number} rackHeightU Height of the current rack in U units.
 * @returns {boolean} True if the V-PDU is under the mouse, false otherwise.
 */
export function isVpduUnderMouse(pduItem, localX, localY, rackHeightU) {
    const railLeft = constants.BASE_UNIT_HEIGHT * 1.25;
    const pduRectWidth = constants.BASE_UNIT_HEIGHT * 0.75;
    const pduRectX = pduItem.side === 'left' ? railLeft : constants.WORLD_WIDTH - railLeft - pduRectWidth;
    const pduRectHeight = rackHeightU * constants.BASE_UNIT_HEIGHT;
    return (
        localX >= pduRectX && localX < pduRectX + pduRectWidth &&
        localY >= 0 && localY < pduRectHeight
    );
}

/**
 * Checks if a standard equipment item (not V-PDU or shelf item) is under the given mouse local coordinates.
 * @param {object} item The standard equipment item data.
 * @param {number} localX Mouse X coordinate relative to rack's top-left (0,0).
 * @param {number} localY Mouse Y coordinate relative to rack's top-left (0,0).
 * @returns {boolean} True if the item is under the mouse, false otherwise.
 */
export function isStandardItemUnderMouse(item, localX, localY) {
    const topY = item.y * constants.BASE_UNIT_HEIGHT;
    const bottomY = topY + item.u * constants.BASE_UNIT_HEIGHT;
    const eqLeft = constants.BASE_UNIT_HEIGHT * 1.25 - constants.BASE_UNIT_HEIGHT * 0.2;
    const eqRight = eqLeft + (constants.WORLD_WIDTH - (constants.BASE_UNIT_HEIGHT * 1.25 * 2) + (constants.BASE_UNIT_HEIGHT * 0.2 * 2));
    return (
        localY >= topY && localY < bottomY &&
        localX >= eqLeft && localX < eqRight
    );
}

/**
 * Finds an available Y position for a new item of given U-height,
 * searching outwards from an initial preferred Y, within rack bounds.
 * @param {number} newU The U-height of the item to place.
 * @param {number} initialY The preferred starting Y (U-unit) position.
 * @param {Array<object>} existingEquipment List of existing items to check for overlaps.
 * @param {number} rackHeightU Total height of the rack in U units.
 * @returns {number} The found Y position, or -1 if no space is available.
 */
export function findAvailableY(newU, initialY, existingEquipment, rackHeightU) {
    const isOverlapping = (y, u, items) => {
        return items.some(it => y < it.y + it.u && y + u > it.y);
    };

    // Calculate maximum possible offset to search through all potential positions
    // This ensures we check every possible Y position within the rack.
    const maxOffset = Math.max(initialY, rackHeightU - newU - initialY);

    for (let i = 0; i <= maxOffset; i++) {
        // Check initialY + i (downwards)
        let candidateYDown = initialY + i;
        if (candidateYDown + newU <= rackHeightU) { // Check if fits within rack bottom boundary
            if (!isOverlapping(candidateYDown, newU, existingEquipment)) {
                return candidateYDown;
            }
        }

        // Check initialY - i (upwards) - only if i > 0 to avoid duplicate check for initialY
        if (i > 0) {
            let candidateYUp = initialY - i;
            if (candidateYUp >= 0) { // Check if fits within rack top boundary
                if (!isOverlapping(candidateYUp, newU, existingEquipment)) {
                    return candidateYUp;
                }
            }
        }
    }

    return -1; // No available space found
}


/**
 * Checks if the current layout in state is considered effectively empty.
 * An empty layout is either:
 * - No racks at all (state.racks is [])
 * - Exactly one rack, and that rack has no equipment.
 * @returns {boolean} True if the layout is empty, false otherwise.
 */
export function isLayoutEffectivelyEmpty() {
    if (state.racks.length === 0) {
        return true;
    }
    // If there's only one rack, check if it's empty
    if (state.racks.length === 1 && state.racks[0].equipment.length === 0) {
        return true;
    }
    return false;
}

/**
 * Performs a deep comparison of two layout objects (arrays of racks),
 * ignoring transient UI properties and dynamically generated IDs.
 * @param {Array<object>} layoutA
 * @param {Array<object>} layoutB
 * @returns {boolean} True if layouts are identical in their persistent data, false otherwise.
 */
function deepCompareLayouts(layoutA, layoutB) {
    if (layoutA === layoutB) return true;
    if (!layoutA || !layoutB) return false;
    if (layoutA.length !== layoutB.length) return false;

    // Helper to strip transient/dynamic properties from an object (rack or equipment item)
    const stripTransientProperties = (obj) => {
        const newObj = { ...obj };
        // Properties specific to rack data
        delete newObj.id; // Rack ID is dynamic
        delete newObj.deleteBtnBounds; // UI specific
        delete newObj.nameBounds;     // UI specific
        // Properties specific to equipment items (including shelf items)
        delete newObj.tempX; // Temporary drag position
        delete newObj.tempY; // Temporary drag position
        delete newObj.dragOffsetX_pixels; // Temporary drag offset
        delete newObj.dragOffsetY_pixels; // Temporary drag offset
        delete newObj.__renderCtx; // Renderer specific internal property
        return newObj;
    };

    // Helper to compare arrays of items (equipment or shelfItems), handling recursion for shelfItems
    const compareItemArrays = (arr1, arr2) => {
        if (!arr1 && !arr2) return true; // Both null/undefined, consider equal
        if (!arr1 || !arr2) return false; // One is null/undefined, other is not
        if (arr1.length !== arr2.length) return false;

        // Sort items for stable comparison, primarily by y/x position then by label
        const sortedArr1 = [...arr1].sort((a, b) =>
            (a.y || a.x || 0) - (b.y || b.x || 0) || a.label.localeCompare(b.label)
        );
        const sortedArr2 = [...arr2].sort((a, b) =>
            (a.y || a.x || 0) - (b.y || b.x || 0) || a.label.localeCompare(b.label)
        );

        for (let i = 0; i < sortedArr1.length; i++) {
            const itemA = stripTransientProperties(sortedArr1[i]);
            const itemB = stripTransientProperties(sortedArr2[i]);

            // Recursively compare shelfItems if they exist
            const shelfItemsA = itemA.shelfItems;
            const shelfItemsB = itemB.shelfItems;
            delete itemA.shelfItems; // Remove from comparison payload
            delete itemB.shelfItems; // Remove from comparison payload

            if (!compareItemArrays(shelfItemsA, shelfItemsB)) {
                return false;
            }

            // Now compare the rest of the item properties using JSON.stringify
            if (JSON.stringify(itemA) !== JSON.stringify(itemB)) {
                return false;
            }
        }
        return true;
    };

    // Compare each rack in the main layout array
    for (let i = 0; i < layoutA.length; i++) {
        const rackA = stripTransientProperties(layoutA[i]);
        const rackB = stripTransientProperties(layoutB[i]);

        // Compare equipment arrays for each rack separately
        const equipmentA = layoutA[i].equipment;
        const equipmentB = layoutB[i].equipment;

        if (!compareItemArrays(equipmentA, equipmentB)) {
            return false;
        }

        // Compare remaining rack properties (e.g., name, heightU)
        if (JSON.stringify(rackA) !== JSON.stringify(rackB)) {
            return false;
        }
    }

    return true;
}

/**
 * Checks if there are any unsaved changes to the current layout.
 * Compares current state.racks with state.savedLayoutContent.
 * @returns {boolean} True if current layout differs from saved layout, false otherwise.
 */
export function hasUnsavedChanges() {
    return !deepCompareLayouts(state.racks, state.savedLayoutContent);
}