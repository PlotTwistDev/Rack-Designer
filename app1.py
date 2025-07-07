from flask import Flask, render_template, request, jsonify
import json
import os

app = Flask(__name__)

# --- CONFIGURATION ---
# Directory for named saves
RACKS_DIR = "racks"
EQUIPMENT_FILE = "equipment.json"
STENCILS_FRONT_FILE = "stencils.json"
STENCILS_REAR_FILE = "stencils-rear.json" # Path to the rear stencils file

# Ensure the racks directory exists on startup
os.makedirs(RACKS_DIR, exist_ok=True)

# Helper to get a safe, full path for layout files
def _get_safe_filepath(filename):
    """
    Constructs a safe file path within RACKS_DIR, ensuring a .json extension
    and preventing directory traversal.
    """
    # Use basename to prevent directory traversal (e.g., attacks like ../../etc/passwd)
    safe_filename = os.path.basename(filename)
    if not safe_filename.endswith(".json"):
        safe_filename += ".json"
    return os.path.join(RACKS_DIR, safe_filename)


@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/equipment", methods=["GET"])
def get_equipment():
    if not os.path.exists(EQUIPMENT_FILE):
        return jsonify([])
    try:
        with open(EQUIPMENT_FILE, "r") as f:
            data = json.load(f)
        return jsonify(data)
    except (IOError, json.JSONDecodeError):
        return jsonify({"error": "Could not load equipment file."}), 500

@app.route("/api/stencils", methods=["GET"])
def get_stencils():
    """This serves the FRONT stencils."""
    if not os.path.exists(STENCILS_FRONT_FILE):
        return jsonify({})
    try:
        with open(STENCILS_FRONT_FILE, "r") as f:
            data = json.load(f)
        return jsonify(data)
    except (IOError, json.JSONDecodeError):
        return jsonify({"error": "Could not load stencils file."}), 500

@app.route("/api/stencils-rear", methods=["GET"])
def get_stencils_rear():
    """This serves the REAR stencils."""
    if not os.path.exists(STENCILS_REAR_FILE):
        return jsonify({})
    try:
        with open(STENCILS_REAR_FILE, "r") as f:
            data = json.load(f)
        return jsonify(data)
    except (IOError, json.JSONDecodeError):
        return jsonify({"error": "Could not load rear stencils file."}), 500

# --- Named Save/Load/Delete Features (Existing routes, no changes needed here) ---

@app.route("/api/layouts", methods=["GET"])
def list_layouts():
    """Returns a list of available named layout files."""
    if not os.path.exists(RACKS_DIR):
        return jsonify([])
    try:
        files = [f.replace('.json', '') for f in os.listdir(RACKS_DIR) if f.endswith('.json')]
        return jsonify(files)
    except IOError:
        return jsonify({"error": "Could not list layouts."}), 500

@app.route("/save_layout/<filename>", methods=["POST"])
def save_named_layout(filename):
    """Saves the current layout to a specified filename."""
    data = request.get_json()
    file_path = _get_safe_filepath(filename)
    try:
        with open(file_path, "w") as f:
            json.dump(data, f, indent=2)
        return jsonify({"status": "ok", "message": f"Layout saved successfully as '{filename}'."})
    except IOError as e:
        return jsonify({"status": "error", "message": f"Failed to save layout '{filename}': {e}"}), 500

@app.route("/load_layout/<filename>", methods=["GET"])
def load_named_layout(filename):
    """Loads a layout from a specified filename."""
    file_path = _get_safe_filepath(filename)
    if not os.path.exists(file_path):
        return jsonify({"status": "error", "message": f"Layout '{filename}' not found."}), 404
    try:
        with open(file_path, "r") as f:
            return jsonify(json.load(f))
    except (IOError, json.JSONDecodeError) as e:
        return jsonify({"status": "error", "message": f"Failed to load layout '{filename}': {e}"}), 500

@app.route("/delete_layout/<filename>", methods=["DELETE"])
def delete_named_layout(filename):
    """Deletes a specified layout file."""
    file_path = _get_safe_filepath(filename)
    if not os.path.exists(file_path):
        return jsonify({"status": "error", "message": f"Layout '{filename}' not found."}), 404
    try:
        os.remove(file_path)
        return jsonify({"status": "ok", "message": f"Layout '{filename}' deleted successfully."})
    except IOError as e:
        return jsonify({"status": "error", "message": f"Failed to delete layout '{filename}': {e}"}), 500

if __name__ == "__main__":
    app.run(debug=True)