# 📊 Rack Designer

A versatile web application for designing and visualizing server rack layouts. This tool allows users to drag-and-drop various types of equipment onto virtual racks, manage multiple rack configurations, and export their designs to PDF or image files.

## ✨ Features

-   **Interactive Drag-and-Drop:** Easily add, remove, and rearrange equipment within your racks.
-   **Comprehensive Equipment Library:** Includes a variety of servers, storage, networking devices, KVMs, power units (PDUs, UPS), monitors, and specialized shelf items.
-   **Front & Rear Views:** Toggle between front and rear perspectives of your rack(s) to visualize cabling and rear-mounted components.
-   **Multi-Rack Management:**
    -   Add and delete multiple racks.
    -   Navigate between individual racks or view all racks in an overview mode.
    -   Reorder racks by dragging their names in multi-rack view.
    -   Rename racks directly on the canvas (double-click on rack name in multi-rack view) or via the sidebar in single rack view.
-   **Flexible Rack Sizes:** Adjust the U-height of individual racks (24U, 42U, 48U).
-   **Detailed Annotation & Interaction:**
    -   Add custom notes to any equipment item. Notes are visually connected to their parent item.
    -   Drag individual notes on the canvas to reposition them.
    -   Independently select notes with `Alt`+`Click` or marquee select with `Alt`+`Drag`.
    -   Drag a selection of notes to move them all together.
-   **Contextual Actions:** Right-click on items or notes for quick actions:
    -   **Edit Notes:** Opens the info panel to edit an item's notes.
    -   **Align Horizontally:** Align multiple selected notes for a cleaner diagram.
    -   **Fill with Blanking Plates:** Automatically populate empty U-spaces in a rack.
    -   **Duplicate:** Quickly duplicate selected equipment vertically.
-   **Save & Load Layouts:** Save your designs to the server with custom filenames and load them back later. Unsaved changes are detected before closing the browser.
-   **Powerful Export Options:**
    -   **Export to PDF:** Generate a multi-page PDF, with each rack on its own page, including an itemized list of equipment and notes.
    -   **Export to Image (PNG):**
        -   Export all racks together (with or without notes).
        -   Export each rack as an individual image (with notes).
        -   Choose from Standard, High, or Ultra resolution options.
-   **Intuitive Navigation:** Pan across the canvas with `Shift`+`Drag` or Middle-click, and zoom in/out with the mouse wheel or dedicated buttons.
-   **Theme Switching:** Toggle between light and dark themes.

## 📁 Project Structure
```
├── static/
│   ├── index.html         # Main HTML template
│   ├── style.css          # Core styling
│   ├── theme.css          # Light/dark theme variables
│   └── js/
│       ├── state.js       # Application state management
│       ├── api.js         # Data fetching & layout persistence
│       ├── canvas.js      # Canvas setup & draw orchestration
│       ├── renderer.js    # Low‑level drawing helpers
│       ├── events.js      # User interaction & events
│       ├── ui.js          # DOM/UI updates & controls
│       ├── utils.js       # Utility functions & hit testing
│       └── main.js        # App initialization & startup
├── server.py              # Backend server & API definitions
├── requirements.txt       # Python dependencies
└── README.md              # Project documentation
```
## 🛠️ Technologies Used

*   **Backend:**
    *   Python 3.x
    *   Flask: For serving the web application, managing API endpoints for equipment data, stencils, and saving/loading layouts.
*   **Frontend:**
    *   HTML5
    *   CSS3 (with custom CSS variables for theming)
    *   JavaScript (ES Modules)
    *   Canvas API: For all drawing and interactive elements.
    *   jsPDF Library: For client-side PDF generation.

## 🚀 Getting Started

Follow these instructions to set up and run the Rack Designer application locally.

### Prerequisites

*   Python 3.6+
*   pip (Python package installer)

### Installation

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/PlotTwistDev/rack-designer.git
    cd rack-designer
    ```

2.  **Create a virtual environment (recommended):**

    ```bash
    python -m venv venv
    # On Windows:
    .\venv\Scripts\activate
    # On macOS/Linux:
    source venv/bin/activate
    ```

3.  **Install Flask:**

    ```bash
    pip install Flask
    ```

### Running the Application

1.  **Start the Flask server:**

    ```bash
    python app1.py
    ```

2.  **Access the application:**
    Open your web browser and navigate to `http://127.0.0.1:5000/`.

    The server will automatically create a `racks/` directory in the project root to store your saved layout files (`.json`).

