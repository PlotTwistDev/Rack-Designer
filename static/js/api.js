import * as constants from './constants.js'; // Needed for DEFAULT_NOTE_OFFSET_X/Y
import * as state from './state.js';

async function loadStencils(stencilDefs, targetCache) {
    const createSvgDataUrl = (svgString) => `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgString)))}`;
    const promises = Object.keys(stencilDefs).map(key => {
        if (targetCache.has(key)) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                targetCache.set(key, img);
                resolve();
            };
            img.onerror = reject;
            try {
                const svg = new Function('return `' + stencilDefs[key] + '`;')();
                img.src = createSvgDataUrl(svg);
            } catch (e) {
                reject(e);
            }
        });
    });
    return Promise.allSettled(promises);
}


/**
 * Common layout processing function for loaded data.
 * @param {Array} savedData The raw data loaded from the server.
 * @returns {Array} Processed racks array.
 */
function processLoadedRacks(savedData) {
    let loadedRacks = [];
    if (savedData && Array.isArray(savedData)) {
        // Check if it's the old single-rack format or new multi-rack format
        if (savedData.length > 0 && savedData[0].equipment !== undefined) {
            loadedRacks = savedData;
        } else if (savedData.length > 0) {
            // Convert old format (array of equipment) to new multi-rack format (single rack)
            loadedRacks = [{ id: Date.now(), name: "Rack 1", equipment: savedData, heightU: 42 }];
        }
    }
    loadedRacks.forEach(rack => {
        if (!rack.heightU) rack.heightU = 42;
        if (!rack.equipment) rack.equipment = [];
        if (!rack.id) rack.id = Date.now() + Math.random(); // Ensure unique IDs
        rack.equipment.forEach(item => {
            if (!item.shelfItems) item.shelfItems = [];
            if (item.notes === undefined) item.notes = ''; // Ensure notes property exists

            // NEW: Ensure noteOffset exists with the new default
            if (item.noteOffset === undefined) {
                item.noteOffset = { x: constants.DEFAULT_NOTE_OFFSET_X, y: constants.DEFAULT_NOTE_OFFSET_Y };
                // Clean up old property if it exists
                delete item.notePosition;
            }
        });
    });
    return loadedRacks;
}

/**
 * Fetches all the initial static data for the application (equipment, stencils).
 * @returns {Promise<object>} A promise that resolves to an object containing the fetched data.
 */
export async function fetchInitialData() {
    const [equipmentRes, stencilsRes, stencilsRearRes] = await Promise.all([
        fetch('/api/equipment'),
        fetch('/api/stencils'),
        fetch('/api/stencils-rear')
    ]);
    if (!equipmentRes.ok || !stencilsRes.ok || !stencilsRearRes.ok) {
        throw new Error("Failed to fetch initial application data.");
    }

    const [equipmentData, stencilDefs, stencilRearDefs] = await Promise.all([
        equipmentRes.json(),
        stencilsRes.json(),
        stencilsRearRes.json()
    ]);

    // START MODIFICATION: Add new PDU types and rename the original.
    // This is done here to keep data modifications close to the data source.
    const pduCategory = equipmentData.find(cat => cat.category === "PDUs & Power");
    if (pduCategory) {
        const vPduItem = pduCategory.items.find(it => it.label === 'V-PDU' || it.label === 'V-PDU (Full Height)');
        if (vPduItem) {
            vPduItem.label = 'V-PDU (Full Height)';
            // Note: We don't set a 'u' property, so it will be treated as full-height by default.
        }
        // Add new PDU types if they don't already exist.
        if (!pduCategory.items.some(it => it.u === 20)) {
            pduCategory.items.push({ label: "V-PDU (20U)", type: "v-pdu", u: 20, stencil: "v-pdu-20u-front", stencil_rear: "v-pdu-20u-rear" });
        }
        if (!pduCategory.items.some(it => it.u === 10)) {
            pduCategory.items.push({ label: "V-PDU (10U)", type: "v-pdu", u: 10, stencil: "v-pdu-10u-front", stencil_rear: "v-pdu-10u-rear" });
        }
    }
    // END MODIFICATION

    await Promise.all([
        loadStencils(stencilDefs, state.stencilCache),
        loadStencils(stencilRearDefs, state.stencilRearCache)
    ]);

    return { equipmentData };
}

