from __future__ import annotations

import base64
import json
import math
import re
import secrets
import sqlite3
from datetime import UTC, datetime
from typing import Any

from flask import Flask, current_app, g, jsonify, request
from werkzeug.exceptions import BadRequest, HTTPException, RequestEntityTooLarge, UnsupportedMediaType

from .capabilities import capability_payload
from .capabilities.audio import analyze_samples
from .capabilities.mapping import openstreetmap_config
from .capabilities.ml import run_kmeans, sklearn_status
from .capabilities.optimization import nearest_neighbor_route
from .capabilities.search import search_records
from .config import scoped_path
from .db import database_readiness, fetch_sample_nodes, get_app_state, get_db, insert_sample_node, set_app_state
from .llm import CourseLLMError, chat

HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
SLUG_RE = re.compile(r"^[a-z0-9-]{3,40}$")
MAX_LABEL_LENGTH = 120
MAX_DESCRIPTION_LENGTH = 2_000
MAX_SEARCH_QUERY_LENGTH = 200
MAX_PHOTO_BYTES = 12 * 1_048_576
PLANNER_KEY = "fridge-planner"
DEFAULT_PREFERENCES = {
    "dietaryRestrictions": "",
    "allergies": "",
    "preferredCuisines": "",
    "dislikedIngredients": "",
    "notes": "",
}


def _clean_text(value: object, limit: int) -> str:
    return str(value).strip()[:limit]


def _starter_plan(seed_ingredients: list[str]) -> dict[str, Any]:
    ingredients: list[str] = []
    for item in seed_ingredients:
        text = _clean_text(item, 60)
        if text and text not in ingredients:
            ingredients.append(text)

    if not ingredients:
        ingredients = ["eggs", "spinach", "tomatoes", "cheddar"]

    core = (ingredients + ingredients[:4])[:4]
    day_names = ["Mon", "Tue", "Wed", "Thu"]
    recipes = [
        {
            "day": day_names[index],
            "title": f"{core[index % len(core)].title()} {suffix}",
            "description": description.format(ingredient=core[index % len(core)]),
            "time": time,
        }
        for index, (suffix, description, time) in enumerate(
            [
                ("Breakfast Hash", "A quick skillet using {ingredient} and pantry basics.", "20 min"),
                ("Lunch Bowl", "A flexible bowl built around {ingredient} and fresh greens.", "25 min"),
                ("Dinner Bake", "A warm bake that stretches {ingredient} into a full meal.", "35 min"),
                ("Snacks", "An easy snack or side that helps use up {ingredient}.", "10 min"),
            ]
        )
    ]
    recipes = _rank_recipes(recipes, ingredients)
    shopping_list = [
        {"name": "olive oil", "amount": "1 bottle", "checked": False},
        {"name": "onion", "amount": "2", "checked": False},
        {"name": "garlic", "amount": "1 bulb", "checked": False},
        {"name": "bread", "amount": "1 loaf", "checked": False},
    ]
    return {
        "ingredients": ingredients[:12],
        "inventory": [{"name": item, "quantity": "", "category": "Fridge"} for item in ingredients[:12]],
        "recipes": recipes[:4],
        "shoppingList": shopping_list,
        "mealPlan": {},
    }


def _image_data_url(raw: bytes, mimetype: str) -> str:
    encoded = base64.b64encode(raw).decode("ascii")
    return f"data:{mimetype};base64,{encoded}"


def _json_text(response_text: str) -> dict[str, Any]:
    stripped = response_text.strip()
    stripped = re.sub(r"<think>.*?</think>", "", stripped, flags=re.IGNORECASE | re.DOTALL).strip()
    if stripped.startswith("```"):
        stripped = stripped.split("\n", 1)[1] if "\n" in stripped else ""
        stripped = stripped.rsplit("```", 1)[0].strip()
    if not stripped:
        raise ValueError("LLM response was empty.")
    try:
        payload = json.loads(stripped)
    except json.JSONDecodeError:
        # Reasoning models occasionally add a short preamble despite the JSON-only instruction.
        start = stripped.find("{")
        if start < 0:
            raise
        payload, _ = json.JSONDecoder().raw_decode(stripped[start:])
    if not isinstance(payload, dict):
        raise ValueError("LLM response must be a JSON object.")
    return payload


