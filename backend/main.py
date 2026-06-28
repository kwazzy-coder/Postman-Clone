from __future__ import annotations

import json
import sqlite3
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

APP_DIR = Path(__file__).resolve().parent
DB_PATH = APP_DIR / "data.db"

app = FastAPI(title="Postman Clone API Runner")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]

class KeyValue(BaseModel):
    key: str = Field(default="")
    value: str = Field(default="")

class AuthData(BaseModel):
    type: str = Field(default="none")
    token: str | None = None
    username: str | None = None
    password: str | None = None

class RequestPayload(BaseModel):
    method: str
    url: str
    headers: list[KeyValue] = []
    query: list[KeyValue] = []
    body: str | None = None
    body_type: str | None = None
    auth: AuthData = AuthData()
    environment_id: int | None = None

class SavedCollection(BaseModel):
    name: str

class SavedRequest(BaseModel):
    collection_id: int | None = None
    name: str
    method: str
    url: str
    headers: list[KeyValue] = []
    query: list[KeyValue] = []
    body: str | None = None
    body_type: str | None = None
    auth: AuthData = AuthData()

class EnvironmentModel(BaseModel):
    name: str
    variables: dict[str, str] = {}

class HistoryItem(BaseModel):
    request_data: dict[str, Any]
    response_data: dict[str, Any]

def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db() -> None:
    if DB_PATH.exists():
        return

    with get_db_connection() as conn:
        conn.executescript(
            """
            CREATE TABLE collections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                collection_id INTEGER,
                name TEXT NOT NULL,
                method TEXT NOT NULL,
                url TEXT NOT NULL,
                headers TEXT NOT NULL,
                query TEXT NOT NULL,
                body TEXT,
                body_type TEXT,
                auth_type TEXT NOT NULL,
                auth_data TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(collection_id) REFERENCES collections(id) ON DELETE CASCADE
            );

            CREATE TABLE environments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                variables TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                request_data TEXT NOT NULL,
                response_data TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        seed_data(conn)

def serialize_row(row: sqlite3.Row) -> dict[str, Any]:
    return {k: row[k] for k in row.keys()}

def seed_data(conn: sqlite3.Connection) -> None:
    default_env = {
        "baseUrl": "https://jsonplaceholder.typicode.com",
        "apiKey": "demo-token-123",
    }
    conn.execute(
        "INSERT INTO environments (name, variables) VALUES (?, ?)",
        ("Default", json.dumps(default_env)),
    )
    collection_id = conn.execute(
        "INSERT INTO collections (name) VALUES (?)",
        ("Sample Collection",),
    ).lastrowid

    sample_request = {
        "collection_id": collection_id,
        "name": "List posts",
        "method": "GET",
        "url": "{{baseUrl}}/posts",
        "headers": json.dumps([{"key": "Accept", "value": "application/json"}]),
        "query": json.dumps([]),
        "body": None,
        "body_type": None,
        "auth_type": "none",
        "auth_data": json.dumps({}),
    }
    conn.execute(
        "INSERT INTO requests (collection_id, name, method, url, headers, query, body, body_type, auth_type, auth_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            sample_request["collection_id"],
            sample_request["name"],
            sample_request["method"],
            sample_request["url"],
            sample_request["headers"],
            sample_request["query"],
            sample_request["body"],
            sample_request["body_type"],
            sample_request["auth_type"],
            sample_request["auth_data"],
        ),
    )

    history_item = {
        "request_data": json.dumps({
            "method": "GET",
            "url": "https://jsonplaceholder.typicode.com/posts/1",
            "headers": [{"key": "Accept", "value": "application/json"}],
            "query": [],
            "body": None,
            "body_type": None,
            "auth": {"type": "none"},
        }),
        "response_data": json.dumps({
            "status_code": 200,
            "headers": {"Content-Type": "application/json; charset=utf-8"},
            "body": "{\"id\": 1, \"title\": \"Sample post\"}",
            "duration_ms": 123,
            "size_bytes": 75,
        }),
    }
    conn.execute(
        "INSERT INTO history (request_data, response_data) VALUES (?, ?)",
        (history_item["request_data"], history_item["response_data"]),
    )

@app.on_event("startup")
def startup() -> None:
    init_db()
    with get_db_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS cookies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                domain TEXT NOT NULL,
                path TEXT NOT NULL,
                name TEXT NOT NULL,
                value TEXT,
                expires TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(domain, path, name)
            );
        """)

