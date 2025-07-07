// --- START OF FILE renderer.js ---

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
 * @param {number} actualRackXOffset The x-offset of the rack itself in world coordinates.
 * @param {{x: number, y: number}} effectiveNoteOffset The offset {x, y} from the item's center to the note box's center.
 * @param {number} fontSize The font size to use for text width calculations.
 * @param {number} currentRenderScale The current canvas render scale.
 * @param {boolean} [calculateOnly=false] If true, skips some ctx setup for lighter calculation (e.g., for hit testing).
 * @returns {object} An object containing noteBox {x,y,w,h} and line coordinates, text alignment details.
 */
export function getNoteDrawingMetrics(item, itemRect, actualRackXOffset, effectiveNoteOffset, fontSize, currentRenderScale, calculateOnly = false) {
    const notes = item.notes || '';
    const lines = notes.split('\n').filter(l => l.trim() !== '');

    if (lines.length === 0) {
        return { noteBox: null, lineCoords: null, textAlignment: 'left', textXOffset: 0, padding: 0 };
    }

    // Use a temporary context for accurate text measurement if not already provided
    let tempCtx;
    if (!calculateOnly && item.__renderCtx) { // Use actual context if available and not in calculateOnly mode
        tempCtx = item.__renderCtx;
    } else { // Fallback to a new context for calculation or if not provided
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

    // Calculate note box position based on item center and effectiveNoteOffset
    const itemCenterX = itemRect.x + itemRect.w / 2;
    const itemCenterY = itemRect.y + itemRect.h / 2;

    // Note box (top-left) position relative to rack's world (0,0)
    const noteBoxX = actualRackXOffset + itemCenterX + effectiveNoteOffset.x - boxWidth / 2;
    const noteBoxY = itemCenterY + effectiveNoteOffset.y - boxHeight / 2;

    const noteBox = { x: noteBoxX, y: noteBoxY, w: boxWidth, h: boxHeight };

    // --- Calculate line connection points ---
    // Start of line: Item's center point
    const lineStartItemPoint = { x: actualRackXOffset + itemCenterX, y: itemCenterY };
    // End of line: Note box's center point
    const lineEndNotePoint = { x: noteBoxX + boxWidth / 2, y: noteBoxY + boxHeight / 2 };

    // Find where the line from the item's center to the note's center intersects the item's bounding box
    const intersectionOnItem = findLineRectIntersection(lineStartItemPoint, lineEndNotePoint, {
        x: actualRackXOffset + itemRect.x,
        y: itemRect.y,
        w: itemRect.w,
        h: itemRect.h
    });

    // Find where the line from the note's center to the item's center intersects the note box's bounding box
    const intersectionOnNoteBox = findLineRectIntersection(lineEndNotePoint, lineStartItemPoint, noteBox);

    const lineCoords = {
        fromX: intersectionOnItem ? intersectionOnItem.x : lineStartItemPoint.x, // Use intersection point if found
        fromY: intersectionOnItem ? intersectionOnItem.y : lineStartItemPoint.y,
        toX: intersectionOnNoteBox ? intersectionOnNoteBox.x : lineEndNotePoint.x, // Use intersection point if found
        toY: intersectionOnNoteBox ? intersectionOnNoteBox.y : lineEndNotePoint.y
    };
    // --- End line connection calculation ---

    const textAlignment = 'left'; // Always left align text within the note box
    const textXOffset = padding; // Consistent text padding from left edge for left alignment


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
    const rackRailColor = currentStyles.getPropertyValue('--rack-rail-color').trim();
    const rackInnerColor = currentStyles.getPropertyValue('--rack-inner-color').trim();
    const rackTextColor = currentStyles.getPropertyValue('--rack-text-color').trim();
    const rackLineColor = currentStyles.getPropertyValue('--rack-line-color').trim();
    const rackHoleColor = currentStyles.getPropertyValue('--rack-hole-color').trim();
    ctx.save();

    /**
     * Draws the notes/comments for a given piece of equipment.
     * @param {object} item The equipment item containing the notes.
     * @param {object} itemRect The bounding box of the item {x, y, w, h} in world coordinates.
     * @param {number} actualRackXOffset The x-offset of the rack itself in world coordinates.
     * @param {boolean} forPdfExport If true, notes are NOT drawn.
     * @param {number} currentRenderScale The current canvas render scale.
     * @returns {object|null} The bounding box of the drawn note, or null if not drawn.
     */
    const drawNotesFor = (item, itemRect, actualRackXOffset, forPdfExport, currentRenderScale) => {
        // Skip drawing notes if for PDF export, or in multi-rack view interactive mode, or no notes
        const notes = item.notes || '';
        if (forPdfExport || notes.trim() === '' || state.isMultiRackView) return null;

        const originalAlpha = ctx.globalAlpha;

        // Store current context for text measurement in getNoteDrawingMetrics
        item.__renderCtx = ctx;

        // Determine effective note offset for drawing (either actual or temp for ghosting)
        let effectiveNoteOffset = item.noteOffset || { x: constants.DEFAULT_NOTE_OFFSET_X, y: constants.DEFAULT_NOTE_OFFSET_Y };

        // Determine if this specific note is being dragged
        const isCurrentNoteBeingDragged = state.isDraggingNote && state.draggedNoteItemInfo && state.draggedNoteItemInfo.item === item;

        if (isCurrentNoteBeingDragged) {
            // When dragging, draw the original note (item.noteOffset) semi-transparently
            ctx.globalAlpha = 0.5;
        }

        const noteFontSize = Math.max(9, Math.min(16, constants.BASE_UNIT_HEIGHT * 0.35)); // Smaller font for notes to fit more
        const metrics = getNoteDrawingMetrics(item, itemRect, actualRackXOffset, effectiveNoteOffset, noteFontSize, currentRenderScale, false);
        if (!metrics.noteBox) return null; // No notes to draw

        const { noteBox, lineCoords, textAlignment, lineHeight, padding, textXOffset } = metrics;
        const lines = notes.split('\n').filter(l => l.trim() !== '');

        // Draw the actual note (potentially semi-transparent)
        ctx.beginPath();
        ctx.moveTo(lineCoords.fromX, lineCoords.fromY);
        ctx.lineTo(lineCoords.toX, lineCoords.toY);
        ctx.strokeStyle = rackTextColor;
        ctx.setLineDash([2, 3]); // Reverted: No scaling by currentRenderScale
        ctx.lineWidth = 1; // Reverted: No scaling by currentRenderScale
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = rackInnerColor;
        ctx.fillRect(noteBox.x, noteBox.y, noteBox.w, noteBox.h);
        ctx.strokeRect(noteBox.x, noteBox.y, noteBox.w, noteBox.h);

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
            ctx.globalAlpha = 0.75; // Ghost alpha
            const ghostMetrics = getNoteDrawingMetrics(item, itemRect, actualRackXOffset, state.draggedNoteItemInfo.tempNoteOffset, noteFontSize, currentRenderScale, false);
            if (!ghostMetrics.noteBox) {
                ctx.globalAlpha = originalAlpha; // Reset alpha
                return noteBox; // Return original note box if ghost couldn't be drawn
            }
            const { noteBox: ghostNoteBox, lineCoords: ghostLineCoords, textAlignment: ghostTextAlignment, textXOffset: ghostTextXOffset } = ghostMetrics;

            // Draw ghost line
            ctx.beginPath();
            ctx.moveTo(ghostLineCoords.fromX, ghostLineCoords.fromY);
            ctx.lineTo(ghostLineCoords.toX, ghostLineCoords.toY);
            ctx.strokeStyle = rackTextColor;
            ctx.setLineDash([2, 3]); // Reverted: No scaling by currentRenderScale
            ctx.lineWidth = 1; // Reverted: No scaling by currentRenderScale
            ctx.stroke();
            ctx.setLineDash([]);

            // Draw ghost box
            ctx.fillStyle = rackInnerColor;
            ctx.fillRect(ghostNoteBox.x, ghostNoteBox.y, ghostNoteBox.w, ghostNoteBox.h);
            ctx.strokeRect(ghostNoteBox.x, ghostNoteBox.y, ghostNoteBox.w, ghostNoteBox.h);

            // Draw ghost text
            ctx.fillStyle = rackTextColor;
            ctx.font = `${noteFontSize}px Inter, sans-serif`;
            ctx.textBaseline = 'top';
            ctx.textAlign = ghostTextAlignment;

            lines.forEach((line, index) => {
                const textY = ghostNoteBox.y + padding + (index * lineHeight);
                ctx.fillText(line, ghostNoteBox.x + ghostTextXOffset, textY);
            });
        }

        ctx.globalAlpha = originalAlpha; // Reset alpha
        return noteBox; // Return the bounding box of the actual note drawn for hit detection
    };

    // --- Draw Ground Shadow ---
    // The following section is entirely removed to eliminate the shadow.
    /*
    const groundLevel = worldHeight;
    const spotCenterX = xOffset + constants.WORLD_WIDTH / 2;
    const spotCenterY = groundLevel + constants.BASE_UNIT_HEIGHT * 0.5;
    const spotRadius = constants.WORLD_WIDTH * 0.7;
    ctx.save();
    ctx.translate(spotCenterX, spotCenterY);
    ctx.scale(1.6, 1);
    ctx.translate(-spotCenterX, -spotCenterY);
    const gradient = ctx.createRadialGradient(spotCenterX, spotCenterY, 0, spotCenterX, spotCenterY, spotRadius);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.08)');
    gradient.addColorStop(0.8, 'rgba(0, 0, 0, 0.02)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(spotCenterX, spotCenterY, spotRadius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
    */

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
        ctx.lineWidth = 1; // Reverted: No scaling by currentRenderScale
        ctx.stroke();
    };
    const drawRackFrontRails = () => {
        ctx.fillStyle = rackRailColor;
        ctx.fillRect(xOffset, 0, railLeft - xOffset, worldHeight);
        ctx.fillRect(railRight, 0, (xOffset + constants.WORLD_WIDTH) - railRight, worldHeight);
        const sideLabelFontSize = Math.max(8, Math.min(12, constants.BASE_UNIT_HEIGHT * 0.22));
        ctx.textBaseline = 'middle';
        for (let i = 0; i < rackHeightU; i++) {
            const y = worldHeight - (i + 1) * constants.BASE_UNIT_HEIGHT;
            const yCenter = y + constants.BASE_UNIT_HEIGHT / 2;
            ctx.fillStyle = rackTextColor;
            ctx.font = `${sideLabelFontSize}px sans-serif`;
            ctx.textAlign = 'left';
            ctx.fillText(`${i + 1}U`, xOffset + (railLeft - xOffset) * 0.1, yCenter);
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
            if (!isExportMode && state.isDraggingSelection && isSelected) return; // Only skip drag ghost in interactive mode
            const y = item.y * constants.BASE_UNIT_HEIGHT;
            const itemHeight = item.u * constants.BASE_UNIT_HEIGHT;
            // Use state.isShowingRear for stencil selection, unless in export mode where this choice can be overridden if needed
            const currentStencilCache = state.isShowingRear ? state.stencilRearCache : state.stencilCache;
            const stencilKey = state.isShowingRear ? (item.stencilRear || `${item.stencil}-rear` || 'generic-equipment-rear') : (item.stencil || 'generic-equipment');
            let stencilImage = currentStencilCache.get(stencilKey);
            if (stencilImage && stencilImage.complete) { ctx.drawImage(stencilImage, eqLeft, y, eqWidth, itemHeight); } else { ctx.fillStyle = getColorByType(item.type); ctx.fillRect(eqLeft, y, eqWidth, itemHeight); }
            if (!isExportMode && isSelected) { ctx.fillStyle = selectionHighlightColor; ctx.fillRect(eqLeft, y, eqWidth, itemHeight); } // Only highlight in interactive mode
            if (!state.isShowingRear && item.type !== 'shelf' && !item.side) { // Only draw label for front view
                const textX = eqLeft + eqWidth / 2;
                const textY = y + itemHeight / 2;
                ctx.font = `bold ${itemLabelFontSize}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
                ctx.lineWidth = 4; // Reverted: No scaling by currentRenderScale
                ctx.lineJoin = 'round';
                ctx.strokeText(item.label, textX, textY);
                ctx.fillStyle = 'white';
                ctx.fillText(item.label, textX, textY);
            }
            // Pass isDraggingNote to drawNotesFor
            drawNotesFor(item, { x: eqLeft, y, w: eqWidth, h: itemHeight }, xOffset, forPdfExport, currentRenderScale); // Pass xOffset, forPdfExport, currentRenderScale
            if (item.shelfItems) {
                item.shelfItems.forEach(shelfItem => {
                    const shelfIsSelected = state.selectedItems.some(sel => sel.item === shelfItem);
                    if (!isExportMode && state.isDraggingSelection && shelfIsSelected) return; // Only skip drag ghost in interactive mode
                    const shelfStencilKey = state.isShowingRear ? (shelfItem.stencilRear || `${shelfItem.stencil}-rear` || 'generic-shelf-item-rear') : (shelfItem.stencil || 'generic-shelf-item');
                    const shelfStencil = currentStencilCache.get(shelfStencilKey);
                    const drawW = shelfItem.size.width * constants.SHELF_ITEM_RENDER_SCALE;
                    const drawH = shelfItem.size.height * constants.SHELF_ITEM_RENDER_SCALE;
                    const drawX = eqLeft + shelfItem.x;
                    const drawY = y - drawH; // Position shelf item above the shelf
                    if (shelfStencil && shelfStencil.complete) { ctx.drawImage(shelfStencil, drawX, drawY, drawW, drawH); } else { ctx.fillStyle = getColorByType(shelfItem.type); ctx.fillRect(drawX, drawY, drawW, drawH); }
                    if (!isExportMode && shelfIsSelected) { ctx.fillStyle = selectionHighlightColor; ctx.fillRect(drawX, drawY, drawW, drawH); } // Only highlight in interactive mode
                    // Pass isDraggingNote to drawNotesFor
                    drawNotesFor(shelfItem, { x: drawX, y: drawY, w: drawW, h: drawH }, xOffset, forPdfExport, currentRenderScale); // Pass xOffset, forPdfExport, currentRenderScale
                });
            }
        });
    };
    const drawVPDUs = () => {
        vpdus.forEach(pdu => {
            if (!isExportMode && state.isDraggingSelection && state.selectedItems.some(sel => sel.item === pdu)) return; // Only skip drag ghost in interactive mode
            const rect = getPduWorldRect(pdu);
            ctx.fillStyle = '#333';
            ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
            ctx.strokeStyle = '#444';
            ctx.lineWidth = 1; // Reverted: No scaling by currentRenderScale
            ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
            if (!isExportMode && state.selectedItems.some(sel => sel.item === pdu)) { ctx.fillStyle = selectionHighlightColor; ctx.fillRect(rect.x, rect.y, rect.w, rect.h); } // Only highlight in interactive mode
        });
    };

    drawRackBackPanel();
    // Decide front/rear based on state.isShowingRear for interactive view
    // For export, we assume the user intends to export what they see, or specific orientation.
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