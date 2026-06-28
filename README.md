# API Client Platform (Postman Clone) - Fullstack Assignment

A fully functional Postman clone replicating the visual layout, user experience, and request workflows of the original Postman desktop app.

## Tech Stack

*   **Frontend**: Next.js (TypeScript) with Vanilla CSS (styled-jsx) for modular, high-fidelity styling.
*   **Backend**: Python with FastAPI, performing outbound HTTP proxy requests to bypass browser CORS limits.
*   **Database**: SQLite (`backend/data.db`) storing collections, requests, environments, variables, and history.

## Core Features Implemented

1.  **Workspace Layout & Resizable Navigation**:
    *   Left sidebar containing **Collections**, **Environments**, and **History** tabs.
    *   **Drag-to-resize sidebar** (horizontal width) and **drag-to-resize response panel** (vertical split height).
    *   Toglable **Charcoal Dark Mode** and **Slate Light Mode** theme switcher.
2.  **Multi-Tab Request Builder**:
    *   Open and manage multiple independent request tabs simultaneously.
    *   Track request changes with tab **dirty indicators** (dot indicators for unsaved changes).
    *   Close, switch, and add empty tabs seamlessly.
3.  **Bi-directional Query Params Sync**:
    *   Bi-directional sync between the URL string and the Query Parameters table.
    *   Modifying URL query strings updates the key-value table, and modifying the table regenerates the URL string instantly.
4.  **Flexible Headers & Authentication**:
    *   Checkable grid editors for headers and query parameters (enable/disable specific fields).
    *   Authorization tab supporting **None**, **Bearer Token**, and **Basic Auth** (auto-appended at send-time).
5.  **Robust Request Runner & Body Editor**:
    *   Outbound proxy runner supporting GET, POST, PUT, PATCH, DELETE, HEAD, and OPTIONS.
    *   Request body editor supporting **none**, **raw text/JSON**, **form-urlencoded**, and **multipart/form-data**.
    *   Safe JSON parsing for raw bodies with text fallbacks.
6.  **Advanced Response Viewer**:
    *   Metadata display for status code (with colored badges), response duration (ms), and size (KB).
    *   Tabs for **Pretty Response Body** (with custom JSON syntax highlighting), **Raw Response**, **HTML Preview**, and **Response Headers**.
    *   **Graceful Connection Error Handling**: Catch and present descriptive error panels for timeouts, DNS resolution failures, connection refused, or SSL verification issues.
7.  **Environments & Scoped Variables**:
    *   Proper variable manager dialog; manage environments and variables in a key-value grid (no alert prompt boxes).
    *   Dynamic live **Resolved URL preview** rendering variables resolved with the active environment.
8.  **Collections & Request CRUD**:
    *   Create, rename, delete collections (custom modal inputs).
    *   Save request configs directly (calls `PUT` to update saved requests, and `POST` to save new requests).
9.  **Import / Export Collections**:
    *   Export any collection as a **Postman Collection v2.1.0 JSON** file.
    *   Drag or upload Postman Collection JSON files to import collections and requests into SQLite.
10. **Code Snippet Generator**:
    *   Generate code snippets for **cURL**, **Fetch (JS)**, **Python Requests**, and **Node.js (Axios)** from the active request configuration.
11. **Keyboard Shortcuts**:
    *   Global hotkeys: `Ctrl + Enter` to Send the active request, `Ctrl + S` to Save/update requests, and `Alt + T` / `Alt + N` to open a new request tab (bypasses browser conflict).
12. **Cookie Management**:
    *   SQLite-backed cookie store parsing and persisting `Set-Cookie` response headers automatically.
    *   Outbound requests auto-attach matching cookies based on domain path and subdomain wildcards.
    *   Postman-style interactive Cookie Manager interface to add, edit, or delete cookies scoped by domain.

---

## Setup & Running Instructions

### 1. Backend Server
1.  Navigate to the `backend/` directory:
    ```bash
    cd backend
    ```
2.  Activate the virtual environment (Windows):
    ```powershell
    venv\Scripts\activate
    ```
3.  Install dependencies (if not already completed):
    ```bash
    pip install -r requirements.txt
    ```
4.  Start Uvicorn server:
    ```bash
    uvicorn main:app --reload --host 127.0.0.1 --port 8000
    ```

### 2. Frontend Server
1.  Navigate to the `frontend/` directory:
    ```bash
    cd frontend
    ```
2.  Install dependencies (if not already completed):
    ```bash
    npm install
    ```
3.  Start Next.js dev server:
    ```bash
    npm run dev
    ```
4.  Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Database Schema Design

*   **`collections`**:
    *   `id` (INTEGER, Primary Key)
    *   `name` (TEXT, Not Null)
    *   `created_at` (TIMESTAMP, Default Current)
*   **`requests`**:
    *   `id` (INTEGER, Primary Key)
    *   `collection_id` (INTEGER, Foreign Key referencing `collections.id`)
    *   `name` (TEXT, Not Null)
    *   `method` (TEXT, Not Null)
    *   `url` (TEXT, Not Null)
    *   `headers` (TEXT, JSON string)
    *   `query` (TEXT, JSON string)
    *   `body` (TEXT)
    *   `body_type` (TEXT)
    *   `auth_type` (TEXT, Not Null)
    *   `auth_data` (TEXT, JSON string)
    *   `created_at` / `updated_at` (TIMESTAMP)
*   **`environments`**:
    *   `id` (INTEGER, Primary Key)
    *   `name` (TEXT, Not Null)
    *   `variables` (TEXT, JSON string representing Key-Value pairs)
    *   `created_at` / `updated_at` (TIMESTAMP)
*   **`history`**:
    *   `id` (INTEGER, Primary Key)
    *   `request_data` (TEXT, JSON string of sent payload)
    *   `response_data` (TEXT, JSON string of response payload)
    *   `created_at` (TIMESTAMP)
*   **`cookies`**:
    *   `id` (INTEGER, Primary Key)
    *   `domain` (TEXT, Not Null)
    *   `path` (TEXT, Not Null)
    *   `name` (TEXT, Not Null)
    *   `value` (TEXT)
    *   `expires` (TEXT)
    *   `created_at` (TIMESTAMP)
    *   *Constraint*: `UNIQUE(domain, path, name)` (Upserts on conflicts)



---

## Assumptions & Design Decisions
*   The application assumes a default active user context (real user authentication is stubbed / omitted).
*   outbound request headers and params are filtered out when disabled (un-checked) in the tables, allowing easy toggling of headers.
*   Database is seeded automatically on backend startup if it is not already initialized, providing immediate usability.