@app.get("/collections")
def get_collections() -> list[dict[str, Any]]:
    with get_db_connection() as conn:
        rows = conn.execute("SELECT * FROM collections ORDER BY created_at DESC").fetchall()
        return [serialize_row(r) for r in rows]

@app.post("/collections")
def create_collection(collection: SavedCollection) -> dict[str, Any]:
    with get_db_connection() as conn:
        rowid = conn.execute(
            "INSERT INTO collections (name) VALUES (?)",
            (collection.name,),
        ).lastrowid
        return {"id": rowid, "name": collection.name}

@app.put("/collections/{collection_id}")
def update_collection(collection_id: int, collection: SavedCollection) -> dict[str, Any]:
    with get_db_connection() as conn:
        conn.execute(
            "UPDATE collections SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (collection.name, collection_id),
        )
        return {"id": collection_id, "name": collection.name}

@app.delete("/collections/{collection_id}")
def delete_collection(collection_id: int) -> dict[str, Any]:
    with get_db_connection() as conn:
        conn.execute("DELETE FROM collections WHERE id = ?", (collection_id,))
        return {"deleted": True}

@app.get("/collections/{collection_id}/requests")
def get_requests(collection_id: int) -> list[dict[str, Any]]:
    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM requests WHERE collection_id = ? ORDER BY updated_at DESC",
            (collection_id,),
        ).fetchall()
        requests_list: list[dict[str, Any]] = []
        for row in rows:
            item = serialize_row(row)
            item["headers"] = json.loads(item["headers"])
            item["query"] = json.loads(item["query"])
            auth_data = json.loads(item["auth_data"] or "{}")
            item["auth"] = {"type": item["auth_type"], **auth_data}
            requests_list.append(item)
        return requests_list

@app.post("/requests")
def save_request(payload: SavedRequest) -> dict[str, Any]:
    with get_db_connection() as conn:
        rowid = conn.execute(
            "INSERT INTO requests (collection_id, name, method, url, headers, query, body, body_type, auth_type, auth_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                payload.collection_id,
                payload.name,
                payload.method,
                payload.url,
                json.dumps([h.dict() for h in payload.headers]),
                json.dumps([q.dict() for q in payload.query]),
                payload.body,
                payload.body_type,
                payload.auth.type,
                json.dumps(payload.auth.dict(exclude={"type"})),
            ),
        ).lastrowid
        return {"id": rowid, **payload.dict()}

@app.put("/requests/{request_id}")
def update_request(request_id: int, payload: SavedRequest) -> dict[str, Any]:
    with get_db_connection() as conn:
        conn.execute(
            "UPDATE requests SET collection_id = ?, name = ?, method = ?, url = ?, headers = ?, query = ?, body = ?, body_type = ?, auth_type = ?, auth_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (
                payload.collection_id,
                payload.name,
                payload.method,
                payload.url,
                json.dumps([h.dict() for h in payload.headers]),
                json.dumps([q.dict() for q in payload.query]),
                payload.body,
                payload.body_type,
                payload.auth.type,
                json.dumps(payload.auth.dict(exclude={"type"})),
                request_id,
            ),
        )
        return {"id": request_id, **payload.dict()}

@app.delete("/requests/{request_id}")
def delete_request(request_id: int) -> dict[str, Any]:
    with get_db_connection() as conn:
        conn.execute("DELETE FROM requests WHERE id = ?", (request_id,))
        return {"deleted": True}

@app.get("/environments")
def list_environments() -> list[dict[str, Any]]:
    with get_db_connection() as conn:
        rows = conn.execute("SELECT * FROM environments ORDER BY created_at DESC").fetchall()
        envs: list[dict[str, Any]] = []
        for row in rows:
            item = serialize_row(row)
            item["variables"] = json.loads(item["variables"])
            envs.append(item)
        return envs

@app.post("/environments")
def create_environment(environment: EnvironmentModel) -> dict[str, Any]:
    with get_db_connection() as conn:
        rowid = conn.execute(
            "INSERT INTO environments (name, variables) VALUES (?, ?)",
            (environment.name, json.dumps(environment.variables)),
        ).lastrowid
        return {"id": rowid, **environment.dict()}

