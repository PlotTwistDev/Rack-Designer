/**
 * @file This module centralizes the canvas element, its 2D context, and the main drawing function.
 * It acts as the single source of truth for triggering a re-render of the canvas,
 * breaking the circular dependencies that existed between the renderer, UI, and event modules.
 */

import * as constants from './constants.js';
import { drawSingleRack } from './renderer.js';
import * as state from './state.js';
import { getColorByType } from './utils.js';

// --- Canvas and Context Setup ---
export const canvas = document.getElementById('rackCanvas');
export const canvasContainer = document.getElementById('canvas-container');
export const ctx = canvas.getContext('2d');

/**
 * The main top-level rendering function. It clears the canvas and orchestrates
 * the drawing of all visible elements based on the current application state.
 * This function is called whenever a redraw is needed.
 */
export function drawRack() {
    // --- Canvas Setup and Scaling for High-DPI Displays ---
    canvas.width = canvasContainer.clientWidth * window.devicePixelRatio;
    canvas.height = canvasContainer.clientHeight * window.devicePixelRatio;
    canvas.style.width = `${canvasContainer.clientWidth} px`;
    canvas.style.height = `${canvasContainer.clientHeight} px`;
    ctx.save();
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    // --- Main Drawing ---
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    // Apply pan and zoom transformations to the context.
    ctx.translate(state.viewOffset.x, state.viewOffset.y);
    ctx.scale(state.scale, state.scale);

    // NEW: Clear transient layout data before each draw cycle
    state.racks.forEach(r => delete r.noteLayouts);

    if (state.isMultiRackView) {
        // Find the height of the tallest rack to align all racks to the floor.
        const maxHeightU = state.racks.length > 0 ? Math.max(...state.racks.map(r => r.heightU || 42)) : 42;

        // Draw drop indicator for rack re-ordering
        if (state.isDraggingRack && state.dropTargetIndex > -1) {
            const rackAndSpacingWidth = constants.WORLD_WIDTH + constants.RACK_SPACING;
            const indicatorX = state.dropTargetIndex * rackAndSpacingWidth - constants.RACK_SPACING / 2;
            ctx.save();
            const indicatorColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim();
            ctx.strokeStyle = indicatorColor;
            ctx.lineWidth = 4; // Reverted: No scaling by state.scale
            ctx.setLineDash([10, 5]); // Reverted: No scaling by state.scale
            ctx.beginPath();
            ctx.moveTo(indicatorX, -constants.BASE_UNIT_HEIGHT * 2);
            ctx.lineTo(indicatorX, (maxHeightU + 2) * constants.BASE_UNIT_HEIGHT);
            ctx.stroke();
            ctx.restore();
        }

        state.racks.forEach((rackData, i) => {
            // Skip drawing the original rack while it's being dragged
            if (state.isDraggingRack && i === state.draggedRackIndex) {
                return;
            }
            const xOffset = i * (constants.WORLD_WIDTH + constants.RACK_SPACING);
            const yOffset = (maxHeightU - rackData.heightU) * constants.BASE_UNIT_HEIGHT;
            ctx.save();
            ctx.translate(0, yOffset); // Apply vertical offset for this rack.
            drawSingleRack(ctx, rackData, xOffset, false, state.scale, false); // Pass false for isExportMode and forPdfExport
            // Note: Notes are NOT drawn in multi-rack view during interactive use.

            // Highlight the selected rack
            if (i === state.activeRackIndex) {
                const highlightColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim();
                const highlightPadding = 4; // Reverted: No scaling by state.scale
                ctx.strokeStyle = highlightColor;
                ctx.lineWidth = 3; // Reverted: No scaling by state.scale
                ctx.strokeRect(
                    xOffset - highlightPadding / 2,
                    -highlightPadding / 2,
                    constants.WORLD_WIDTH + highlightPadding,
                    (rackData.heightU * constants.BASE_UNIT_HEIGHT) + highlightPadding
                );
            }

            // Draw rack name and delete button above the rack.
            const headerY = -constants.BASE_UNIT_HEIGHT * 1.5;
            ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-color-primary').trim();

            // Reverted: nameFontSize now scales with world (zoom)
            const nameFontSize = constants.BASE_UNIT_HEIGHT * 0.65; // INCREASED FONT SIZE
            ctx.font = `bold ${nameFontSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const nameText = rackData.name;

            // NEW: Only draw the name if it's NOT the rack currently being edited on-canvas
            if (!(state.editingRackName && i === state.editingRackIndex)) {
                ctx.fillText(nameText, xOffset + constants.WORLD_WIDTH / 2, headerY);
            }

            // Store name bounds for hit detection
            const textMetrics = ctx.measureText(nameText);
            const textWidth = textMetrics.width;
            const textHeight = nameFontSize; // Use the actual size without inverse scaling
            const nameCenterY = yOffset + headerY;
            // Reverted: nameBounds padding and dimensions now scale with world (zoom)
            // INCREASED PADDING FOR LARGER EDIT AREA
            const namePaddingHorizontal = 20;
            const namePaddingVertical = 10;
            rackData.nameBounds = {
                x: xOffset + constants.WORLD_WIDTH / 2 - textWidth / 2 - namePaddingHorizontal,
                y: nameCenterY - textHeight / 2 - namePaddingVertical,
                w: textWidth + namePaddingHorizontal * 2,
                h: textHeight + namePaddingVertical * 2,
            };


            // Draw delete button and store its bounds for hit detection.
            // Reverted: deleteBtnSize now scales with world (zoom)
            const deleteBtnSize = constants.BASE_UNIT_HEIGHT * 1.0; // INCREASED ICON SIZE
            rackData.deleteBtnBounds = {
                x: xOffset + constants.WORLD_WIDTH - deleteBtnSize,
                y: yOffset + headerY - deleteBtnSize / 2, // Vertically center the icon
                w: deleteBtnSize,
                h: deleteBtnSize
            };
            ctx.font = `${deleteBtnSize}px sans-serif`;
            ctx.fillText('🗑️', xOffset + constants.WORLD_WIDTH - deleteBtnSize + deleteBtnSize / 2, headerY);
            ctx.restore();
        });

        // --- NEW/REVISED: Draw Notes Under Racks (Multi-Rack View) ---
        if (state.isShowingNotes) {
            ctx.save();
            const noteFontSize = 11;
            const noteLineHeight = 13;
            const notePadding = 8;
            const noteTextColor = getComputedStyle(document.documentElement).getPropertyValue('--text-color-secondary').trim();
            const noteLineColor = getComputedStyle(document.documentElement).getPropertyValue('--rack-line-color').trim();
            const uLabelColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim();
            const noteBgAlternateColor = getComputedStyle(document.documentElement).getPropertyValue('--rack-inner-color').trim();
            const notesAreaY = (maxHeightU * constants.BASE_UNIT_HEIGHT) + 80;

            // Helper function to draw a single U-position marker
            const drawMarker = (x, y, radius, label) => {
                ctx.fillStyle = uLabelColor;
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, 2 * Math.PI);
                ctx.fill();

                ctx.fillStyle = 'white';
                ctx.font = `bold ${noteFontSize}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, x, y + 1);
            };

            state.racks.forEach((rackData, i) => {
                // NEW: Skip drawing notes for the rack that is currently being dragged
                if (state.isDraggingRack && i === state.draggedRackIndex) {
                    return;
                }

                const xOffset = i * (constants.WORLD_WIDTH + constants.RACK_SPACING);
                const rackYOffset = (maxHeightU - rackData.heightU) * constants.BASE_UNIT_HEIGHT;

                const itemsWithNotes = rackData.equipment
                    .flatMap(item => [item, ...(item.shelfItems || [])])
                    .filter(item => item.notes && item.notes.trim() !== '');

                itemsWithNotes.sort((a, b) => {
                    const findItemY = (item) => {
                        if (item.type !== 'shelf-item') return item.y;
                        const parent = rackData.equipment.find(p => p.shelfItems && p.shelfItems.includes(item));
                        return parent ? parent.y - 0.1 : 999;
                    };
                    return findItemY(a) - findItemY(b);
                });

                // 1. Calculate layout metrics and positions first
                const noteLayouts = itemsWithNotes.map(item => {
                    ctx.font = `bold ${noteFontSize}px Inter, sans-serif`;

                    const finalLines = [];
                    const noteMaxWidth = constants.WORLD_WIDTH;

                    const noteParagraphs = item.notes.split('\n');
                    const firstLine = `[${item.label}]: ${noteParagraphs[0] || ''} `;
                    finalLines.push(...ctx.wrapText(firstLine, noteMaxWidth));

                    for (let j = 1; j < noteParagraphs.length; j++) {
                        finalLines.push(...ctx.wrapText(noteParagraphs[j], noteMaxWidth));
                    }

                    const boxHeight = (finalLines.length * noteLineHeight) + notePadding;
                    return { item, lines: finalLines, boxHeight };
                });

                // 2. Calculate Y positions and store bounds for hit-testing
                let currentNoteY = notesAreaY;
                noteLayouts.forEach(layout => {
                    layout.bounds = {
                        x: xOffset,
                        y: currentNoteY - notePadding / 2,
                        w: constants.WORLD_WIDTH,
                        h: layout.boxHeight
                    };
                    currentNoteY += layout.boxHeight;
                });
                rackData.noteLayouts = noteLayouts; // Store for hit detection in events.js

                // 3. Draw each note using the calculated layout
                noteLayouts.forEach((layout, index) => {
                    const { item, lines, bounds } = layout;
                    const isHovered = state.hoveredNoteItem && state.hoveredNoteItem.item === item && state.hoveredNoteItem.rackIndex === i;
                    const isSelected = state.selectedItems.some(sel => sel.item === item && sel.rackIndex === i);
                    const shouldHighlight = isHovered || isSelected;

                    // FIXED: 'side' must be declared before it is used.
                    const side = (index % 2 === 0) ? 'left' : 'right';

                    // Find source point and U position
                    let sourceX, sourceY, uPositionLabel = '';
                    const eqLeft = xOffset + constants.BASE_UNIT_HEIGHT * 1.25 - constants.BASE_UNIT_HEIGHT * 0.2;
                    const eqWidth = constants.WORLD_WIDTH - (constants.BASE_UNIT_HEIGHT * 1.25 * 2) + (constants.BASE_UNIT_HEIGHT * 0.2 * 2);

                    if (item.type === 'shelf-item') {
                        const parent = rackData.equipment.find(p => p.shelfItems && p.shelfItems.includes(item));
                        if (!parent) return;
                        sourceX = (side === 'left') ? eqLeft : eqLeft + eqWidth;
                        const lowestU_Y = (parent.y + parent.u - 1) * constants.BASE_UNIT_HEIGHT;
                        sourceY = rackYOffset + lowestU_Y + (constants.BASE_UNIT_HEIGHT / 2);
                        const lowestU = rackData.heightU - (parent.y + parent.u - 1);
                        uPositionLabel = `${lowestU} `;
                    } else {
                        sourceX = (side === 'left') ? eqLeft : eqLeft + eqWidth;
                        const lowestU_Y = (item.y + item.u - 1) * constants.BASE_UNIT_HEIGHT;
                        sourceY = rackYOffset + lowestU_Y + (constants.BASE_UNIT_HEIGHT / 2);
                        const lowestU = rackData.heightU - (item.y + item.u - 1);
                        uPositionLabel = `${lowestU} `;
                    }

                    // Draw Alternating Background
                    if (index % 2 !== 0) {
                        ctx.fillStyle = noteBgAlternateColor;
                        ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
                    }

                    // Draw Note Text
                    ctx.fillStyle = noteTextColor;
                    ctx.textBaseline = 'top';
                    ctx.textAlign = 'left';
                    const noteTextX = xOffset;
                    const textStartY = bounds.y + notePadding / 2;

                    lines.forEach((line, lineIndex) => {
                        ctx.fillText(line, noteTextX, textStartY + (lineIndex * noteLineHeight));
                    });

                    // Calculate positions for connector line and marker
                    const handoffY = textStartY + (noteLineHeight / 2);
                    const jogStagger = (Math.floor(index / 2) + 1) * 25;
                    const jogX = (side === 'left')
                        ? (xOffset - jogStagger)
                        : (xOffset + constants.WORLD_WIDTH + jogStagger);

                    const markerRadius = shouldHighlight ? 10 : 8; // Make marker bigger on hover/selection
                    const markerPadding = 6;
                    const endMarkerX = (side === 'left')
                        ? noteTextX - markerRadius - markerPadding
                        : noteTextX + constants.WORLD_WIDTH + markerRadius + markerPadding;

                    // Draw Connector Line
                    ctx.save();
                    ctx.strokeStyle = shouldHighlight ? uLabelColor : noteLineColor;
                    ctx.lineWidth = shouldHighlight ? 2.5 : 1; // Bolder line on hover/selection
                    ctx.setLineDash([]);
                    ctx.beginPath();
                    ctx.moveTo(sourceX, sourceY);
                    ctx.lineTo(jogX, sourceY);
                    ctx.lineTo(jogX, handoffY);
                    ctx.lineTo(endMarkerX, handoffY);
                    ctx.stroke();
                    ctx.restore();

                    // Draw the three U Position Markers
                    drawMarker(sourceX, sourceY, markerRadius, uPositionLabel);
                    drawMarker(jogX, sourceY, markerRadius, uPositionLabel);
                    drawMarker(endMarkerX, handoffY, markerRadius, uPositionLabel);
                });
            });
            ctx.restore();
        }
        // --- END OF NOTES DRAWING ---

        // Draw the semi-transparent ghost of the rack being dragged
        if (state.isDraggingRack && state.draggedRackIndex > -1) {
            ctx.save();
            ctx.globalAlpha = 0.75;
            const rackData = state.racks[state.draggedRackIndex];
            const ghostX = state.draggedRackGhost.x;
            const yOffset = (maxHeightU - rackData.heightU) * constants.BASE_UNIT_HEIGHT;
            ctx.translate(0, yOffset);
            drawSingleRack(ctx, rackData, ghostX, false, state.scale, false);
            ctx.restore();
        }

    } else {
        // Draw only the single active rack.
        if (state.activeRackIndex > -1 && state.racks[state.activeRackIndex]) {
            drawSingleRack(ctx, state.racks[state.activeRackIndex], 0, false, state.scale, false);
        }
    }

    // --- Draw Dragging Ghost Images (Equipment) ---
    if (state.isDraggingSelection) {
        ctx.save();
        ctx.globalAlpha = 0.75;

        const currentStencilCache = state.isShowingRear ? state.stencilRearCache : state.stencilCache;
        const itemLabelFontSize = Math.max(9, Math.min(16, constants.BASE_UNIT_HEIGHT * 0.35));

        state.selectedItems.forEach(sel => {
            const { item } = sel;
            if (item.tempY === undefined && item.tempX === undefined) return;

            const stencilKey = state.isShowingRear ? (item.stencilRear || `${item.stencil} -rear`) : item.stencil;
            let stencil = currentStencilCache.get(stencilKey);

            if (!stencil) {
                if (item.type === 'shelf-item') {
                    stencil = currentStencilCache.get(state.isShowingRear ? 'generic-shelf-item-rear' : 'generic-shelf-item');
                } else if (item.type === 'v-pdu') {
                    stencil = currentStencilCache.get(state.isShowingRear ? 'generic-v-pdu-rear' : 'generic-v-pdu');
                } else {
                    stencil = currentStencilCache.get(state.isShowingRear ? 'generic-equipment-rear' : 'generic-equipment');
                }
            }

            let ghostX, ghostY, ghostW, ghostH;

            if (item.type === 'shelf-item') {
                ghostX = item.tempX; ghostY = item.tempY;
                ghostW = item.size.width * constants.SHELF_ITEM_RENDER_SCALE; ghostH = item.size.height * constants.SHELF_ITEM_RENDER_SCALE;
            } else {
                let xOffset = 0;
                if (state.isMultiRackView && sel.rackIndex > -1) {
                    xOffset = sel.rackIndex * (constants.WORLD_WIDTH + constants.RACK_SPACING);
                }
                const railLeft = constants.BASE_UNIT_HEIGHT * 1.25;
                const eqPadding = constants.BASE_UNIT_HEIGHT * 0.2;

                if (item.type === 'v-pdu') {
                    const railRight = railLeft + (constants.WORLD_WIDTH - (constants.BASE_UNIT_HEIGHT * 1.25 * 2));
                    const pduDrawWidth = constants.BASE_UNIT_HEIGHT * 0.75;
                    ghostX = xOffset + (item.side === 'left' ? railLeft : railRight - pduDrawWidth);
                    ghostH = (state.racks[sel.rackIndex]?.heightU || 42) * constants.BASE_UNIT_HEIGHT;
                    ghostW = pduDrawWidth;
                } else {
                    ghostX = xOffset + railLeft - eqPadding;
                    ghostW = constants.WORLD_WIDTH - (railLeft * 2) + (eqPadding * 2);
                    ghostH = item.u * constants.BASE_UNIT_HEIGHT;
                }
                ghostY = item.tempY;
            }

            if (stencil && stencil.complete) {
                ctx.drawImage(stencil, ghostX, ghostY, ghostW, ghostH);
            } else {
                ctx.fillStyle = getColorByType(item.type);
                ctx.fillRect(ghostX, ghostY, ghostW, ghostH);
            }

            // MODIFIED: Draw the label on the ghost image
            if (!state.isShowingRear && item.type !== 'shelf' && item.type !== 'shelf-item' && item.type !== 'v-pdu') {
                const textX = ghostX + ghostW / 2;
                const textY = ghostY + ghostH / 2;

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
        });
        ctx.restore();
    }

    // Restore from pan/zoom transforms to draw screen-space UI elements.
    ctx.restore();

    // --- Draw Marquee Selection Box (in screen space) ---
    ctx.save();
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    if (state.isSelecting) {
        const selectionBg = getComputedStyle(document.documentElement).getPropertyValue('--selection-bg').trim();
        const selectionBorder = getComputedStyle(document.documentElement).getPropertyValue('--selection-border').trim();
        ctx.fillStyle = selectionBg; ctx.strokeStyle = selectionBorder; ctx.lineWidth = 1;
        ctx.fillRect(state.selectionRect.x, state.selectionRect.y, state.selectionRect.w, state.selectionRect.h);
        ctx.strokeRect(state.selectionRect.x, state.selectionRect.y, state.selectionRect.w, state.selectionRect.h);
    }
    ctx.restore();
}

