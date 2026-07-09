from flask import Flask, render_template, request, jsonify
import json
import logging
import os
from pathlib import Path
import re
import shutil
import tempfile
from datetime import datetime, timezone
from urllib.parse import urlparse

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = int(os.environ.get("RACK_DESIGNER_MAX_UPLOAD_BYTES", 1_000_000))
logging.basicConfig(level=os.environ.get("RACK_DESIGNER_LOG_LEVEL", "INFO"))
logger = logging.getLogger("rack_designer")

# --- CONFIGURATION ---
# Directory for named saves
RACKS_DIR = os.environ.get("RACK_DESIGNER_RACKS_DIR", "racks")
EQUIPMENT_FILE = "equipment.json"
STENCILS_FRONT_FILE = "stencils.json"
STENCILS_REAR_FILE = "stencils-rear.json"  # Path to the rear stencils file

# Ensure the racks directory exists on startup
RACKS_PATH = Path(RACKS_DIR).resolve()
RACKS_PATH.mkdir(parents=True, exist_ok=True)
BACKUPS_DIR = os.environ.get("RACK_DESIGNER_BACKUPS_DIR")
BACKUPS_PATH = Path(BACKUPS_DIR).resolve() if BACKUPS_DIR else (RACKS_PATH / ".backups").resolve()
BACKUPS_PATH.mkdir(parents=True, exist_ok=True)

SAFE_FILENAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}\.json$")
SAFE_BACKUP_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}\.(overwrite|delete|restore-overwrite)\.\d{8}T\d{6}Z\.json$")
LOOPBACK_ADDRS = {"127.0.0.1", "::1", "localhost"}
LAYOUT_SCHEMA_VERSION = 1
MAX_RACKS = 50
MAX_ITEMS_PER_RACK = 500
MAX_SHELF_ITEMS_PER_ITEM = 100
MAX_TEXT_LEN = 5000
MAX_LABEL_LEN = 200


def _json_error(message, status=400):
    return jsonify({"status": "error", "message": message}), status


def _log_event(action, **fields):
    safe_fields = {key: str(value) if isinstance(value, Path) else value for key, value in fields.items()}
    logger.info("%s %s", action, json.dumps(safe_fields, sort_keys=True))


@app.errorhandler(413)
def _handle_payload_too_large(_error):
    _log_event("layout_payload_rejected", reason="too_large", remote_addr=request.remote_addr)
    return _json_error("Layout payload is too large.", 413)


@app.after_request
def _set_security_headers(response):
    response.headers.setdefault(
        "Content-Security-Policy",
        "; ".join([
            "default-src 'self'",
            "script-src 'self' https://cdnjs.cloudflare.com",
            "style-src 'self' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com",
            "img-src 'self' data:",
            "connect-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "frame-ancestors 'none'",
        ]),
    )
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    return response


@app.before_request
def _protect_local_and_same_origin_writes():
    """Keep this local-desktop tool from being modified cross-site by default."""
    if os.environ.get("RACK_DESIGNER_ALLOW_REMOTE") != "1":
        remote = request.remote_addr or ""
        if remote not in LOOPBACK_ADDRS:
            return _json_error("Remote access is disabled for this local tool.", 403)

    if request.method in {"POST", "DELETE", "PUT", "PATCH"}:
        origin = request.headers.get("Origin")
        referer = request.headers.get("Referer")
        source = origin or referer
        if source:
            parsed = urlparse(source)
            if parsed.netloc and parsed.netloc != request.host:
                _log_event("write_rejected", reason="cross_origin", remote_addr=request.remote_addr, source=source)
                return _json_error("Cross-origin write requests are not allowed.", 403)


def _layout_document(racks):
    return {"schemaVersion": LAYOUT_SCHEMA_VERSION, "racks": racks}


