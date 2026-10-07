# Revit MCP Bridge

HTTP bridge that runs inside Revit via pyRevit. It accepts requests from the
revit-mcp runtime and executes Revit API calls on the UI thread.

## Requirements

- Revit 2024 or later
- pyRevit 4.8 or later (<https://github.com/eirannejad/pyRevit>)

## Installation

1. Install pyRevit following the official instructions.
2. Find your pyRevit extension folder:
   ```powershell
   pyrevit extensions
   ```
3. Copy this `bridge/` folder to the pyRevit extensions directory.
4. Restart Revit.

## Usage

1. Open Revit after the extension is installed or synced.
2. pyRevit loads the extension-root `startup.py` under CPython and exposes
   the bridge runtime to RevitGPT.
3. The bridge listens on `http://127.0.0.1:8765` by default.
4. The user-facing start/recovery control belongs to the RevitGPT dockable
   panel Bridge Gate; pyRevit must not expose a separate RevitGPT bridge button.
5. To change the port, set the `REVIT_MCP_PORT` environment variable before
   starting Revit.

The startup script uses `#! python3` because the bridge implementation uses
Python 3 syntax and must not be parsed by the default IronPython engine.

## Endpoints

| Method | Path              | Description                     |
| ------ | ----------------- | ------------------------------- |
| GET    | `/health`         | Health check                    |
| GET    | `/document/active`| Active document metadata        |
| GET    | `/documents`      | List all open documents         |
| GET    | `/views`          | List views                      |
| GET    | `/levels`         | List levels                     |
| POST   | `/elements`       | Filtered element query          |
| POST   | `/element`        | Single element by ID            |
| POST   | `/views`          | List views (with document_id)   |
| POST   | `/levels`         | List levels (with document_id)  |

## Protocol

All responses are JSON with the structure:

```json
{
  "data": <result>
}
```

Error responses:

```json
{
  "error": {
    "message": "Error description",
    "code": 500
  }
}
```

POST requests accept JSON body with parameters.
