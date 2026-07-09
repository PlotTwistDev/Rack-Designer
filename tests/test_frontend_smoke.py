import shutil
import subprocess
from pathlib import Path

import app1


ROOT = Path(__file__).resolve().parents[1]


def test_index_contains_json_import_export_and_backup_controls():
    app1.app.config.update(TESTING=True)
    with app1.app.test_client() as client:
        response = client.get("/")

    assert response.status_code == 200
    html = response.get_data(as_text=True)
    for element_id in [
        "export-json-btn",
        "import-json-btn",
        "import-json-input",
        "backup-file-list",
        "restore-backup-btn",
    ]:
        assert f'id="{element_id}"' in html


def test_javascript_files_pass_node_syntax_check():
    node = shutil.which("node")
    if not node:
        return

    for script in (ROOT / "static" / "js").glob("*.js"):
        result = subprocess.run([node, "--check", str(script)], cwd=ROOT, text=True, capture_output=True)
        assert result.returncode == 0, result.stderr or result.stdout
