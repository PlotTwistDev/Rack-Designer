

// --- START OF FILE constants.js ---

// --- Constants ---
export const BASE_UNIT_HEIGHT = 40;
export const SHELF_ITEM_RENDER_SCALE = 0.85;
export const RACK_SPACING = BASE_UNIT_HEIGHT * 4;
export const WORLD_WIDTH = BASE_UNIT_HEIGHT * 14;

// Color mapping for equipment types
export const COLORS = {
    server: '#2196f3',
    'shelf-item': '#4caf50',
    render: '#3f51b5',
    switch: '#9c27b0',
    ups: '#ff5722',
    blank: '#90a4ae',
    storage: '#ff9800',
    workstation: '#795548',
    kvm: '#009688',
    shelf: '#BDBDBD',
    monitor: '#4CAF50'
};

// Blanking plate U sizes, sorted descending for efficient filling
export const BLANKING_PLATE_USIZES = [12, 10, 8, 6, 4, 2, 1];

// NEW: Default offset for notes from the center of their equipment item
export const DEFAULT_NOTE_OFFSET_X = WORLD_WIDTH * 0.2; // Example: 20% of world width to the right
export const DEFAULT_NOTE_OFFSET_Y = 0; // Centered vertically initially