# Fridgeful

Fridgeful is an AI-assisted meal-planning app that helps people use the food
they already have before buying more. Users can scan a fridge photo, maintain
an organized ingredient inventory, get recipe suggestions, plan meals for the
week, and manage a categorized shopping list.

## Features

- Scan a JPG, PNG, or WebP fridge photo to identify ingredients and estimate quantities.
- Edit, categorize, search, add, and remove inventory items.
- Generate recipe suggestions ranked against the current inventory.
- Favorite and rate recipes, including their ingredients and preparation steps.
- Assign recipes to days in a weekly meal calendar.
- Add, categorize, check off, and remove shopping-list items.
- Save dietary restrictions, allergies, preferred cuisines, disliked ingredients, serving size, and planning notes.
- Toggle light and dark themes.
- Persist the meal plan and preferences in SQLite.

When the course AI service is available, Fridgeful uses it for fridge-photo
analysis and recipe generation. If it is unavailable, the app reports the
issue and keeps the existing plan usable with starter results.

## Project Structure

- `server/gizmoapp_server/api.py` contains the Fridgeful API and meal-planning logic.
- `server/gizmoapp_server/db.py` provides SQLite persistence.
- `server/gizmoapp_server/templates/index_text.html` defines the public app shell.
- `server/gizmoapp_server/static/app/text/` contains the app's JavaScript and CSS.
- `tests/` contains the API and routing tests.

## Local Development

Create the virtual environment and install the pinned Python dependencies:

```bash
ALLOW_NETWORK_INSTALL=1 make install
```

Initialize the database:

```bash
make init-db
```

Run the text shell locally:

```bash
ALLOW_SERVER_RUN=1 make dev-text
```

The app normally opens at `http://127.0.0.1:8001/`. Set
`GIZMOAPP_URL_PREFIX=/fridgeful` to test it below a URL prefix.

## AI Configuration

The hosted course environment supplies `GIZMO_LLM_API_KEY`,
`GIZMO_LLM_BASE_URL`, and `GIZMO_LLM_MODEL`. Fridgeful accesses the model only
through the bundled server-side helper and only after a user requests a scan
or new recipes. Credentials are never sent to the browser or stored in the
database.

## Validation

Run the repository checks with:

```bash
make validate
```

The project uses Flask, SQLite, and a build-free frontend, so Node and a
frontend bundler are not required.