# Helper to get a safe, full path for layout files
def _get_safe_filepath(filename):
    """
    Constructs a safe file path within RACKS_DIR, ensuring a .json extension
    and preventing directory traversal/symlink escapes.
    """
    safe_filename = os.path.basename((filename or "").strip())
    if not safe_filename.endswith(".json"):
        safe_filename += ".json"
    if not SAFE_FILENAME_RE.fullmatch(safe_filename):
        raise ValueError("Filename must start with a letter or number and contain only letters, numbers, spaces, dots, underscores, or hyphens.")

    candidate = (RACKS_PATH / safe_filename).resolve(strict=False)
    if candidate.parent != RACKS_PATH:
        raise ValueError("Invalid layout path.")
    return candidate


def _get_safe_backup_path(filename):
    safe_filename = os.path.basename((filename or "").strip())
    if not SAFE_BACKUP_RE.fullmatch(safe_filename):
        raise ValueError("Invalid backup filename.")
    candidate = (BACKUPS_PATH / safe_filename).resolve(strict=False)
    if candidate.parent != BACKUPS_PATH:
        raise ValueError("Invalid backup path.")
    return candidate


def _backup_layout_file(file_path, reason):
    if not file_path.exists():
        return None
    BACKUPS_PATH.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = BACKUPS_PATH / f"{file_path.stem}.{reason}.{timestamp}.json"
    shutil.copy2(file_path, backup_path)
    _log_event("layout_backup_created", layout=file_path.stem, backup=backup_path.name, reason=reason)
    return backup_path


def _backup_record(path):
    parts = path.name.rsplit(".", 3)
    if len(parts) != 4:
        return None
    layout_name, reason, timestamp, suffix = parts
    if suffix != "json":
        return None
    return {
        "backupName": path.name,
        "layoutName": layout_name,
        "reason": reason,
        "createdAt": timestamp,
    }


def _clean_string(value, max_len=MAX_TEXT_LEN):
    if value is None:
        return ""
    if not isinstance(value, str):
        value = str(value)
    return value[:max_len]


def _optional_int(value, default=0, minimum=0, maximum=10_000):
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = default
    return max(minimum, min(number, maximum))


def _optional_float(value, default=0.0, minimum=-10_000.0, maximum=10_000.0):
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = default
    return max(minimum, min(number, maximum))


def _clean_note_offset(value):
    if not isinstance(value, dict):
        value = {}
    return {
        "x": _optional_float(value.get("x"), 0.0),
        "y": _optional_float(value.get("y"), 0.0),
    }


def _clean_size(value):
    if not isinstance(value, dict):
        value = {}
    return {
        "width": _optional_float(value.get("width"), 0.0, 0.0, 10_000.0),
        "height": _optional_float(value.get("height"), 0.0, 0.0, 10_000.0),
    }


def _clean_item(raw_item, is_shelf_item=False):
    if not isinstance(raw_item, dict):
        raise ValueError("Each equipment item must be an object.")

    item_type = _clean_string(raw_item.get("type"), MAX_LABEL_LEN)
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,50}", item_type):
        raise ValueError("Equipment item type is invalid.")

    cleaned = {
        "label": _clean_string(raw_item.get("label"), MAX_LABEL_LEN),
        "type": item_type,
        "stencil": _clean_string(raw_item.get("stencil"), MAX_LABEL_LEN),
        "stencilRear": _clean_string(raw_item.get("stencilRear") or raw_item.get("stencil_rear"), MAX_LABEL_LEN),
        "notes": _clean_string(raw_item.get("notes"), MAX_TEXT_LEN),
        "noteOffset": _clean_note_offset(raw_item.get("noteOffset")),
    }

    if is_shelf_item or item_type == "shelf-item":
        cleaned["x"] = _optional_float(raw_item.get("x"), 0.0)
        cleaned["size"] = _clean_size(raw_item.get("size"))
    else:
        cleaned["y"] = _optional_int(raw_item.get("y"), 0, 0, 500)
        if "u" in raw_item:
            cleaned["u"] = _optional_int(raw_item.get("u"), 1, 1, 500)
        if "side" in raw_item:
            cleaned["side"] = _clean_string(raw_item.get("side"), 20)

    shelf_items = raw_item.get("shelfItems") or []
    if not isinstance(shelf_items, list):
        raise ValueError("shelfItems must be an array.")
    if len(shelf_items) > MAX_SHELF_ITEMS_PER_ITEM:
        raise ValueError("Too many shelf items on an equipment item.")
    if shelf_items:
        cleaned["shelfItems"] = [_clean_item(child, is_shelf_item=True) for child in shelf_items]
    elif not is_shelf_item:
        cleaned["shelfItems"] = []

    return cleaned