def _rank_recipes(recipes: list[dict[str, Any]], ingredients: list[str]) -> list[dict[str, Any]]:
    available = {word for item in ingredients for word in re.findall(r"[a-z0-9]+", item.lower())}
    ranked: list[dict[str, Any]] = []
    for recipe in recipes:
        haystack = " ".join(str(recipe.get(key, "")) for key in ("title", "description", "matchedIngredients"))
        matched = sorted({item for item in ingredients if any(word in available and word in haystack.lower() for word in re.findall(r"[a-z0-9]+", item.lower()))})
        score = round(min(98, 42 + (len(matched) / max(len(ingredients), 1)) * 56))
        ranked.append({**recipe, "matchScore": int(recipe.get("matchScore") or score), "matchedIngredients": matched})
    return sorted(ranked, key=lambda item: item["matchScore"], reverse=True)


def _normalize_inventory(raw_inventory: object, ingredients: list[str]) -> list[dict[str, str]]:
    source = raw_inventory if isinstance(raw_inventory, list) else ingredients
    inventory: list[dict[str, str]] = []
    for item in source[:40]:
        if isinstance(item, dict):
            name = item.get("name") or item.get("ingredient") or item.get("label") or ""
            quantity = item.get("quantity") or item.get("amount") or ""
            category = item.get("category") or "Fridge"
        else:
            name, quantity, category = item, "", "Fridge"
        clean_name = _clean_text(name, 60)
        if clean_name and not any(existing["name"].lower() == clean_name.lower() for existing in inventory):
            inventory.append({"name": clean_name, "quantity": _clean_text(quantity, 30), "category": _clean_text(category, 24) or "Fridge"})
    return inventory[:40]


DEFAULT_PLAN = _starter_plan(["eggs", "spinach", "tomatoes", "cheddar"])


def _normalize_plan(payload: dict[str, Any]) -> dict[str, Any]:
    if "plan" in payload and isinstance(payload["plan"], dict):
        payload = payload["plan"]

    raw_ingredients = payload.get("ingredients", [])
    if not isinstance(raw_ingredients, list):
        raise ValueError("ingredients must be a list.")
    ingredients: list[str] = []
    for item in raw_ingredients:
        if isinstance(item, dict):
            item = item.get("name") or item.get("ingredient") or item.get("label") or ""
        text = _clean_text(item, 60)
        if text and text not in ingredients:
            ingredients.append(text)
    if not ingredients:
        raise ValueError("ingredients must not be empty.")

    raw_recipes = payload.get("recipes", [])
    if not isinstance(raw_recipes, list):
        raise ValueError("recipes must be a list.")
    recipes: list[dict[str, Any]] = []
    day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    for index, recipe in enumerate(raw_recipes[:7]):
        if not isinstance(recipe, dict):
            continue
        normalized: dict[str, Any] = {
                "day": _clean_text(recipe.get("day") or day_names[index % len(day_names)], 24),
                "title": _clean_text(recipe.get("title") or f"Recipe {index + 1}", 80),
                "description": _clean_text(
                    recipe.get("description") or "A practical meal based on the fridge scan.",
                    220,
                ),
                "time": _clean_text(recipe.get("time") or "30 min", 24),
            }
        if isinstance(recipe.get("ingredients"), list):
            normalized["ingredients"] = [_clean_text(item, 80) for item in recipe["ingredients"] if str(item).strip()][:12]
        if isinstance(recipe.get("steps"), list):
            normalized["steps"] = [_clean_text(item, 220) for item in recipe["steps"] if str(item).strip()][:8]
        recipes.append(normalized)
    if not recipes:
        raise ValueError("recipes must not be empty.")

    raw_shopping = payload.get("shoppingList", [])
    if not isinstance(raw_shopping, list):
        raise ValueError("shoppingList must be a list.")
    shopping_list: list[dict[str, Any]] = []
    for item in raw_shopping[:12]:
        if isinstance(item, dict):
            name = item.get("name") or item.get("item") or item.get("label") or ""
            amount = item.get("amount") or item.get("quantity") or ""
            checked = bool(item.get("checked", False))
        else:
            name = item
            amount = ""
            checked = False
        clean_name = _clean_text(name, 80)
        if not clean_name:
            continue
        shopping_list.append(
            {
                "name": clean_name,
                "amount": _clean_text(amount, 40),
                "checked": checked,
            }
        )

    inventory = _normalize_inventory(payload.get("inventory"), ingredients)
    return {
        "ingredients": ingredients[:12],
        "inventory": inventory,
        "recipes": _rank_recipes(recipes[:7], ingredients),
        "shoppingList": shopping_list,
        "mealPlan": _normalize_meal_plan(payload.get("mealPlan")),
    }


