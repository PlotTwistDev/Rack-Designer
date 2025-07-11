// --- Core Application State & DOM References ---
// Canvas references are now in canvas.js to break circular dependencies.
export const contextMenu = document.getElementById('contextMenu');

export let racks = [];
export let activeRackIndex = -1;
export const stencilCache = new Map();
export const stencilRearCache = new Map();

// --- View & Interaction State ---
export let scale = 1.0;
export let viewOffset = { x: 0, y: 0 };
export let isPanning = false;
export let panStart = { x: 0, y: 0 };
export let dragAnchor = null;
export let isDraggingSelection = false;
export let selectedItems = [];
export let selectedNotes = []; // NEW: Array to hold selected note objects
export let isSelecting = false;
export let selectionRect = { startX: 0, startY: 0, x: 0, y: 0, w: 0, h: 0 };
export let activeDragGhost = null;
export let isShowingRear = false;
export let isMultiRackView = false; // This is the variable that wasn't being updated
export let clipboard = { standardItems: [], vpdus: [], originalTopY: null }; // For copy/paste
export let isShowingNotes = true; // NEW: Global toggle for notes visibility
export let isNoteSelectionMarquee = false; // NEW: Flag for note-specific marquee

// NEW: Note dragging state
export let isDraggingNote = false;
// { item: object, rackIndex: number, initialNoteOffset: {x,y}, tempNoteOffset: {x,y}, dragStartMouseWorldPos: {x,y} }
export let draggedNoteItemInfo = null;

// NEW: Group Note Dragging State
export let isDraggingNoteSelection = false;
// { dragStartMouseWorldPos: {x,y}, initialOffsets: Map<item, {x,y}> }
export let noteSelectionDragData = null;

// --- for Rack Re-ordering ---
export let isDraggingRack = false;
export let draggedRackIndex = -1;
export let dropTargetIndex = -1;
export let draggedRackGhost = { x: 0 };

// NEW: Rack Name Editor State (for on-canvas editing in multi-rack view)
export let editingRackName = false;
export let editingRackIndex = -1;

// NEW: To track which note is hovered in multi-rack view { item, rackIndex }
export let hoveredNoteItem = null;

// NEW: To track which note was the target for a context menu action
export let contextMenuTargetNoteItem = null;


// --- Info Panel State ---
export let isInfoPanelOpen = false; // Default to open

// --- NEW: Current File Name State ---
export let currentFilename = null; // Stores the name of the currently loaded/saved file

// NEW: Store a deep copy of the last saved/loaded layout for unsaved changes detection
export let savedLayoutContent = []; // NEW


// --- State Modifier Functions ---
export const setRacks = (newRacks) => { racks = newRacks; };
export const setActiveRackIndex = (index) => { activeRackIndex = index; };
export const setScale = (newScale) => { scale = newScale; };
export const setViewOffset = (offset) => { viewOffset = offset; };
export const setIsPanning = (panning) => { isPanning = panning; };
export const setPanStart = (start) => { panStart = start; };
export const setDragAnchor = (anchor) => { dragAnchor = anchor; };
export const setIsDraggingSelection = (dragging) => { isDraggingSelection = dragging; };
export const setSelectedItems = (items) => { selectedItems = items; };
export const setSelectedNotes = (notes) => { selectedNotes = notes; };
export const setIsSelecting = (selecting) => { isSelecting = selecting; };
export const setSelectionRect = (rect) => { selectionRect = rect; };
export const setActiveDragGhost = (ghost) => { activeDragGhost = ghost; };
export const setIsShowingRear = (showing) => { isShowingRear = showing; };
// FIX: Changed 'isMultiView' to 'isMultiRackView' in the assignment
export const setIsMultiRackView = (multiView) => { isMultiRackView = multiView; };
export const setClipboard = (data) => { clipboard = data; };
export const setIsNoteSelectionMarquee = (isNoteMarquee) => { isNoteSelectionMarquee = isNoteMarquee; };
export const setIsShowingNotes = (showing) => { isShowingNotes = showing; };

// NEW: Setters for Note Dragging
export const setIsDraggingNote = (dragging) => { isDraggingNote = dragging; };
export const setDraggedNoteItemInfo = (info) => { draggedNoteItemInfo = info; };

// NEW: Setters for Group Note Dragging
export const setIsDraggingNoteSelection = (dragging) => { isDraggingNoteSelection = dragging; };
export const setNoteSelectionDragData = (data) => { noteSelectionDragData = data; };

// --- Setters for Rack Re-ordering ---
export const setIsDraggingRack = (dragging) => { isDraggingRack = dragging; };
export const setDraggedRackIndex = (index) => { draggedRackIndex = index; };
export const setDropTargetIndex = (index) => { dropTargetIndex = index; };
export const setDraggedRackGhost = (pos) => { draggedRackGhost = pos; };

// NEW: Setters for Rack Name Editor
export const setEditingRackName = (val) => { editingRackName = val; };
export const setEditingRackIndex = (val) => { editingRackIndex = val; };

// NEW: Setter for multi-rack view note hover
export const setHoveredNoteItem = (itemInfo) => { hoveredNoteItem = itemInfo; };

// NEW: Setter for context menu note target
export const setContextMenuTargetNoteItem = (info) => { contextMenuTargetNoteItem = info; };


// --- Setter for Info Panel State ---
export const setIsInfoPanelOpen = (isOpen) => { isInfoPanelOpen = isOpen; };

// --- NEW: Setter for Current File Name ---
export const setCurrentFilename = (filename) => { currentFilename = filename; };

// NEW: Setter for savedLayoutContent
export const setSavedLayoutContent = (content) => { savedLayoutContent = content; }; // NEW