# 📊 Rack Designer

A versatile web application for designing and visualizing server rack layouts. This tool allows users to drag-and-drop various types of equipment onto virtual racks, manage multiple rack configurations, and export their designs to PDF or image files.

## ✨ Features

*   **Interactive Drag-and-Drop:** Easily add, remove, and rearrange equipment within your racks.
*   **Comprehensive Equipment Library:** Includes a variety of servers, storage, networking devices, KVMs, power units (PDUs, UPS), monitors, and specialized shelf items.
*   **Front & Rear Views:** Toggle between front and rear perspectives of your rack(s) to visualize cabling and rear-mounted components.
*   **Multi-Rack Management:**
    *   Add and delete multiple racks.
    *   Navigate between individual racks or view all racks in an overview mode.
    *   Reorder racks by dragging their names in multi-rack view.
    *   Rename racks directly on the canvas (double-click on rack name in multi-rack view) or via the sidebar in single rack view.
*   **Flexible Rack Sizes:** Adjust the U-height of individual racks (24U, 42U, 48U).
*   **Contextual Actions:** Right-click on items or empty rack space for quick actions:
    *   **Edit Notes:** Add custom notes to any equipment item. Notes can be dragged on the canvas for repositioning.
    *   **Fill with Blanking Plates:** Automatically populate empty U-spaces in a rack with appropriate blanking panels.
    *   **Duplicate:** Quickly duplicate selected equipment vertically (up or down).
*   **Save & Load Layouts:** Save your designs with custom filenames and load them back later. Unsaved changes are detected before closing the browser.
*   **Export Options:** Export your rack layouts to:
    *   **PDF:** Generate a multi-page PDF document, with each rack on a separate page, including equipment details and notes in a separate column.
    *   **Image (PNG):** Export a high-resolution image of your entire layout.
*   **Intuitive Navigation:** Pan across the canvas with Shift + Left-click or Middle-click, and zoom in/out with the mouse wheel or dedicated buttons.
*   **Responsive Design:** Adapts to different screen sizes, with zoom-to-fit functionality.
*   **Theme Switching:** Toggle between light and dark themes.

## 📁 Project Structure

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

## 🖥️ Usage

1.  **Adding Equipment:**
    *   On the left sidebar, browse through equipment categories.
    *   **Drag-and-drop** items from the list onto the rack canvas.
    *   Standard equipment (servers, switches, etc.) snaps to the nearest available U-slot.
    *   Vertical PDUs snap to the left or right rail.
    *   Shelf items can be placed on compatible "shelf" units (e.g., a "1U Shelf" equipment item).

2.  **Interacting with Items:**
    *   **Select:** Click on an item to select it. Hold `Ctrl` (or `Cmd` on Mac) and click to select multiple items.
    *   **Move:** Drag selected items to new positions.
    *   **Delete:** Select an item (or multiple) and press `Delete` or `Backspace`.
    *   **Context Menu:** Right-click on an item or empty rack space to open a context-specific menu for actions like `Edit Notes...`, `Fill with Blanking Plates`, or `Duplicate`.
    *   **Edit Notes:** When an item is selected, its details (including notes) appear in the right-hand info panel. You can type notes there or double click the note box on canvas to reposition it.

3.  **Rack Controls (bottom-right):**
    *   **Rack Navigation:** Use `◀` and `▶` to switch between racks when in single-rack view.
    *   **Rack Name:** Click to rename the current rack (single-rack view) or double-click directly on the name (multi-rack view).
    *   **Toggle Layout View (`🔲` / `🔳`):** Switch between viewing a single active rack and an overview of all racks.
    *   **Add Rack (`+`):** Add a new empty rack.
    *   **Delete Rack (`🗑️`):** Delete the current active rack.

4.  **Sidebar Controls (bottom-left):**
    *   **Size:** Change the U-height of the currently active rack.
    *   **View:** Toggle between **Show Front** and **Show Rear** views of the equipment.
    *   **Zoom:** Adjust the canvas zoom level, including a "Fit" option to fit the entire layout on screen.
    *   **Save:** Saves the current layout. If it's a new layout, it will prompt for a filename. If a file is already loaded, it will overwrite it.
    *   **Load:** Opens a modal to load a previously saved layout.
    *   **Reset / New:** Starts a fresh, blank layout (prompts for confirmation if there are unsaved changes).
    *   **Export to PDF:** Generates a PDF of all racks with details.
    *   **Export to Image:** Generates a PNG image of your current layout.

5.  **Info Panel (right sidebar):**
    *   Displays details of the currently selected equipment item.
    *   Allows editing the item's label and notes.
    *   Can be collapsed/expanded using the `Hide Info` / `Show Info` buttons.

6.  **Theme Switcher:**
    *   Located on the bottom-right, allows toggling between Light (☀️) and Dark (🌙) mode.