def _normalize_preferences(raw: object) -> dict[str, str]:
    source = raw if isinstance(raw, dict) else {}
    return {key: _clean_text(source.get(key, ""), 300) for key in DEFAULT_PREFERENCES}


def _normalize_meal_plan(raw: object) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    return {
        _clean_text(date, 10): _clean_text(title, 80)
        for date, title in list(raw.items())[:31]
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(date)) and _clean_text(title, 80)
    }


def _preference_terms(value: str) -> list[str]:
    return [term.strip().lower() for term in re.split(r",|\n|;", value) if term.strip()]


def _remove_restricted_recipes(plan: dict[str, Any], preferences: dict[str, str]) -> dict[str, Any]:
    excluded = _preference_terms(preferences["allergies"] + "," + preferences["dislikedIngredients"])
    if not excluded:
        return plan
    safe_recipes = []
    for recipe in plan["recipes"]:
        text = " ".join(str(recipe.get(key, "")) for key in ("title", "description", "ingredients", "steps")).lower()
        if not any(term in text for term in excluded):
            safe_recipes.append(recipe)
    if not safe_recipes:
        raise ValueError("No safe recipes matched your current exclusions.")
    plan["recipes"] = safe_recipes
    return plan


def _vision_plan(raw: bytes, mimetype: str, preferences: dict[str, str]) -> dict[str, Any]:
    preference_note = "; ".join(f"{key}: {value}" for key, value in preferences.items() if value) or "No dietary preferences provided."
    prompt = (
        "Read this fridge photo and return one JSON object only. "
        "Use keys ingredients, recipes, and shoppingList. "
        "ingredients must be a short list of visible ingredients. "
        "recipes must be 3 to 5 practical meals using those ingredients, ranked best first. "
        "Each recipe should include day, title, description, time, ingredients (a list), and steps (a list). "
        "Also include matchScore (0-100) and matchedIngredients. "
        "shoppingList must list any missing basics as objects with name, amount, and checked false. "
        "Do not include markdown or extra commentary. "
        f"Follow these user preferences exactly: {preference_note} "
        "Never include an allergy in a recipe, even as an optional ingredient or garnish."
    )
    response_text = chat(
        [
            {"role": "system", "content": "You plan meals from fridge photos and reply with JSON only."},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": _image_data_url(raw, mimetype), "detail": "high"},
                    },
                ],
            },
        ]
    )
    return _remove_restricted_recipes(_normalize_plan(_json_text(response_text)), preferences)


def _health_payload() -> dict[str, Any]:
    return {
        "status": "ok",
        "serverTime": datetime.now(UTC).isoformat(),
    }


def _bootstrap_payload() -> dict[str, Any]:
    return {
        "app": {
            "name": current_app.config["APP_NAME"],
            "tagline": current_app.config["APP_TAGLINE"],
            "mode": "public",
            "shell": current_app.config["APP_SHELL"],
            "shellLabel": current_app.config["APP_SHELL_LABEL"],
        },
        "health": _health_payload(),
        "availableShells": current_app.config["AVAILABLE_SHELLS"],
    }


def _api_root() -> str:
    return scoped_path(current_app.config["URL_PREFIX"], "api").rstrip("/")


def _is_json_surface() -> bool:
    api_root = _api_root()
    return (
        request.path == api_root
        or request.path.startswith(f"{api_root}/")
        or request.path.endswith("/healthz")
        or request.path.endswith("/readyz")
        or request.path in {"/healthz", "/readyz"}
    )


def _error_response(message: str, status: int):
    return jsonify({"errors": [message], "requestId": getattr(g, "request_id", None)}), status


def _json_object() -> tuple[dict[str, Any] | None, tuple[Any, int] | None]:
    if not request.is_json:
        return None, _error_response("Content-Type must be application/json", 415)
    try:
        payload = request.get_json(silent=False)
    except (BadRequest, UnsupportedMediaType):
        return None, _error_response("Request body must contain valid JSON", 400)
    if not isinstance(payload, dict):
        return None, _error_response("JSON request body must be an object", 400)
    return payload, None


def _finite_number(payload: dict[str, Any], key: str, default: float) -> float:
    value = float(payload.get(key, default))
    if not math.isfinite(value):
        raise ValueError(f"{key} must be finite")
    return value


