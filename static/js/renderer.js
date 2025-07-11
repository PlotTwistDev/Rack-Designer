/**
 * @file Contains the drawing helper logic for rendering a single rack.
 * This module is called by the main drawRack function in canvas.js.
 */

import * as constants from './constants.js';
import * as state from './state.js';
import { getColorByType } from './utils.js';

/**
 * Helper function to find the intersection of a line segment with a rectangle.
 * Returns the intersection point closest to p1 (start of the segment) that lies on the segment,
 * or null if no intersection.
 * @param {{x: number, y: number}} p1 Start point of the line segment.
 * @param {{x: number, y: number}} p2 End point of the line segment.
 * @param {{x: number, y: number, w: number, h: number}} rect The rectangle.
 * @returns {{x: number, y: number}|null} The intersection point, or null.
 */
function findLineRectIntersection(p1, p2, rect) {
    const intersections = [];

    const lines = [
        [{ x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y }], // Top
        [{ x: rect.x + rect.w, y: rect.y }, { x: rect.x + rect.w, y: rect.y + rect.h }], // Right
        [{ x: rect.x + rect.w, y: rect.y + rect.h }, { x: rect.x, y: rect.y + rect.h }], // Bottom
        [{ x: rect.x, y: rect.y + rect.h }, { x: rect.x, y: rect.y }]  // Left
    ];

    for (const [q1, q2] of lines) {
        const intersection = getLineSegmentIntersection(p1, p2, q1, q2);
        if (intersection) {
            intersections.push(intersection);
        }
    }

    if (intersections.length === 0) return null;
    if (intersections.length === 1) return intersections[0];

    // Find the intersection closest to p1
    intersections.sort((a, b) => {
        const distA = Math.sqrt(Math.pow(a.x - p1.x, 2) + Math.pow(a.y - p1.y, 2));
        const distB = Math.sqrt(Math.pow(b.x - p1.x, 2) + Math.pow(b.y - p1.y, 2));
        return distA - distB;
    });

    return intersections[0];
}

/**
 * Helper for line-line segment intersection.
 * @param {{x: number, y: number}} p1 Segment 1 start.
 * @param {{x: number, y: number}} p2 Segment 1 end.
 * @param {{x: number, y: number}} q1 Segment 2 start.
 * @param {{x: number, y: number}} q2 Segment 2 end.
 * @returns {{x: number, y: number}|null} Intersection point or null.
 */
function getLineSegmentIntersection(p1, p2, q1, q2) {
    const o1 = orientation(p1, p2, q1);
    const o2 = orientation(p1, p2, q2);
    const o3 = orientation(q1, q2, p1);
    const o4 = orientation(q1, q2, p2);

    // General case
    if (o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4) {
        const det = (p1.x - p2.x) * (q1.y - q2.y) - (p1.y - p2.y) * (q1.x - q2.x);
        if (det === 0) return null; // Parallel or collinear

        const t = ((p1.x - q1.x) * (q1.y - q2.y) - (p1.y - q1.y) * (q1.x - q2.x)) / det;
        const u = -((p1.x - p2.x) * (p1.y - q1.y) - (p1.y - p2.y) * (p1.x - q1.x)) / det;

        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
            return {
                x: p1.x + t * (p2.x - p1.x),
                y: p1.y + t * (p2.y - p1.y)
            };
        }
    }

    // Special cases (collinear segments)
    if (o1 === 0 && onSegment(p1, q1, p2)) return q1;
    if (o2 === 0 && onSegment(p1, q2, p2)) return q2;
    if (o3 === 0 && onSegment(q1, p1, q2)) return p1;
    if (o4 === 0 && onSegment(q1, p2, q2)) return p2;

    return null; // No intersection
}

/**
 * To find orientation of ordered triplet (p, q, r).
 * @returns {number} 0 --> collinear, 1 --> Clockwise, 2 --> Counterclockwise.
 */
function orientation(p, q, r) {
    const val = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
    if (val === 0) return 0;
    return (val > 0) ? 1 : 2;
}

/**
 * Given three collinear points p, q, r, checks if point q lies on segment 'pr'.
 * @returns {boolean} True if q is on segment pr, false otherwise.
 */
function onSegment(p, q, r) {
    return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) &&
        q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
}