@app.put("/environments/{environment_id}")
def update_environment(environment_id: int, environment: EnvironmentModel) -> dict[str, Any]:
    with get_db_connection() as conn:
        conn.execute(
            "UPDATE environments SET name = ?, variables = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (environment.name, json.dumps(environment.variables), environment_id),
        )
        return {"id": environment_id, **environment.dict()}

@app.delete("/environments/{environment_id}")
def delete_environment(environment_id: int) -> dict[str, Any]:
    with get_db_connection() as conn:
        conn.execute("DELETE FROM environments WHERE id = ?", (environment_id,))
        return {"deleted": True}

@app.get("/history")
def get_history() -> list[dict[str, Any]]:
    with get_db_connection() as conn:
        rows = conn.execute("SELECT * FROM history ORDER BY created_at DESC").fetchall()
        history_list: list[dict[str, Any]] = []
        for row in rows:
            item = serialize_row(row)
            item["request_data"] = json.loads(item["request_data"])
            item["response_data"] = json.loads(item["response_data"])
            history_list.append(item)
        return history_list

@app.post("/history")
def save_history(item: HistoryItem) -> dict[str, Any]:
    with get_db_connection() as conn:
        rowid = conn.execute(
            "INSERT INTO history (request_data, response_data) VALUES (?, ?)",
            (json.dumps(item.request_data), json.dumps(item.response_data)),
        ).lastrowid
        return {"id": rowid, **item.dict()}

def apply_variables(text: str, variables: dict[str, str]) -> str:
    for key, value in variables.items():
        text = text.replace(f"{{{{{key}}}}}", value)
    return text

@app.post("/send")
def send_request(payload: RequestPayload) -> dict[str, Any]:
    if payload.method not in METHODS:
        raise HTTPException(status_code=400, detail="Invalid HTTP method")

    vars_map: dict[str, str] = {}
    if payload.environment_id is not None:
        with get_db_connection() as conn:
            row = conn.execute("SELECT variables FROM environments WHERE id = ?", (payload.environment_id,)).fetchone()
            if row:
                vars_map = json.loads(row["variables"])

    url = apply_variables(payload.url, vars_map)
    headers = {item.key: apply_variables(item.value, vars_map) for item in payload.headers if item.key}
    params = {item.key: apply_variables(item.value, vars_map) for item in payload.query if item.key}
    body = apply_variables(payload.body, vars_map) if payload.body else None

    auth = None
    if payload.auth.type == "bearer" and payload.auth.token:
        headers["Authorization"] = f"Bearer {apply_variables(payload.auth.token, vars_map)}"
    elif payload.auth.type == "basic" and payload.auth.username is not None and payload.auth.password is not None:
        auth = (payload.auth.username, payload.auth.password)

    req_kwargs: dict[str, Any] = {
        "method": payload.method,
        "url": url,
        "headers": headers,
        "params": params,
        "timeout": 8,
        "auth": auth,
    }

    if body:
        if payload.body_type == "raw":
            is_json = False
            for k, v in headers.items():
                if k.lower() == "content-type" and "application/json" in v.lower():
                    is_json = True
                    break
            if is_json:
                try:
                    req_kwargs["json"] = json.loads(body)
                except ValueError:
                    req_kwargs["data"] = body.encode('utf-8')
            else:
                req_kwargs["data"] = body.encode('utf-8')

        elif payload.body_type in {"form-urlencoded", "x-www-form-urlencoded"}:
            try:
                kv_list = json.loads(body)
                if isinstance(kv_list, list):
                    form_data = {}
                    for item in kv_list:
                        if isinstance(item, dict) and item.get("key"):
                            form_data[item["key"]] = apply_variables(item.get("value", ""), vars_map)
                    req_kwargs["data"] = form_data
                else:
                    req_kwargs["data"] = body
            except ValueError:
                req_kwargs["data"] = body

        elif payload.body_type == "form-data":
            try:
                kv_list = json.loads(body)
                if isinstance(kv_list, list):
                    files_dict = {}
                    for item in kv_list:
                        if isinstance(item, dict) and item.get("key"):
                            files_dict[item["key"]] = (None, apply_variables(item.get("value", ""), vars_map))
                    req_kwargs["files"] = files_dict
                else:
                    req_kwargs["data"] = body
            except ValueError:
                req_kwargs["data"] = body

    # Load cookies from database
    cookie_str = get_cookies_for_url(url)
    if cookie_str:
        if "Cookie" in headers:
            headers["Cookie"] = headers["Cookie"] + "; " + cookie_str
        else:
            headers["Cookie"] = cookie_str

    start = time.time()
    try:
        response = requests.request(**req_kwargs)
        
        # Save received cookies
        import urllib.parse
        try:
            parsed_url = urllib.parse.urlparse(url)
            req_domain = parsed_url.hostname or ""
        except Exception:
            req_domain = ""
            
        for cookie in response.cookies:
            save_cookie_to_db(
                cookie.domain or req_domain,
                cookie.path or "/",
                cookie.name,
                cookie.value,
                cookie.expires
            )

        duration_ms = int((time.time() - start) * 1000)
        resp_headers = dict(response.headers)
        try:
            resp_body = response.json()
        except ValueError:
            resp_body = response.text

        result = {
            "status_code": response.status_code,
            "headers": resp_headers,
            "body": resp_body,
            "duration_ms": duration_ms,
            "size_bytes": len(response.content),
            "is_error": False,
        }
        save_history(HistoryItem(request_data=payload.dict(), response_data=result))
        return result

    except requests.exceptions.RequestException as exc:
        duration_ms = int((time.time() - start) * 1000)
        error_type = type(exc).__name__
        error_msg = str(exc)
        if isinstance(exc, requests.exceptions.Timeout):
            friendly_msg = "The request timed out. The server took too long to respond."
        elif isinstance(exc, requests.exceptions.ConnectionError):
            friendly_msg = "Could not send request. Verify the URL, your internet connection, or local network status."
        elif isinstance(exc, requests.exceptions.SSLError):
            friendly_msg = "SSL Verification failed. The server's certificate is invalid or untrusted."
        else:
            friendly_msg = f"An error occurred: {error_msg}"

        result = {
            "status_code": 0,
            "headers": {},
            "body": {
                "error": {
                    "type": error_type,
                    "message": friendly_msg,
                    "details": error_msg
                }
            },
            "duration_ms": duration_ms,
            "size_bytes": 0,
            "is_error": True,
        }
        save_history(HistoryItem(request_data=payload.dict(), response_data=result))
        return result