def _extract_racks_from_payload(data):
    if isinstance(data, dict):
        schema_version = data.get("schemaVersion", 0)
        if schema_version not in (0, LAYOUT_SCHEMA_VERSION):
            raise ValueError(f"Unsupported layout schemaVersion: {schema_version}.")
        data = data.get("racks")

    if not isinstance(data, list):
        raise ValueError("Layout must be an array of racks or a schemaVersion/racks object.")

    # Migrate legacy single-rack files that were stored as an array of equipment items.
    if data and all(isinstance(item, dict) and "type" in item and "equipment" not in item for item in data):
        data = [{"name": "Rack 1", "heightU": 42, "equipment": data}]

    return data


def _validate_layout(data):
    racks = _extract_racks_from_payload(data)
    if len(racks) > MAX_RACKS:
        raise ValueError("Too many racks in layout.")

    cleaned_racks = []
    for index, raw_rack in enumerate(racks, start=1):
        if not isinstance(raw_rack, dict):
            raise ValueError(f"Rack {index} must be an object.")
        equipment = raw_rack.get("equipment") or []
        if not isinstance(equipment, list):
            raise ValueError(f"Rack {index} equipment must be an array.")
        if len(equipment) > MAX_ITEMS_PER_RACK:
            raise ValueError(f"Rack {index} has too many equipment items.")

        cleaned_racks.append({
            "name": _clean_string(raw_rack.get("name") or f"Rack {index}", MAX_LABEL_LEN),
            "heightU": _optional_int(raw_rack.get("heightU"), 42, 1, 500),
            "equipment": [_clean_item(item) for item in equipment],
        })
    return cleaned_racks


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


# --- Named Save/Load/Delete Features ---

@app.route("/api/layouts", methods=["GET"])
def list_layouts():
    """Returns a list of available named layout files."""
    try:
        files = [p.stem for p in RACKS_PATH.iterdir() if p.is_file() and p.suffix == ".json"]
        return jsonify(sorted(files))
    except IOError:
        return jsonify({"error": "Could not list layouts."}), 500


@app.route("/save_layout/<filename>", methods=["POST"])
def save_named_layout(filename):
    """Saves the current layout to a specified filename."""
    if not request.is_json:
        return _json_error("Expected application/json request body.", 415)
    data = request.get_json(silent=True)
    try:
        validated_layout = _validate_layout(data)
        file_path = _get_safe_filepath(filename)
    except ValueError as e:
        _log_event("layout_validation_failed", layout=filename, reason=str(e))
        return _json_error(str(e), 400)

    temp_path = None
    try:
        if file_path.exists():
            _backup_layout_file(file_path, "overwrite")
        with tempfile.NamedTemporaryFile("w", dir=RACKS_PATH, delete=False, encoding="utf-8") as f:
            temp_path = Path(f.name)
            json.dump(_layout_document(validated_layout), f, indent=2)
            f.write("\n")
        os.replace(temp_path, file_path)
        _log_event("layout_saved", layout=file_path.stem, racks=len(validated_layout))
        return jsonify({"status": "ok", "message": f"Layout saved successfully as '{file_path.stem}'."})
    except IOError as e:
        if temp_path and temp_path.exists():
            temp_path.unlink(missing_ok=True)
        return jsonify({"status": "error", "message": f"Failed to save layout '{filename}': {e}"}), 500