// --- NEW API FUNCTIONS FOR NAMED LAYOUTS (No changes to these as they are generic) ---

/**
 * Fetches a list of all available named layouts from the server.
 * @returns {Promise<Array<string>>} A promise that resolves to an array of layout names.
 */
export async function getAvailableLayouts() {
    try {
        const res = await fetch('/api/layouts');
        if (!res.ok) {
            console.error("Failed to fetch available layouts:", res.status, await res.json());
            return [];
        }
        const layouts = await res.json();
        return layouts;
    } catch (err) {
        console.error('Error fetching available layouts:', err);
        return [];
    }
}

/**
 * Saves the current layout to the server with a specified filename.
 * Includes a confirmation prompt if the file already exists.
 * @param {string} filename The name for the layout (without .json extension).
 * @returns {Promise<boolean>} A promise that resolves to true on success, false on failure.
 */
export async function saveLayoutAs(filename) {
    try {
        // Step 1: Check if the file already exists
        const existingLayouts = await getAvailableLayouts(); // This fetches filenames from server
        const fileExists = existingLayouts.includes(filename);

        if (fileExists) {
            // Step 2: If it exists, ask for confirmation to overwrite
            if (!confirm(`A layout named "${filename}" already exists. Do you want to overwrite it?`)) {
                return false; // User cancelled overwrite
            }
        }

        // Step 3: Proceed with save (either new file or confirmed overwrite)
        const res = await fetch(`/save_layout/${encodeURIComponent(filename)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state.racks)
        });
        const msg = await res.json();
        if (!res.ok) {
            console.error(`Failed to save layout "${filename}":`, msg.message);
            alert(`Failed to save layout "${filename}": ${msg.message}`);
            return false;
        }
        alert(msg.message || `Layout saved successfully as "${filename}"!`);
        state.setCurrentFilename(filename); // Set current filename on successful save
        state.setSavedLayoutContent(JSON.parse(JSON.stringify(state.racks))); // NEW: Update saved state
        return true;
    } catch (err) {
        console.error(`Error saving layout "${filename}":`, err);
        alert(`Failed to save layout "${filename}".`);
        return false;
    }
}

/**
 * Loads a specified layout from the server by name.
 * @param {string} filename The name of the layout to load (without .json extension).
 * @returns {Promise<boolean>} A promise that resolves to true on success, false on failure.
 */
export async function loadLayoutByName(filename) {
    try {
        const res = await fetch(`/load_layout/${encodeURIComponent(filename)}`);
        if (!res.ok) {
            const errorMsg = await res.json();
            console.error(`Failed to load layout "${filename}":`, res.status, errorMsg.message);
            alert(`Failed to load layout "${filename}": ${errorMsg.message}`);
            return false;
        }
        const savedData = await res.json();
        const processedRacks = processLoadedRacks(savedData);
        state.setRacks(processedRacks);
        state.setActiveRackIndex(state.racks.length > 0 ? 0 : -1);
        state.setCurrentFilename(filename); // Set current filename on successful load
        state.setSavedLayoutContent(JSON.parse(JSON.stringify(processedRacks))); // NEW: Update saved state
        return true;
    } catch (err) {
        console.error(`Error loading layout "${filename}":`, err);
        alert(`Failed to load layout "${filename}".`);
        return false;
    }
}

/**
 * Deletes a specified layout from the server by name.
 * @param {string} filename The name of the layout to delete (without .json extension).
 * @returns {Promise<boolean>} A promise that resolves to true on success, false on failure.
 */
export async function deleteLayout(filename) {
    if (!confirm(`Are you sure you want to delete "${filename}"? This action cannot be undone.`)) {
        return false;
    }
    try {
        const res = await fetch(`/delete_layout/${encodeURIComponent(filename)}`, {
            method: 'DELETE'
        });
        const msg = await res.json();
        if (!res.ok) {
            console.error(`Failed to delete layout "${filename}":`, msg.message);
            alert(`Failed to delete layout "${filename}": ${msg.message}`);
            return false;
        }
        alert(msg.message || `Layout "${filename}" deleted successfully.`);
        if (state.currentFilename === filename) { // If deleting the current active file
            state.setCurrentFilename(null); // Clear current filename
        }
        return true;
    } catch (err) {
        console.error(`Error deleting layout "${filename}".`, err);
        alert(`Failed to delete layout "${filename}".`);
        return false;
    }
}