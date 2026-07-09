import json
from pathlib import Path

import pytest

import app1


@pytest.fixture()
def client(tmp_path, monkeypatch):
    racks_path = tmp_path / "racks"
    backups_path = racks_path / ".backups"
    racks_path.mkdir()
    backups_path.mkdir()

    monkeypatch.setattr(app1, "RACKS_PATH", racks_path)
    monkeypatch.setattr(app1, "BACKUPS_PATH", backups_path)
    app1.app.config.update(TESTING=True, MAX_CONTENT_LENGTH=1_000_000)

    with app1.app.test_client() as client:
        yield client


def sample_layout(label="Server 1"):
    return {
        "schemaVersion": 1,
        "racks": [
            {
                "name": "Rack A",
                "heightU": 42,
                "equipment": [
                    {
                        "label": label,
                        "type": "server",
                        "stencil": "server-front",
                        "stencilRear": "server-rear",
                        "notes": "Production",
                        "noteOffset": {"x": 10, "y": 20},
                        "y": 1,
                        "u": 2,
                        "__renderCtx": {"transient": True},
                    }
                ],
            }
        ],
    }


def test_save_load_delete_layout_happy_path(client, tmp_path):
    save = client.post("/save_layout/Test Rack", json=sample_layout())
    assert save.status_code == 200
    assert save.get_json()["status"] == "ok"

    saved_path = app1.RACKS_PATH / "Test Rack.json"
    saved_doc = json.loads(saved_path.read_text())
    assert saved_doc["schemaVersion"] == 1
    assert saved_doc["racks"][0]["equipment"][0]["label"] == "Server 1"
    assert "__renderCtx" not in saved_doc["racks"][0]["equipment"][0]

    listing = client.get("/api/layouts")
    assert listing.status_code == 200
    assert listing.get_json() == ["Test Rack"]

    loaded = client.get("/load_layout/Test Rack")
    assert loaded.status_code == 200
    assert loaded.get_json()["schemaVersion"] == 1
    assert loaded.get_json()["racks"][0]["name"] == "Rack A"

    delete = client.delete("/delete_layout/Test Rack")
    assert delete.status_code == 200
    assert not saved_path.exists()
    assert len(list(app1.BACKUPS_PATH.glob("Test Rack.delete.*.json"))) == 1


def test_invalid_filenames_are_rejected(client):
    response = client.post("/save_layout/Bad@Name", json=sample_layout())
    assert response.status_code == 400
    assert response.get_json()["status"] == "error"


def test_cross_origin_writes_are_rejected(client):
    response = client.post(
        "/save_layout/CrossOrigin",
        json=sample_layout(),
        headers={"Origin": "http://evil.example"},
    )
    assert response.status_code == 403
    assert "Cross-origin" in response.get_json()["message"]


def test_invalid_schema_is_rejected(client):
    response = client.post("/save_layout/BadSchema", json={"schemaVersion": 999, "racks": []})
    assert response.status_code == 400
    assert "Unsupported layout schemaVersion" in response.get_json()["message"]


def test_oversized_payload_is_rejected(client):
    app1.app.config["MAX_CONTENT_LENGTH"] = 128
    response = client.post(
        "/save_layout/TooLarge",
        data=json.dumps(sample_layout("x" * 2000)),
        content_type="application/json",
    )
    assert response.status_code == 413
    assert "too large" in response.get_json()["message"].lower()


def test_overwrite_creates_backup_and_restore_works(client):
    first = client.post("/save_layout/Restorable", json=sample_layout("Original"))
    assert first.status_code == 200
    second = client.post("/save_layout/Restorable", json=sample_layout("Updated"))
    assert second.status_code == 200

    backups = client.get("/api/backups").get_json()
    overwrite_backups = [backup for backup in backups if backup["layoutName"] == "Restorable" and backup["reason"] == "overwrite"]
    assert len(overwrite_backups) == 1

    backup_name = overwrite_backups[0]["backupName"]
    restored = client.post(f"/restore_backup/{backup_name}")
    assert restored.status_code == 200

    loaded = client.get("/load_layout/Restorable").get_json()
    assert loaded["racks"][0]["equipment"][0]["label"] == "Original"


def test_legacy_equipment_array_migrates_to_schema_document(client):
    legacy = [
        {
            "label": "Legacy Server",
            "type": "server",
            "stencil": "server-front",
            "y": 1,
            "u": 1,
        }
    ]
    response = client.post("/save_layout/Legacy", json=legacy)
    assert response.status_code == 200

    loaded = client.get("/load_layout/Legacy").get_json()
    assert loaded["schemaVersion"] == 1
    assert loaded["racks"][0]["name"] == "Rack 1"
    assert loaded["racks"][0]["equipment"][0]["label"] == "Legacy Server"
