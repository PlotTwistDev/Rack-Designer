// --- START OF FILE canvas.js ---

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
    canvas.style.width = `${canvasContainer.clientWidth}px`;
    canvas.style.height = `${canvasContainer.clientHeight}px`;
    ctx.save();
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    // --- Main Drawing ---
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    // Apply pan and zoom transformations to the context.
    ctx.translate(state.viewOffset.x, state.viewOffset.y);
    ctx.scale(state.scale, state.scale);

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
            const nameFontSize = constants.BASE_UNIT_HEIGHT * 0.5;
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
            rackData.nameBounds = {
                x: xOffset + constants.WORLD_WIDTH / 2 - textWidth / 2 - 5,
                y: nameCenterY - textHeight / 2 - 5,
                w: textWidth + 10,
                h: textHeight + 10
            };


            // Draw delete button and store its bounds for hit detection.
            // Reverted: deleteBtnSize now scales with world (zoom)
            const deleteBtnSize = constants.BASE_UNIT_HEIGHT * 0.8;
            rackData.deleteBtnBounds = {
                x: xOffset + constants.WORLD_WIDTH - deleteBtnSize,
                y: yOffset + headerY - deleteBtnSize * 0.8,
                w: deleteBtnSize,
                h: deleteBtnSize
            };
            ctx.font = `${deleteBtnSize}px sans-serif`;
            ctx.fillText('🗑️', xOffset + constants.WORLD_WIDTH - deleteBtnSize + deleteBtnSize / 2, headerY);
            ctx.restore();
        });

        // Draw the semi-transparent ghost of the rack being dragged
        if (state.isDraggingRack && state.draggedRackIndex > -1) {
            ctx.save();
            ctx.globalAlpha = 0.75;
            const rackData = state.racks[state.draggedRackIndex];
            const ghostX = state.draggedRackGhost.x;
            // The yOffset needs to be applied relative to the *top* of the tallest rack,
            // so we calculate it as if the ghost rack is also being positioned
            // within the context of the overall multi-rack height alignment.
            const yOffset = (maxHeightU - rackData.heightU) * constants.BASE_UNIT_HEIGHT;
            ctx.translate(0, yOffset); // Apply vertical offset for the ghost rack too
            drawSingleRack(ctx, rackData, ghostX, false, state.scale, false); // Pass false for isExportMode and forPdfExport
            ctx.restore();
        }

    } else {
        // Draw only the single active rack.
        if (state.activeRackIndex > -1 && state.racks[state.activeRackIndex]) {
            drawSingleRack(ctx, state.racks[state.activeRackIndex], 0, false, state.scale, false); // Pass false for isExportMode and forPdfExport
        }
    }

    // --- Draw Dragging Ghost Images (Equipment) ---
    if (state.isDraggingSelection) {
        ctx.globalAlpha = 0.75; // Make ghost images semi-transparent.
        const currentStencilCache = state.isShowingRear ? state.stencilRearCache : state.stencilCache;
        state.selectedItems.forEach(sel => {
            const { item } = sel;
            // Ensure the item has a temporary position (i.e., it's part of the drag).
            if (item.tempY === undefined && item.tempX === undefined) return;

            const stencilKey = state.isShowingRear ? (item.stencilRear || `${item.stencil}-rear`) : item.stencil;
            const stencil = currentStencilCache.get(stencilKey);
            let ghostX, ghostY, ghostW, ghostH;

            if (item.type === 'shelf-item') {
                ghostX = item.tempX; ghostY = item.tempY;
                ghostW = item.size.width * constants.SHELF_ITEM_RENDER_SCALE; ghostH = item.size.height * constants.SHELF_ITEM_RENDER_SCALE;
            } else {
                // For standard items, the horizontal position is fixed relative to the rack.
                let xOffset = 0;
                if (state.isMultiRackView && sel.rackIndex > -1) {
                    xOffset = sel.rackIndex * (constants.WORLD_WIDTH + constants.RACK_SPACING);
                }
                ghostX = xOffset + constants.BASE_UNIT_HEIGHT * 1.25 - constants.BASE_UNIT_HEIGHT * 0.2;
                ghostY = item.tempY;
                ghostW = constants.WORLD_WIDTH - (constants.BASE_UNIT_HEIGHT * 1.25 * 2) + (constants.BASE_UNIT_HEIGHT * 0.2 * 2);
                ghostH = item.u * constants.BASE_UNIT_HEIGHT;
            }

            if (stencil && stencil.complete) { ctx.drawImage(stencil, ghostX, ghostY, ghostW, ghostH); } else { ctx.fillStyle = getColorByType(item.type); ctx.fillRect(ghostX, ghostY, ghostW, ghostH); }
        });
        ctx.globalAlpha = 1.0; // Reset transparency.
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
    } else if (!isMultiRackView && racksToDraw.length > 0) {
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

    // Only add the 10% “breathing room” for image exports:
    // Removed to "crop the empty space"
    // if (!forPdfExport) {
    //     overallExportScale *= 0.9;
    // }

    // Apply the overall transformation (translation and scale) to the context.
    // These transformations are now directly in physical pixel space,
    // meaning 1 unit in the context will be 1 physical pixel of the output image.
    // This scale factor converts logical (world) units to physical canvas units.
    targetCtx.translate(offsetX, offsetY);
    targetCtx.scale(overallExportScale, overallExportScale);

    // Now draw the racks using the common renderer function
    if (isMultiRackView) {
        racksToDraw.forEach((rackData, i) => {
            const xOffset = i * (constants.WORLD_WIDTH + constants.RACK_SPACING);
            const yOffset = (maxRackHeightU - rackData.heightU) * constants.BASE_UNIT_HEIGHT;
            targetCtx.save();
            targetCtx.translate(0, yOffset);
            // Pass overallExportScale to drawSingleRack for consistent rendering in export mode
            drawSingleRack(targetCtx, rackData, xOffset, true, overallExportScale, forPdfExport);
            // Draw rack name above the rack.
            const headerY = -constants.BASE_UNIT_HEIGHT * 1.5;
            targetCtx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-color-primary').trim();
            const nameFontSize = constants.BASE_UNIT_HEIGHT * 0.5; // No scaling here, as targetCtx is already scaled
            targetCtx.font = `bold ${nameFontSize}px sans-serif`;
            targetCtx.textAlign = 'center';
            targetCtx.textBaseline = 'middle';
            const nameText = rackData.name;
            targetCtx.fillText(nameText, xOffset + constants.WORLD_WIDTH / 2, headerY);
            targetCtx.restore();
        });
    } else {
        // Draw only the single active rack.
        const currentRack = racksToDraw[0]; // Assume single rack is passed as the first element
        if (currentRack) {
            // Pass overallExportScale to drawSingleRack for consistent rendering in export mode
            drawSingleRack(targetCtx, currentRack, 0, true, overallExportScale, forPdfExport);
        }
    }

    // Restore to remove the export-specific transforms
    targetCtx.restore();

    // Restore original state flags
    state.setIsShowingRear(originalIsShowingRear);
}