class CookieModel(BaseModel):
    domain: str
    path: str = "/"
    name: str
    value: str
    expires: str | None = None

def save_cookie_to_db(domain: str, path: str, name: str, value: str, expires: str | None) -> None:
    with get_db_connection() as conn:
        conn.execute(
            """
            INSERT INTO cookies (domain, path, name, value, expires)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(domain, path, name) DO UPDATE SET value=excluded.value, expires=excluded.expires
            """,
            (domain, path, name, value, str(expires) if expires else None)
        )

def get_cookies_for_url(url: str) -> str:
    import urllib.parse
    try:
        parsed = urllib.parse.urlparse(url)
        domain = parsed.hostname or ""
        path = parsed.path or "/"
    except Exception:
        return ""
    
    if not domain:
        return ""
        
    matching_cookies = []
    with get_db_connection() as conn:
        rows = conn.execute("SELECT * FROM cookies").fetchall()
        for r in rows:
            c_domain = r["domain"]
            c_path = r["path"]
            
            domain_match = False
            if c_domain.startswith('.'):
                if domain.endswith(c_domain) or domain == c_domain[1:]:
                    domain_match = True
            else:
                if domain == c_domain:
                    domain_match = True
                    
            path_match = path.startswith(c_path)
            
            if domain_match and path_match:
                matching_cookies.append(f"{r['name']}={r['value']}")
                
    return "; ".join(matching_cookies)

@app.get("/cookies")
def get_all_cookies():
    with get_db_connection() as conn:
        rows = conn.execute("SELECT * FROM cookies ORDER BY domain, name").fetchall()
        return [serialize_row(r) for r in rows]

@app.post("/cookies")
def add_or_update_cookie(cookie: CookieModel):
    try:
        save_cookie_to_db(cookie.domain, cookie.path, cookie.name, cookie.value, cookie.expires)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/cookies/{cookie_id}")
def delete_cookie(cookie_id: int):
    with get_db_connection() as conn:
        conn.execute("DELETE FROM cookies WHERE id = ?", (cookie_id,))
        return {"deleted": True}