/**
 * Calculates the bounding box and line coordinates for a note.
 * This function does NOT draw anything, it just provides the metrics.
 * @param {object} item The equipment item containing the notes.
 * @param {object} itemRect The bounding box of the item {x, y, w, h} in world coordinates.
 * @param {{x: number, y: number}} effectiveNoteOffset The offset {x, y} from the item's side to the note box's center.
 * @param {number} fontSize The font size to use for text width calculations.
 * @param {number} currentRenderScale The current canvas render scale.
 * @param {boolean} [calculateOnly=false] If true, skips some ctx setup for lighter calculation (e.g., for hit testing).
 * @returns {object} An object containing noteBox {x,y,w,h} and line coordinates, text alignment details.
 */
export function getNoteDrawingMetrics(item, itemRect, effectiveNoteOffset, fontSize, currentRenderScale, calculateOnly = false) {
    const notes = item.notes || '';
    const lines = notes.split('\n').filter(l => l.trim() !== '');

    if (lines.length === 0) {
        return { noteBox: null, lineCoords: null, textAlignment: 'left', textXOffset: 0, padding: 0 };
    }

    let tempCtx;
    if (!calculateOnly && item.__renderCtx) {
        tempCtx = item.__renderCtx;
    } else {
        tempCtx = document.createElement('canvas').getContext('2d');
    }

    tempCtx.font = `${fontSize}px Inter, sans-serif`;

    let maxWidth = 0;
    lines.forEach(line => {
        maxWidth = Math.max(maxWidth, tempCtx.measureText(line).width);
    });

    const padding = fontSize * 0.5;
    const lineHeight = fontSize * 1.2;
    const boxWidth = maxWidth + padding * 2;
    const boxHeight = (lines.length * lineHeight) - (0.2 * fontSize) + padding * 2;

    // --- Note Box Position Calculation ---
    // This part remains the same, as it's what the drag logic is based on.
    const itemRightX = itemRect.x + itemRect.w;
    const itemCenterY = itemRect.y + itemRect.h / 2;
    const noteBoxX = itemRightX + effectiveNoteOffset.x;
    const noteBoxY = itemCenterY + effectiveNoteOffset.y - boxHeight / 2;
    const noteBox = { x: noteBoxX, y: noteBoxY, w: boxWidth, h: boxHeight };

    // --- NEW DYNAMIC LINE CONNECTION LOGIC ---
    const itemCenterX = itemRect.x + itemRect.w / 2;
    const noteBoxCenterY = noteBox.y + noteBox.h / 2;

    let lineStartPoint, lineEndPoint, textAlignment, textXOffset;

    // Decide which side of the ITEM to connect to based on note's position
    if (noteBox.x + noteBox.w / 2 < itemCenterX) {
        // Note is to the LEFT of the item
        lineStartPoint = { x: itemRect.x, y: itemCenterY }; // Connect to item's left side
        lineEndPoint = { x: noteBox.x + noteBox.w, y: noteBoxCenterY }; // Connect to note's right side
        textAlignment = 'right';
        textXOffset = noteBox.w - padding; // Align text to the right
    } else {
        // Note is to the RIGHT of the item
        lineStartPoint = { x: itemRect.x + itemRect.w, y: itemCenterY }; // Connect to item's right side
        lineEndPoint = { x: noteBox.x, y: noteBoxCenterY }; // Connect to note's left side
        textAlignment = 'left';
        textXOffset = padding; // Align text to the left (default)
    }

    const lineCoords = {
        fromX: lineStartPoint.x,
        fromY: lineStartPoint.y,
        toX: lineEndPoint.x,
        toY: lineEndPoint.y
    };

    return { noteBox, lineCoords, textAlignment, fontSize, lineHeight, padding, textXOffset };
}

/**
 * Draws a single rack and its contents onto the canvas context.
 * This is a helper function and is not exported as the main draw function.
 * @param {CanvasRenderingContext2D} ctx The canvas context to draw on.
 * @param {object} rackData The data object for the rack to be drawn.
 * @param {number} xOffset The horizontal offset for drawing the rack (used in multi-rack view).
 * @param {boolean} [isExportMode=false] If true, rendering for export (adjusts highlights).
 * @param {number} [currentRenderScale=state.scale] The scale factor for adjusting line widths, etc.
 * @param {boolean} [forPdfExport=false] If true, notes are NOT drawn as part of the canvas content.
 */