// Helper to wrap text for canvas drawing
CanvasRenderingContext2D.prototype.wrapText = function (text, maxWidth) {
    if (!text) {
        return ['']; // Return array with one empty string to preserve a line break for empty notes.
    }
    if (this.measureText(text).width < maxWidth) {
        return [text];
    }

    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const testLine = currentLine ? currentLine + ' ' + word : word;

        if (this.measureText(testLine).width > maxWidth && i > 0) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    }
    lines.push(currentLine);
    return lines;
};


/**
 * Draws the current rack layout (single or multi-rack) onto a provided canvas context,
 * typically for export purposes. It handles its own scaling and positioning.
 * @param {CanvasRenderingContext2D} targetCtx The context to draw on.
 * @param {Array<object>} racksToDraw The array of rack data to draw.
 * @param {object} options Options for drawing:
 *   - {boolean} isMultiRackView: Whether to draw as a multi-rack layout.
 *   - {boolean} isShowingRear: Whether to show rear stencils.
 *   - {number} targetCanvasWidth: The physical width of the canvas to draw on.
 *   - {number} targetCanvasHeight: The physical height of the canvas to draw on.
 *   - {number} logicalContentWidth: The logical "world" width of the content to be drawn.
 *   - {number} logicalContentHeight: The logical "world" height of the content to be drawn.
 *   - {boolean} [forPdfExport=false]: If true, specific drawing adjustments for PDF are made (e.g., no notes drawn on canvas).
 */