@app.route("/load_layout/<filename>", methods=["GET"])
def load_named_layout(filename):
    """Loads a layout from a specified filename."""
    try:
        file_path = _get_safe_filepath(filename)
    except ValueError as e:
        return _json_error(str(e), 400)
    if not file_path.exists():
        return jsonify({"status": "error", "message": f"Layout '{filename}' not found."}), 404
    try:
        with open(file_path, "r") as f:
            validated_layout = _validate_layout(json.load(f))
        _log_event("layout_loaded", layout=file_path.stem, racks=len(validated_layout))
        return jsonify(_layout_document(validated_layout))
    except ValueError as e:
        _log_event("layout_validation_failed", layout=file_path.stem, reason=str(e))
        return _json_error(f"Saved layout is invalid: {e}", 422)
    except (IOError, json.JSONDecodeError) as e:
        return jsonify({"status": "error", "message": f"Failed to load layout '{filename}': {e}"}), 500


@app.route("/delete_layout/<filename>", methods=["DELETE"])
def delete_named_layout(filename):
    """Deletes a specified layout file."""
    try:
        file_path = _get_safe_filepath(filename)
    except ValueError as e:
        return _json_error(str(e), 400)
    if not file_path.exists():
        return jsonify({"status": "error", "message": f"Layout '{filename}' not found."}), 404
    try:
        _backup_layout_file(file_path, "delete")
        file_path.unlink()
        _log_event("layout_deleted", layout=file_path.stem)
        return jsonify({"status": "ok", "message": f"Layout '{file_path.stem}' deleted successfully."})
    except IOError as e:
        return jsonify({"status": "error", "message": f"Failed to delete layout '{filename}': {e}"}), 500


@app.route("/api/backups", methods=["GET"])
def list_backups():
    """Returns recent automatic layout backups."""
    try:
        records = []
        for path in BACKUPS_PATH.iterdir():
            if path.is_file() and SAFE_BACKUP_RE.fullmatch(path.name):
                record = _backup_record(path)
                if record:
                    records.append(record)
        records.sort(key=lambda record: record["createdAt"], reverse=True)
        return jsonify(records)
    except IOError:
        return jsonify({"error": "Could not list backups."}), 500


@app.route("/restore_backup/<backup_filename>", methods=["POST"])
def restore_backup(backup_filename):
    """Restores a backup to its original layout filename."""
    try:
        backup_path = _get_safe_backup_path(backup_filename)
    except ValueError as e:
        return _json_error(str(e), 400)
    if not backup_path.exists():
        return jsonify({"status": "error", "message": f"Backup '{backup_filename}' not found."}), 404

    record = _backup_record(backup_path)
    if not record:
        return _json_error("Invalid backup record.", 400)
    destination = _get_safe_filepath(record["layoutName"])

    try:
        with open(backup_path, "r", encoding="utf-8") as f:
            validated_layout = _validate_layout(json.load(f))
        if destination.exists():
            _backup_layout_file(destination, "restore-overwrite")
        with tempfile.NamedTemporaryFile("w", dir=RACKS_PATH, delete=False, encoding="utf-8") as f:
            temp_path = Path(f.name)
            json.dump(_layout_document(validated_layout), f, indent=2)
            f.write("\n")
        os.replace(temp_path, destination)
        _log_event("layout_backup_restored", backup=backup_path.name, layout=destination.stem)
        return jsonify({"status": "ok", "message": f"Backup restored as '{destination.stem}'.", "layoutName": destination.stem})
    except ValueError as e:
        _log_event("layout_validation_failed", backup=backup_path.name, reason=str(e))
        return _json_error(f"Backup layout is invalid: {e}", 422)
    except (IOError, json.JSONDecodeError) as e:
        return jsonify({"status": "error", "message": f"Failed to restore backup '{backup_filename}': {e}"}), 500


if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "").lower() in {"1", "true", "yes"}
    app.run(host="127.0.0.1", debug=debug)