def _normalize_payload(payload: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    errors: list[str] = []
    raw_slug = payload.get("slug", "")
    raw_label = payload.get("label", "")
    raw_description = payload.get("description", "")
    raw_color = payload.get("accent_color", "#72d1c2")

    for name, value in (
        ("slug", raw_slug),
        ("label", raw_label),
        ("description", raw_description),
        ("accent_color", raw_color),
    ):
        if not isinstance(value, str):
            errors.append(f"{name} must be a string")

    cleaned = {
        "slug": raw_slug.strip() if isinstance(raw_slug, str) else "",
        "label": raw_label.strip() if isinstance(raw_label, str) else "",
        "description": raw_description.strip() if isinstance(raw_description, str) else "",
        "accent_color": raw_color.strip() if isinstance(raw_color, str) else "",
    }
    cleaned["description"] = cleaned["description"] or "Created through the sample API."

    if not SLUG_RE.fullmatch(cleaned["slug"]):
        errors.append("slug must be 3-40 characters of lowercase letters, digits, or hyphens")
    if len(cleaned["label"]) < 2 or len(cleaned["label"]) > MAX_LABEL_LENGTH:
        errors.append(f"label must be 2-{MAX_LABEL_LENGTH} characters")
    if len(cleaned["description"]) > MAX_DESCRIPTION_LENGTH:
        errors.append(f"description must be at most {MAX_DESCRIPTION_LENGTH} characters")
    if not HEX_COLOR_RE.fullmatch(cleaned["accent_color"]):
        errors.append("accent_color must be a 6-digit hex color like #72d1c2")

    try:
        cleaned["x"] = min(0.92, max(0.08, _finite_number(payload, "x", 0.5)))
        cleaned["y"] = min(0.92, max(0.08, _finite_number(payload, "y", 0.5)))
        cleaned["radius"] = min(0.2, max(0.06, _finite_number(payload, "radius", 0.11)))
    except (TypeError, ValueError, OverflowError):
        errors.append("x, y, and radius must be finite numbers")

    return cleaned, errors


def register_api_routes(app: Flask) -> None:
    prefix = app.config["URL_PREFIX"]
    enabled_features = frozenset(app.config["ENABLED_FEATURES"])

    @app.before_request
    def assign_request_id():
        g.request_id = secrets.token_hex(8)

    @app.after_request
    def harden_response(response):
        response.headers.setdefault("X-Request-ID", getattr(g, "request_id", ""))
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
        return response

    @app.errorhandler(RequestEntityTooLarge)
    def request_too_large(_: RequestEntityTooLarge):
        if _is_json_surface():
            return _error_response("Request body is too large", 413)
        return "Request body is too large", 413

    @app.errorhandler(HTTPException)
    def http_error(error: HTTPException):
        if _is_json_surface():
            return _error_response(error.description or error.name, error.code or 500)
        return error

    @app.errorhandler(Exception)
    def unexpected_error(error: Exception):
        current_app.logger.exception("Unhandled request error")
        if _is_json_surface():
            return _error_response("The server could not complete the request", 500)
        return "The server could not complete the request", 500

    @app.get(scoped_path(prefix, "healthz"))
    def healthz():
        return jsonify(_health_payload())

    @app.get(scoped_path(prefix, "readyz"))
    def readyz():
        ready, detail = database_readiness(current_app.config)
        return jsonify({"status": "ready" if ready else "not-ready", **detail}), 200 if ready else 503

    @app.get(scoped_path(prefix, "api/bootstrap"))
    def bootstrap():
        return jsonify(_bootstrap_payload())

    @app.get(scoped_path(prefix, "api/fridge/state"))
    def fridge_state():
        state = get_app_state(get_db(), PLANNER_KEY, DEFAULT_PLAN)
        state.setdefault("preferences", DEFAULT_PREFERENCES.copy())
        state.setdefault("mealPlan", {})
        return jsonify(state)

    @app.put(scoped_path(prefix, "api/fridge/state"))
    def update_fridge_state():
        payload, error = _json_object()
        if error:
            return error
        plan = {
            "ingredients": [str(item).strip()[:60] for item in payload.get("ingredients", []) if str(item).strip()][:40],
            "inventory": _normalize_inventory(payload.get("inventory"), [str(item).strip() for item in payload.get("ingredients", []) if str(item).strip()][:40]),
            "recipes": payload.get("recipes", [])[:7] if isinstance(payload.get("recipes", []), list) else [],
            "shoppingList": payload.get("shoppingList", [])[:30] if isinstance(payload.get("shoppingList", []), list) else [],
            "mealPlan": _normalize_meal_plan(payload.get("mealPlan")),
            "preferences": _normalize_preferences(payload.get("preferences")),
        }
        plan["recipes"] = _rank_recipes(plan["recipes"], plan["ingredients"])
        set_app_state(get_db(), PLANNER_KEY, plan)
        return jsonify(plan)

    @app.post(scoped_path(prefix, "api/fridge/analyze"))
    def analyze_fridge():
        photo = request.files.get("photo")
        if photo is None or not photo.filename:
            return _error_response("Please choose a fridge photo first", 400)
        if photo.mimetype not in {"image/jpeg", "image/png", "image/webp"}:
            return _error_response("Please upload a JPG, PNG, or WebP image", 415)
        raw = photo.read(MAX_PHOTO_BYTES + 1)
        if len(raw) > MAX_PHOTO_BYTES:
            return _error_response("That image is larger than 12 MB", 413)
        ai_used = False
        try:
            existing = get_app_state(get_db(), PLANNER_KEY, DEFAULT_PLAN)
            preferences = _normalize_preferences(existing.get("preferences"))
            plan = _vision_plan(raw, photo.mimetype, preferences)
            plan["preferences"] = preferences
            ai_used = True
        except (CourseLLMError, ValueError, json.JSONDecodeError) as error:
            plan = _starter_plan(["eggs", "spinach", "tomatoes", "cheddar"])
            plan["preferences"] = preferences
            fallback_reason = str(error)
        else:
            fallback_reason = None
        set_app_state(get_db(), PLANNER_KEY, plan)
        response = {"plan": plan, "aiUsed": ai_used}
        if fallback_reason:
            response["fallbackReason"] = fallback_reason
        return jsonify(response)

    @app.get(scoped_path(prefix, "api/capabilities"))
    def capabilities():
        api_base = scoped_path(prefix, "api").rstrip("/")
        return jsonify(capability_payload(api_base, enabled_features))

    if "search" in enabled_features:
        @app.get(scoped_path(prefix, "api/search"))
        def search():
            query = request.args.get("q", "")
            if len(query) > MAX_SEARCH_QUERY_LENGTH:
                return _error_response(f"q must be at most {MAX_SEARCH_QUERY_LENGTH} characters", 400)
            return jsonify(search_records(get_db(), query))

    if "mapping" in enabled_features:
        @app.get(scoped_path(prefix, "api/map/default"))
        def map_default():
            return jsonify(openstreetmap_config())

    if "machine-learning" in enabled_features:
        @app.get(scoped_path(prefix, "api/ml/status"))
        def ml_status():
            return jsonify(sklearn_status())

        @app.post(scoped_path(prefix, "api/ml/kmeans"))
        def ml_kmeans():
            payload, error = _json_object()
            if error:
                return error
            result, errors, status = run_kmeans(payload)
            if errors:
                return jsonify({"errors": errors, "requestId": g.request_id, **result}), status
            return jsonify(result)

    if "optimization" in enabled_features:
        @app.post(scoped_path(prefix, "api/optimize/route"))
        def optimize_route():
            payload, error = _json_object()
            if error:
                return error
            result, errors = nearest_neighbor_route(payload)
            if errors:
                return jsonify({"errors": errors, "requestId": g.request_id}), 400
            return jsonify(result)

    if "audio" in enabled_features:
        @app.post(scoped_path(prefix, "api/audio/analyze"))
        def audio_analyze():
            payload, error = _json_object()
            if error:
                return error
            result, errors = analyze_samples(payload)
            if errors:
                return jsonify({"errors": errors, "requestId": g.request_id}), 400
            return jsonify(result)

    if "sample-nodes" in enabled_features:
        @app.route(scoped_path(prefix, "api/sample-nodes"), methods=["GET", "POST"])
        def sample_nodes():
            connection = get_db()
            if request.method == "GET":
                return jsonify({"sampleNodes": fetch_sample_nodes(connection)})

            payload, error = _json_object()
            if error:
                return error
            cleaned, errors = _normalize_payload(payload)
            if errors:
                return jsonify({"errors": errors, "requestId": g.request_id}), 400

            try:
                record = insert_sample_node(connection, cleaned)
            except sqlite3.IntegrityError:
                return jsonify({"errors": ["slug already exists"], "requestId": g.request_id}), 409
            except sqlite3.OperationalError:
                current_app.logger.exception("Database write remained unavailable after retries")
                return _error_response("Database is temporarily busy; retry shortly", 503)

            return jsonify({"sampleNode": record}), 201

    @app.route(
        scoped_path(prefix, "api/<path:unmatched_path>"),
        methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    )
    def unknown_api_route(unmatched_path: str):
        return _error_response(f"Unknown or disabled API route: {unmatched_path}", 404)