export function drawSingleRack(ctx, rackData, xOffset, isExportMode = false, currentRenderScale = state.scale, forPdfExport = false) {
    const rack = rackData.equipment;
    const rackHeightU = rackData.heightU;
    const worldHeight = constants.BASE_UNIT_HEIGHT * rackHeightU;

    // Get current theme colors from CSS custom properties for dynamic styling.
    const currentStyles = getComputedStyle(document.documentElement);
    const selectionHighlightColor = currentStyles.getPropertyValue('--selection-highlight').trim();
    const noteSelectionHighlightColor = currentStyles.getPropertyValue('--note-selection-highlight').trim(); // NEW
    const rackRailColor = currentStyles.getPropertyValue('--rack-rail-color').trim();
    const rackInnerColor = currentStyles.getPropertyValue('--rack-inner-color').trim();
    const rackTextColor = currentStyles.getPropertyValue('--rack-text-color').trim();
    const rackLineColor = currentStyles.getPropertyValue('--rack-line-color').trim();
    const rackHoleColor = currentStyles.getPropertyValue('--rack-hole-color').trim();
    const accentColor = currentStyles.getPropertyValue('--accent-color').trim(); // NEW: For note highlight
    ctx.save();

    /**
     * Draws the notes/comments for a given piece of equipment.
     * @param {object} item The equipment item containing the notes.
     * @param {object} itemRect The bounding box of the item {x, y, w, h} in world coordinates.
     * @param {boolean} forPdfExport If true, notes are NOT drawn.
     * @param {number} currentRenderScale The current canvas render scale.
     * @returns {object|null} The bounding box of the drawn note, or null if not drawn.
     */
    const drawNotesFor = (item, itemRect, forPdfExport, currentRenderScale) => {
        // If notes are globally hidden, don't draw them.
        if (!state.isShowingNotes) {
            return null;
        }

        if (state.isMultiRackView && !isExportMode) {
            return null;
        }

        const notes = item.notes || '';
        if (forPdfExport || notes.trim() === '') return null;

        const originalAlpha = ctx.globalAlpha;
        item.__renderCtx = ctx;

        let effectiveNoteOffset = item.noteOffset || { x: constants.DEFAULT_NOTE_OFFSET_X, y: constants.DEFAULT_NOTE_OFFSET_Y };
        const isCurrentNoteBeingDragged = state.isDraggingNote && state.draggedNoteItemInfo && state.draggedNoteItemInfo.item === item;

        if (isCurrentNoteBeingDragged) {
            ctx.globalAlpha = 0.5;
        }

        const noteFontSize = Math.max(9, Math.min(16, constants.BASE_UNIT_HEIGHT * 0.35));
        const metrics = getNoteDrawingMetrics(item, itemRect, effectiveNoteOffset, noteFontSize, currentRenderScale, false);
        if (!metrics.noteBox) return null;

        const { noteBox, lineCoords, textAlignment, lineHeight, padding, textXOffset } = metrics;
        const lines = notes.split('\n').filter(l => l.trim() !== '');

        // Draw the connector line
        ctx.beginPath();
        ctx.moveTo(lineCoords.fromX, lineCoords.fromY);
        ctx.lineTo(lineCoords.toX, lineCoords.toY);
        ctx.strokeStyle = rackTextColor;
        ctx.setLineDash([2, 3]);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw the note box
        const isEquipmentSelected = state.selectedItems.some(sel => sel.item === item); // Check if the note's parent item is selected
        const isNoteSelected = state.selectedNotes.some(sel => sel.noteOwner === item); // NEW: Check if the note itself is selected

        ctx.fillStyle = rackInnerColor;
        ctx.fillRect(noteBox.x, noteBox.y, noteBox.w, noteBox.h);
        ctx.strokeStyle = isNoteSelected ? noteSelectionHighlightColor : (isEquipmentSelected ? accentColor : rackTextColor);
        ctx.lineWidth = isNoteSelected ? 2.5 : (isEquipmentSelected ? 2 : 1);
        ctx.strokeRect(noteBox.x, noteBox.y, noteBox.w, noteBox.h);
        // Reset stroke style for subsequent drawing
        ctx.strokeStyle = rackTextColor;
        ctx.lineWidth = 1;

        // Draw the note text
        ctx.fillStyle = rackTextColor;
        ctx.font = `${noteFontSize}px Inter, sans-serif`;
        ctx.textBaseline = 'top';
        ctx.textAlign = textAlignment;
        lines.forEach((line, index) => {
            const textY = noteBox.y + padding + (index * lineHeight);
            ctx.fillText(line, noteBox.x + textXOffset, textY);
        });

        // Draw the ghost note if dragging
        if (isCurrentNoteBeingDragged && state.draggedNoteItemInfo.tempNoteOffset) {
            ctx.globalAlpha = 0.75;
            const ghostMetrics = getNoteDrawingMetrics(item, itemRect, state.draggedNoteItemInfo.tempNoteOffset, noteFontSize, currentRenderScale, false);
            if (ghostMetrics.noteBox) {
                const { noteBox: ghostNoteBox, lineCoords: ghostLineCoords, textAlignment: ghostTextAlignment, textXOffset: ghostTextXOffset } = ghostMetrics;
                ctx.beginPath();
                ctx.moveTo(ghostLineCoords.fromX, ghostLineCoords.fromY);
                ctx.lineTo(ghostLineCoords.toX, ghostLineCoords.toY);
                ctx.stroke();
                ctx.fillStyle = rackInnerColor;
                ctx.fillRect(ghostNoteBox.x, ghostNoteBox.y, ghostNoteBox.w, ghostNoteBox.h);
                ctx.strokeRect(ghostNoteBox.x, ghostNoteBox.y, ghostNoteBox.w, ghostNoteBox.h);
                ctx.fillStyle = rackTextColor;
                ctx.textAlign = ghostTextAlignment;
                lines.forEach((line, index) => {
                    const textY = ghostNoteBox.y + padding + (index * lineHeight);
                    ctx.fillText(line, ghostNoteBox.x + ghostTextXOffset, textY);
                });
            }
        }

        ctx.globalAlpha = originalAlpha;
        return noteBox;
    };

    const railLeft = xOffset + constants.BASE_UNIT_HEIGHT * 1.25;
    const railRight = railLeft + (constants.WORLD_WIDTH - (constants.BASE_UNIT_HEIGHT * 1.25 * 2));
    const itemLabelFontSize = Math.max(9, Math.min(16, constants.BASE_UNIT_HEIGHT * 0.35));
    const eqPadding = constants.BASE_UNIT_HEIGHT * 0.2;
    const eqLeft = railLeft - eqPadding;
    const eqWidth = railRight - railLeft + (eqPadding * 2);

    const vpdus = rack.filter(it => it.type === 'v-pdu');
    const standardItems = rack.filter(it => it.type !== 'v-pdu');
    const getPduWorldRect = (pdu) => { const drawWidth = constants.BASE_UNIT_HEIGHT * 0.75; const pduX = (pdu.side === 'left') ? railLeft : (railRight - drawWidth); return { x: pduX, y: 0, w: drawWidth, h: worldHeight }; };

    const drawRackBackPanel = () => {
        ctx.fillStyle = rackInnerColor;
        ctx.fillRect(railLeft, 0, railRight - railLeft, worldHeight);
        ctx.strokeStyle = rackLineColor;
        ctx.lineWidth = 1;
        ctx.stroke();
    };
    const drawRackFrontRails = () => {
        ctx.fillStyle = rackRailColor;
        ctx.fillRect(xOffset, 0, railLeft - xOffset, worldHeight);
        ctx.fillRect(railRight, 0, (xOffset + constants.WORLD_WIDTH) - railRight, worldHeight);
        const sideLabelFontSize = Math.max(8, Math.min(12, constants.BASE_UNIT_HEIGHT * 0.22));
        // NEW: Define a consistent padding for the numbers inside the rails.
        const railPadding = (railLeft - xOffset) * 0.1;
        ctx.textBaseline = 'middle';
        for (let i = 0; i < rackHeightU; i++) {
            const y = worldHeight - (i + 1) * constants.BASE_UNIT_HEIGHT;
            const yCenter = y + constants.BASE_UNIT_HEIGHT / 2;
            const uLabel = `${i + 1}U`;

            ctx.fillStyle = rackTextColor;
            ctx.font = `${sideLabelFontSize}px sans-serif`;
            // Draw on the Left Rail
            ctx.textAlign = 'left';
            ctx.fillText(uLabel, xOffset + railPadding, yCenter);
            // Draw on the Right Rail
            ctx.textAlign = 'right';
            ctx.fillText(uLabel, (xOffset + constants.WORLD_WIDTH) - railPadding, yCenter);
            const holeRadius = Math.max(1, constants.BASE_UNIT_HEIGHT * 0.05);
            const holeSpacing = constants.BASE_UNIT_HEIGHT / 3;
            const initialOffset = constants.BASE_UNIT_HEIGHT / 6;
            ctx.fillStyle = rackHoleColor;
            for (let h = 0; h < 3; h++) {
                const holeY = y + initialOffset + h * holeSpacing;
                ctx.beginPath();
                ctx.arc(railLeft - constants.BASE_UNIT_HEIGHT * 0.15, holeY, holeRadius, 0, 2 * Math.PI);
                ctx.arc(railRight + constants.BASE_UNIT_HEIGHT * 0.15, holeY, holeRadius, 0, 2 * Math.PI);
                ctx.fill();
            }
        }
    };
    const drawStandardAndShelfItems = () => {
        standardItems.forEach(item => {
            const isSelected = state.selectedItems.some(sel => sel.item === item);
            if (!isExportMode && state.isDraggingSelection && isSelected) return;
            const y = item.y * constants.BASE_UNIT_HEIGHT;
            const itemHeight = item.u * constants.BASE_UNIT_HEIGHT;
            const currentStencilCache = state.isShowingRear ? state.stencilRearCache : state.stencilCache;
            const stencilKey = state.isShowingRear ? (item.stencilRear || `${item.stencil}-rear` || 'generic-equipment-rear') : (item.stencil || 'generic-equipment');
            let stencilImage = currentStencilCache.get(stencilKey);
            if (stencilImage && stencilImage.complete) { ctx.drawImage(stencilImage, eqLeft, y, eqWidth, itemHeight); } else { ctx.fillStyle = getColorByType(item.type); ctx.fillRect(eqLeft, y, eqWidth, itemHeight); }
            if (!isExportMode && isSelected) { ctx.fillStyle = selectionHighlightColor; ctx.fillRect(eqLeft, y, eqWidth, itemHeight); }
            if (!state.isShowingRear && item.type !== 'shelf' && !item.side) {
                const textX = eqLeft + eqWidth / 2;
                const textY = y + itemHeight / 2;
                ctx.font = `bold ${itemLabelFontSize}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
                ctx.lineWidth = 4;
                ctx.lineJoin = 'round';
                ctx.strokeText(item.label, textX, textY);
                ctx.fillStyle = 'white';
                ctx.fillText(item.label, textX, textY);
            }
            drawNotesFor(item, { x: eqLeft, y, w: eqWidth, h: itemHeight }, forPdfExport, currentRenderScale);
            if (item.shelfItems) {
                item.shelfItems.forEach(shelfItem => {
                    const shelfIsSelected = state.selectedItems.some(sel => sel.item === shelfItem);
                    if (!isExportMode && state.isDraggingSelection && shelfIsSelected) return;
                    const shelfStencilKey = state.isShowingRear ? (shelfItem.stencilRear || `${shelfItem.stencil}-rear` || 'generic-shelf-item-rear') : (shelfItem.stencil || 'generic-shelf-item');
                    const shelfStencil = currentStencilCache.get(shelfStencilKey);
                    const drawW = shelfItem.size.width * constants.SHELF_ITEM_RENDER_SCALE;
                    const drawH = shelfItem.size.height * constants.SHELF_ITEM_RENDER_SCALE;
                    const drawX = eqLeft + shelfItem.x;
                    const drawY = y - drawH;
                    if (shelfStencil && shelfStencil.complete) { ctx.drawImage(shelfStencil, drawX, drawY, drawW, drawH); } else { ctx.fillStyle = getColorByType(shelfItem.type); ctx.fillRect(drawX, drawY, drawW, drawH); }
                    if (!isExportMode && shelfIsSelected) { ctx.fillStyle = selectionHighlightColor; ctx.fillRect(drawX, drawY, drawW, drawH); }
                    drawNotesFor(shelfItem, { x: drawX, y: drawY, w: drawW, h: drawH }, forPdfExport, currentRenderScale);
                });
            }
        });
    };
    const drawVPDUs = () => {
        vpdus.forEach(pdu => {
            if (!isExportMode && state.isDraggingSelection && state.selectedItems.some(sel => sel.item === pdu)) return;
            const rect = getPduWorldRect(pdu);
            ctx.fillStyle = '#333';
            ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
            ctx.strokeStyle = '#444';
            ctx.lineWidth = 1;
            ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
            if (!isExportMode && state.selectedItems.some(sel => sel.item === pdu)) { ctx.fillStyle = selectionHighlightColor; ctx.fillRect(rect.x, rect.y, rect.w, rect.h); }
        });
    };

    drawRackBackPanel();
    if (state.isShowingRear) {
        drawStandardAndShelfItems();
        drawVPDUs();
        drawRackFrontRails();
    } else {
        drawVPDUs();
        drawRackFrontRails();
        drawStandardAndShelfItems();
    }
    ctx.restore();
}