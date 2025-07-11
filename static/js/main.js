// --- START OF FILE main.js ---

import { fetchInitialData } from './api.js';
import { initEventListeners } from './events.js';
import * as state from './state.js'; // Keep this for state management
import {
    applyInitialTheme,
    createNewRackInstance,
    populateEquipmentList, // <-- ADD THIS
    setZoom // <-- ADD THIS
    , // <-- ADD THIS
    updateInfoPanel,
    // NEW: Import these UI functions directly from ui.js
    updateRackControlsUI
} from './ui.js';


/**
 * Main application entry point.
 */
async function start() {
    // 1. Apply theme and set up all user interaction listeners immediately.
    applyInitialTheme();
    initEventListeners();

    try {
        // 2. Fetch the static data needed for the app (equipment list, stencils).
        const { equipmentData } = await fetchInitialData();
        populateEquipmentList(equipmentData);

        // 3. Start a new, blank layout on initial load.
        // We're no longer automatically loading a default layout.json.
        // Instead of calling resetNewLayout (which has a confirm dialog),
        // we manually set the initial state to a single empty rack and mark it as "saved".
        const initialRack = createNewRackInstance(); // Creates a default new rack object
        initialRack.name = "Rack 1"; // Default name for the first rack
        initialRack.equipment = []; // Ensure it's empty
        state.setRacks([initialRack]);
        state.setActiveRackIndex(0);
        state.setCurrentFilename(null); // No file loaded initially
        // Mark this initial blank state as "saved" so no warning appears on first refresh/reset.
        state.setSavedLayoutContent(JSON.parse(JSON.stringify(state.racks)));

        // Manually trigger UI updates as resetNewLayout typically would
        // (drawRack is called by setZoom 'fit')
        // Corrected: Call UI functions from ui.js, not state.js
        updateRackControlsUI(); // <-- CORRECTED CALL
        updateInfoPanel();      // <-- CORRECTED CALL
        setZoom('fit');         // <-- CORRECTED CALL

    } catch (err) {
        console.error('Critical application startup error:', err);
        document.body.innerHTML = `<div style="padding: 2rem; color: #d9534f;"><h1>Application Failed to Load</h1><p>Could not load essential data. Please check the console for details.</p></div>`;
    }
}

// Kick off the application.
start();