export function drawRackForExport(targetCtx, racksToDraw, options) {
    const {
        isMultiRackView, isShowingRear,
        targetCanvasWidth, targetCanvasHeight, // These are the physical pixel dimensions of the canvas
        logicalContentWidth, logicalContentHeight, // These are the logical "world" dimensions of the content
        forPdfExport = false // New parameter to control if notes are drawn on canvas for PDF
    } = options;

    // Clear the entire physical canvas BEFORE applying any transforms
    targetCtx.clearRect(0, 0, targetCanvasWidth, targetCanvasHeight);
    targetCtx.save();

    // Temporarily set state flags used by drawSingleRack for stencil selection
    const originalIsShowingRear = state.isShowingRear;
    state.setIsShowingRear(isShowingRear);

    // This `maxRackHeightU` is used for vertical alignment of racks in multi-rack view
    let maxRackHeightU = 42;
    if (isMultiRackView && racksToDraw.length > 0) {
        maxRackHeightU = Math.max(...racksToDraw.map(r => r.heightU || 42));
    } else if (!isMultiRackView && racksToDraw.length === 1) { // MODIFIED: Check for single rack explicitly
        // For single rack export, the alignment context is just that rack's height
        maxRackHeightU = racksToDraw[0].heightU || 42;
    }

    const contentAspectRatio = logicalContentWidth / logicalContentHeight;
    const canvasAspectRatio = targetCanvasWidth / targetCanvasHeight;

    let overallExportScale;
    let offsetX = 0;
    let offsetY = 0;

    if (contentAspectRatio > canvasAspectRatio) {
        // Fit to width:
        overallExportScale = targetCanvasWidth / logicalContentWidth;
        offsetY = (targetCanvasHeight - logicalContentHeight * overallExportScale) / 2;
    } else {
        // Fit to height:
        overallExportScale = targetCanvasHeight / logicalContentHeight;
        offsetX = (targetCanvasWidth - logicalContentWidth * overallExportScale) / 2;
    }

    // Apply the overall transformation (translation and scale) to the context.
    targetCtx.translate(offsetX, offsetY);
    targetCtx.scale(overallExportScale, overallExportScale);

    // Now draw the racks using the common renderer function
    if (isMultiRackView) {
        racksToDraw.forEach((rackData, i) => {
            const xOffset = i * (constants.WORLD_WIDTH + constants.RACK_SPACING);
            const yOffset = (maxRackHeightU - rackData.heightU) * constants.BASE_UNIT_HEIGHT;
            targetCtx.save();
            targetCtx.translate(0, yOffset);
            drawSingleRack(targetCtx, rackData, xOffset, true, overallExportScale, forPdfExport);
            // Draw rack name above the rack.
            const headerY = -constants.BASE_UNIT_HEIGHT * 1.5;
            targetCtx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-color-primary').trim();
            const nameFontSize = constants.BASE_UNIT_HEIGHT * 0.5;
            targetCtx.font = `bold ${nameFontSize}px sans-serif`;
            targetCtx.textAlign = 'center';
            targetCtx.textBaseline = 'middle';
            const nameText = rackData.name;
            targetCtx.fillText(nameText, xOffset + constants.WORLD_WIDTH / 2, headerY);
            targetCtx.restore();
        });
    } else {
        // Draw only the single active rack.
        const currentRack = racksToDraw[0];
        if (currentRack) {
            drawSingleRack(targetCtx, currentRack, 0, true, overallExportScale, forPdfExport);
        }
    }

    // Restore to remove the export-specific transforms
    targetCtx.restore();

    // Restore original state flags
    state.setIsShowingRear(originalIsShowingRear);
}