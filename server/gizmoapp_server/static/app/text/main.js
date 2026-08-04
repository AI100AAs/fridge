const state = { ingredients: [], inventory: [], recipes: [], shoppingList: [], mealPlan: {}, preferences: { dietaryRestrictions: "", allergies: "", preferredCuisines: "", dislikedIngredients: "", notes: "" } };

function apiBase() { return window.GizmoAppRuntime.readConfig().apiBase; }
async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${apiBase()}${path}`, options);
  } catch (_) {
    throw new Error("The app could not reach its server. Check your connection and try again.");
  }

  const responseText = await response.text();
  let payload;
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch (_) {
    throw new Error(`The server returned an unexpected response (${response.status}). Try again.`);
  }
  if (!response.ok) throw new Error(payload.errors?.[0] || `The server returned an error (${response.status}).`);
  return payload;
}

function render() {
  const list = document.querySelector("#ingredient-list");
  if (!Array.isArray(state.inventory) || !state.inventory.length) state.inventory = state.ingredients.map((name) => ({ name, quantity: "", category: "Fridge" }));
  state.ingredients = state.inventory.map((item) => item.name);
  document.querySelector("#week-count").textContent = state.inventory.length;
  list.innerHTML = state.inventory.length ? state.inventory.map((item, index) => `<span class="ingredient-chip"><span><strong>${escapeHtml(item.name)}</strong>${item.quantity ? `<small>${escapeHtml(item.quantity)}</small>` : ""}</span><button type="button" data-remove="${index}" aria-label="Remove ${escapeHtml(item.name)}">×</button></span>`).join("") : `<div class="empty-copy"><span class="empty-emoji">✦</span><p>Scan your fridge to start your ingredient list.</p></div>`;
  list.querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", () => { state.inventory.splice(Number(button.dataset.remove), 1); state.ingredients = state.inventory.map((item) => item.name); saveState(); render(); }));
   const recipeMarkup = state.recipes.length ? state.recipes.map((recipe, index) => `<article class="recipe-card"><div class="recipe-topline"><span class="recipe-meta">${index === 0 ? "Best match" : `#${index + 1} match`}</span><strong class="match-score">${Number(recipe.matchScore || 0)}%</strong></div><h4>${escapeHtml(recipe.title)}</h4><p>${escapeHtml(recipe.description)}</p><span class="recipe-tag">${escapeHtml(recipe.time || "30 min")}</span>${recipe.matchedIngredients?.length ? `<div class="matched-list">Uses: ${escapeHtml(recipe.matchedIngredients.join(", "))}</div>` : ""}${recipe.ingredients?.length ? `<div class="recipe-details"><strong>Ingredients:</strong> <span>${escapeHtml(recipe.ingredients.join(", "))}</span></div>` : ""}${recipe.steps?.length ? `<ol class="recipe-steps">${recipe.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>` : ""}</article>`).join("") : `<div class="empty-wide">Your personalized recipes will appear here after a scan.</div>`;
   document.querySelector("#recipe-list").innerHTML = recipeMarkup;
   document.querySelector("#recipe-list-large").innerHTML = recipeMarkup;
   document.querySelector("#inventory-list-large").innerHTML = state.inventory.length ? state.inventory.map((item, index) => `<div class="inventory-row"><span class="inventory-icon">${escapeHtml((item.name || "?").slice(0, 1).toUpperCase())}</span><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.quantity || "No amount added")}</span><button type="button" data-remove-large="${index}" aria-label="Remove ${escapeHtml(item.name)}">Remove</button></div>`).join("") : `<div class="empty-wide">Your inventory is empty. Scan your fridge or add an item.</div>`;
   document.querySelectorAll("[data-remove-large]").forEach((button) => button.addEventListener("click", () => { state.inventory.splice(Number(button.dataset.removeLarge), 1); state.ingredients = state.inventory.map((item) => item.name); saveState(); render(); }));
  const shopping = document.querySelector("#shopping-list");
  document.querySelector("#shopping-count").textContent = `${state.shoppingList.length} item${state.shoppingList.length === 1 ? "" : "s"}`;
   const shoppingMarkup = state.shoppingList.length ? state.shoppingList.map((item, index) => `<label class="shopping-item ${item.checked ? "checked" : ""}"><input type="checkbox" data-shop="${index}" ${item.checked ? "checked" : ""}><span>${escapeHtml(item.name)}${item.amount ? ` · ${escapeHtml(item.amount)}` : ""}</span></label>`).join("") : `<span class="muted-label">We’ll only add what your recipes need.</span>`;
   shopping.innerHTML = shoppingMarkup; document.querySelector("#shopping-list-large").innerHTML = shoppingMarkup; document.querySelector("#shopping-count-large").textContent = `${state.shoppingList.length} item${state.shoppingList.length === 1 ? "" : "s"}`;
 document.querySelectorAll("[data-shop]").forEach((input) => input.addEventListener("change", () => { state.shoppingList[Number(input.dataset.shop)].checked = input.checked; saveState(); render(); }));
   renderCalendar();
   const fields = { dietaryRestrictions: "dietary-input", allergies: "allergies-input", preferredCuisines: "cuisines-input", dislikedIngredients: "disliked-input", notes: "notes-input" }; Object.entries(fields).forEach(([key, id]) => { const field = document.getElementById(id); if (field && document.activeElement !== field) field.value = state.preferences?.[key] || ""; });
}
function localDateKey(date) { const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, "0"); const day = String(date.getDate()).padStart(2, "0"); return `${year}-${month}-${day}`; }
function startOfWeek(date) { const copy = new Date(date); copy.setHours(12, 0, 0, 0); copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7)); return copy; }
function renderCalendar() {
  const grid = document.querySelector("#calendar-grid");
  if (!grid) return;
  const start = startOfWeek(new Date());
  const end = new Date(start); end.setDate(start.getDate() + 6);
  document.querySelector("#calendar-range").textContent = `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  const options = state.recipes.length ? state.recipes.map((recipe, index) => `<option value="${index}">${escapeHtml(recipe.title)}</option>`).join("") : `<option value="">Scan your fridge first</option>`;
  grid.innerHTML = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start); date.setDate(start.getDate() + index);
    const key = localDateKey(date); const assigned = state.mealPlan?.[key];
    return `<article class="calendar-day ${localDateKey(new Date()) === key ? "today" : ""}"><div class="calendar-day-heading"><span>${date.toLocaleDateString(undefined, { weekday: "short" })}</span><strong>${date.getDate()}</strong></div><label class="calendar-select-label" for="meal-${key}">Meal</label><select id="meal-${key}" class="meal-select" data-meal-date="${key}"><option value="">No meal planned</option>${options}</select>${assigned ? `<div class="planned-meal"><span>Planned</span><strong>${escapeHtml(assigned)}</strong></div>` : `<p class="calendar-empty">Pick from your recipes</p>`}</article>`;
  }).join("");
  grid.querySelectorAll("[data-meal-date]").forEach((select) => { const assigned = state.mealPlan?.[select.dataset.mealDate]; select.value = assigned ? String(state.recipes.findIndex((recipe) => recipe.title === assigned)) : ""; select.addEventListener("change", () => { const recipe = state.recipes[Number(select.value)]; if (recipe) state.mealPlan[select.dataset.mealDate] = recipe.title; else delete state.mealPlan[select.dataset.mealDate]; saveState(); renderCalendar(); }); });
}
function escapeHtml(value) { const node = document.createElement("span"); node.textContent = value; return node.innerHTML; }
async function saveState() { try { await request("/fridge/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state) }); } catch (_) { /* local UI remains usable if persistence is briefly unavailable */ } }
async function loadState() { try { Object.assign(state, await request("/fridge/state")); render(); } catch (_) { render(); } }

function setupUpload() {
  const form = document.querySelector("#upload-form"); const input = document.querySelector("#fridge-photo"); const zone = document.querySelector(".drop-zone"); const preview = document.querySelector("#preview-wrap"); const image = document.querySelector("#preview-image"); const label = document.querySelector("#file-label"); const status = document.querySelector("#scan-status");
  function showFile(file) { if (!file) return; label.textContent = file.name; image.src = URL.createObjectURL(file); preview.hidden = false; }
  input.addEventListener("change", () => showFile(input.files[0]));
  ["dragenter", "dragover"].forEach((event) => zone.addEventListener(event, (e) => { e.preventDefault(); zone.classList.add("dragging"); }));
  ["dragleave", "drop"].forEach((event) => zone.addEventListener(event, (e) => { e.preventDefault(); zone.classList.remove("dragging"); }));
  zone.addEventListener("drop", (e) => { const file = e.dataTransfer.files[0]; if (file) { input.files = e.dataTransfer.files; showFile(file); } });
  document.querySelector("#clear-photo").addEventListener("click", () => { input.value = ""; preview.hidden = true; label.textContent = "Drop a photo here"; });
  form.addEventListener("submit", async (event) => { event.preventDefault(); const file = input.files[0]; if (!file) return; const button = document.querySelector("#scan-button"); button.disabled = true; button.firstElementChild.textContent = "Reading your fridge..."; status.textContent = "Looking for ingredients and building a week of meals."; status.className = "form-status"; const body = new FormData(); body.append("photo", file); try { const result = await request("/fridge/analyze", { method: "POST", body }); Object.assign(state, result.plan); render(); status.textContent = result.aiUsed ? "Scan complete. Your AI recipes are ready." : `Starter recipes shown. AI scan failed: ${result.fallbackReason || "check the model settings and try again."}`; status.className = result.aiUsed ? "form-status success" : "form-status error"; document.querySelector("#plan-note").textContent = result.aiUsed ? "Personalized by AI vision" : "Starter plan · AI unavailable"; } catch (error) { status.textContent = error.message; status.className = "form-status error"; } finally { button.disabled = false; button.firstElementChild.textContent = "Scan my fridge"; } });
}
function setupAddIngredient() { const form = document.querySelector("#ingredient-form"); document.querySelector("#add-ingredient").addEventListener("click", () => { form.hidden = !form.hidden; if (!form.hidden) document.querySelector("#ingredient-input").focus(); }); form.addEventListener("submit", (event) => { event.preventDefault(); const input = document.querySelector("#ingredient-input"); const quantity = document.querySelector("#quantity-input"); const value = input.value.trim(); if (value) { state.inventory.push({ name: value, quantity: quantity.value.trim(), category: "Fridge" }); state.ingredients = state.inventory.map((item) => item.name); input.value = ""; quantity.value = ""; saveState(); render(); } }); }
function setupNavigation() {
  const menu = document.querySelector("#mobile-menu"); const toggle = document.querySelector(".menu-toggle");
  function closeMenu() { menu.hidden = true; toggle.setAttribute("aria-expanded", "false"); document.body.classList.remove("menu-open"); }
  toggle.addEventListener("click", () => { menu.hidden = !menu.hidden; toggle.setAttribute("aria-expanded", String(!menu.hidden)); document.body.classList.toggle("menu-open", !menu.hidden); });
  menu.querySelectorAll("[data-menu-close]").forEach((item) => item.addEventListener("click", closeMenu));
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => { const view = button.dataset.view; document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item.dataset.view === view)); document.querySelectorAll(".dashboard-view").forEach((panel) => panel.classList.toggle("active-view", panel.id === `${view}-view`)); closeMenu(); }));
  document.querySelector("#inventory-add").addEventListener("click", () => { document.querySelector('[data-view="overview"]').click(); document.querySelector("#add-ingredient").click(); });
}
function setupSettings() { document.querySelector("#settings-form").addEventListener("submit", (event) => { event.preventDefault(); state.preferences = { dietaryRestrictions: document.querySelector("#dietary-input").value.trim(), allergies: document.querySelector("#allergies-input").value.trim(), preferredCuisines: document.querySelector("#cuisines-input").value.trim(), dislikedIngredients: document.querySelector("#disliked-input").value.trim(), notes: document.querySelector("#notes-input").value.trim() }; saveState(); document.querySelector("#settings-saved").textContent = "Preferences saved"; }); }
function bootstrap() { if (!window.GizmoAppRuntime) throw new Error("The shared app runtime did not load."); window.GizmoAppRuntime.readConfig(); setupUpload(); setupAddIngredient(); setupNavigation(); setupSettings(); loadState(); window.GizmoAppRuntime.markReady(); }
try { bootstrap(); } catch (error) { window.GizmoAppRuntime?.showFatalError(error); }
