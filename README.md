# Fridgeful

Fridgeful is an AI-assisted meal-planning web app. It helps people turn the
food they already have into practical recipes, a weekly meal calendar, and a
focused shopping list.

## What It Does

- Scans a fridge photo with AI vision and identifies likely ingredients and
  quantities.
- Shows scan results immediately on the Scan fridge page.
- Stores a categorized inventory that can be searched, edited, added to, or
  cleared manually.
- Generates recipe suggestions ranked by how well they match the inventory.
- Lets users favorite and rate recipes, view recipe ingredients and steps, and
  generate more ideas.
- Provides a weekly calendar for assigning suggested recipes to days.
- Maintains a categorized shopping list with amounts and check-off items.
- Supports dietary restrictions, allergies, preferred cuisines, disliked
  ingredients, serving size, and planning notes.
- Saves app state through the Flask API and supports light and dark themes.

Fridgeful is designed to reduce food waste and make deciding what to cook
easier. It is not a nutrition, medical, food-safety, or grocery-delivery
service; users should verify AI-generated ingredients, quantities, and recipes.

## Course Context

This project was built for [UBC's AI 100: Introduction to Artificial
Intelligence](https://www.cs.ubc.ca/~kevinlb/teaching/ai100/). The app uses the
course-provided model when its AI environment variables are available. If AI
is unavailable, the backend returns starter recipe content and the interface
explains that fallback.

## Project Structure

- `server/gizmoapp_server/api.py` contains the Flask API, plan normalization,
  persistence, and AI recipe/vision routes.
- `server/gizmoapp_server/db.py` contains SQLite state storage.
- `server/gizmoapp_server/templates/index_text.html` is the Fridgeful app shell.
- `server/gizmoapp_server/static/app/text/main.js` contains the interactive UI.
- `server/gizmoapp_server/static/app/text/styles.css` contains the responsive
  light and dark theme styling.
- `tests/` contains API, routing, and JavaScript checks.

The app uses a build-free frontend: plain HTML, CSS, and JavaScript served by
Flask. It is path-prefix-aware so it can run at the root or under a hosted app
prefix.

## Local Setup

Create the virtual environment and install the pinned server dependencies:

```bash
ALLOW_NETWORK_INSTALL=1 make install
```

Initialize the SQLite database:

```bash
make init-db
```

Run the text shell locally:

```bash
ALLOW_SERVER_RUN=1 make dev-text
```

The default local URL is `http://127.0.0.1:8001/`. Set
`GIZMOAPP_URL_PREFIX=/fridgeful` for a local prefix test.

## AI Configuration

On the AI100 platform, the app reads `GIZMO_LLM_API_KEY`,
`GIZMO_LLM_BASE_URL`, and `GIZMO_LLM_MODEL` from the environment. Do not put
these credentials in frontend code, the database, or committed files. AI calls
are made only after a user scans a photo or requests more recipes.

## Validation

Run the repository checks with:

```bash
make validate
```

Node and a frontend build step are not required.