## 🖥️ Usage Guide

### Basic Navigation & Viewing

-   **Pan Canvas:** Hold `Shift` and drag with the left mouse button, or simply drag with the middle mouse button.
-   **Zoom Canvas:** Use the mouse wheel, or click the dedicated zoom buttons (`Fit`, `0.5x`, `1x`, `2x`) in the left sidebar.
-   **Toggle Front/Rear View:** Use the "Show Rear" / "Show Front" button in the left sidebar to switch the perspective for all racks.
-   **Toggle Theme:** Switch between Light (☀️) and Dark (🌙) modes using the button in the bottom-right controls.

### Managing Equipment & Notes

-   **Adding Equipment:** Drag items from the categorized list in the left sidebar and drop them onto a rack.
    -   Standard equipment (servers, switches, etc.) snaps to the nearest available U-slot.
    -   Vertical PDUs snap to the left or right rail.
    -   Shelf items can only be placed on compatible "shelf" units.
-   **Selecting Equipment:**
    -   Click an item to select it. This will display its details in the right-hand Info Panel.
    -   Hold `Ctrl` and click to select multiple items.
    -   Click and drag on an empty area of the canvas to create a marquee box for multi-selection.
-   **Selecting Notes:**
    -   Hold `Alt` and click a note to select it independently of its equipment.
    -   Hold `Alt`+`Ctrl` to add or remove notes from the current selection.
    -   Hold `Alt` and drag a marquee box to select multiple notes.
-   **Moving Items & Notes:**
    -   Once selected, click and drag any item in a selection to move the entire group.
    -   Likewise, click and drag any selected note to move the entire group of selected notes.
-   **Editing & Deleting:**
    -   Press `Delete` or `Backspace` to delete all selected equipment.
    -   Double-click an item or its note to open the **Info Panel** for editing its label and text notes.
-   **Context Menu (Right-Click):**
    -   **On an Item:** Opens a menu to `Duplicate` the item up or down, or `Fill with Blanking Plates`.
    -   **On a Note:** Opens a menu to `Align Horizontally` with other selected notes.

### Managing Racks

The rack controls are located in the floating panel at the bottom right of the canvas.

-   **Navigate Racks:** Use the `◀` and `▶` buttons to switch between racks (only available in single-rack view).
-   **Add / Delete Racks:** Use the `+` button to add a new rack and the `🗑️` button to delete the currently active rack.
-   **Rename Racks:**
    -   In single-rack view, click the name in the control panel to edit it.
    -   In multi-rack view, double-click directly on the rack's name above the rack itself.
-   **Toggle Layout View:** Use the `🔲` / `🔳` button to switch between the focused single-rack view and the multi-rack overview.
-   **Change Rack Size:** In single-rack view, use the "Size" dropdown in the left sidebar to change the U-height of the current rack.

### Saving, Loading & Exporting

These controls are located in the left sidebar.

-   **Save:** Saves the current layout. If it's a new layout, it will prompt for a filename. If a file is already loaded, it will silently overwrite the existing file.
-   **Save As...:** Opens a modal to save the current layout under a new or different filename.
-   **Load:** Opens a modal to browse and load a previously saved layout.
-   **Reset / New:** Starts a fresh, blank layout (prompts for confirmation if there are unsaved changes).
-   **Export to PDF:** Generates a multi-page PDF of all racks with details.
-   **Export to Image:** Opens a modal with options to generate high-resolution PNG images of your layout.

### Keyboard Shortcuts

| Shortcut                | Action                                                |
| :---------------------- | :---------------------------------------------------- |
| `Ctrl` + `C`            | Copies the selected equipment to the clipboard.       |
| `Ctrl` + `X`            | Cuts the selected equipment to the clipboard.         |
| `Ctrl` + `V`            | Pastes clipboard contents into the active rack.       |
| `Ctrl` + `S`            | Saves the current layout (or opens "Save As" if new). |
| `Delete` / `Backspace`  | Deletes the currently selected equipment.             |
| `Alt` + (Mouse Action)  | Activates note-specific selection and dragging.       |
