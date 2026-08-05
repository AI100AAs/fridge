const state = { ingredients: [], inventory: [], recipes: [], shoppingList: [], mealPlan: {}, theme: "light", preferences: { dietaryRestrictions: "", allergies: "", preferredCuisines: "", dislikedIngredients: "", servingSize: "", notes: "" } };
let inventoryQuery = "";

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
  if (list) { list.innerHTML = state.inventory.length ? state.inventory.map((item, index) => `<span class="ingredient-chip"><span><strong>${escapeHtml(item.name)}</strong>${item.quantity ? `<small>${escapeHtml(item.quantity)}</small>` : ""}</span><button type="button" data-remove="${index}" aria-label="Remove ${escapeHtml(item.name)}">×</button></span>`).join("") : `<div class="empty-copy"><span class="empty-emoji">✦</span><p>Scan your fridge to start your ingredient list.</p></div>`; list.querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", () => { state.inventory.splice(Number(button.dataset.remove), 1); state.ingredients = state.inventory.map((item) => item.name); saveState(); render(); })); }
   const recipeMarkup = state.recipes.length ? state.recipes.map((recipe, index) => `<article class="recipe-card"><div class="recipe-topline"><span class="recipe-meta">${index === 0 ? "Best match" : `#${index + 1} match`}</span><strong class="match-score">${Number(recipe.matchScore || 0)}%</strong></div><div class="recipe-actions"><button type="button" class="favorite-button ${recipe.favorite ? "is-favorite" : ""}" data-favorite="${index}" aria-label="${recipe.favorite ? "Remove from favorites" : "Add to favorites"}">${recipe.favorite ? "★" : "☆"}</button><label class="rating-label">Rate <select data-rating="${index}" aria-label="Rate ${escapeHtml(recipe.title)}"><option value="0">Not rated</option>${[1, 2, 3, 4, 5].map((rating) => `<option value="${rating}" ${Number(recipe.rating) === rating ? "selected" : ""}>${rating}/5</option>`).join("")}</select></label></div><h4>${escapeHtml(recipe.title)}</h4><p>${escapeHtml(recipe.description)}</p><span class="recipe-tag">${escapeHtml(recipe.time || "30 min")}</span><span class="difficulty-tag difficulty-${escapeHtml(recipe.difficulty || "medium")}">${escapeHtml(recipe.difficulty || "medium")}</span>${recipe.matchedIngredients?.length ? `<div class="matched-list">Uses: ${escapeHtml(recipe.matchedIngredients.join(", "))}</div>` : ""}${recipe.ingredients?.length ? `<div class="recipe-details"><strong>Ingredients:</strong><ul>${recipe.ingredients.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}${recipe.steps?.length ? `<ol class="recipe-steps">${recipe.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>` : ""}</article>`).join("") : `<div class="empty-wide">Your recipe list is empty. Scan your fridge or generate new ideas.</div>`;
   document.querySelector("#recipe-list")?.replaceChildren();
    document.querySelector("#recipe-list-large").innerHTML = recipeMarkup;
   document.querySelector("#scan-result-recipes").innerHTML = recipeMarkup;
   document.querySelector("#scan-result-inventory").innerHTML = state.inventory.length ? `<div class="scan-ingredients">${state.inventory.map((item) => `<span class="ingredient-chip"><strong>${escapeHtml(item.name)}</strong>${item.quantity ? `<small>${escapeHtml(item.quantity)}</small>` : ""}</span>`).join("")}</div>` : `<div class="empty-wide">Upload a fridge photo to see scan results here.</div>`;
   document.querySelector("#summary-inventory-count").textContent = state.inventory.length;
   document.querySelector("#summary-recipe-count").textContent = state.recipes.length;
   document.querySelector("#summary-shopping-count").textContent = state.shoppingList.length;
    const visibleInventory = state.inventory.filter((item) => `${item.name} ${item.quantity} ${item.category}`.toLowerCase().includes(inventoryQuery));
    const groupedInventory = visibleInventory.reduce((groups, item) => { (groups[item.category || "Other"] ||= []).push(item); return groups; }, {});
    document.querySelector("#inventory-list-large").innerHTML = visibleInventory.length ? Object.entries(groupedInventory).map(([category, items]) => `<section class="inventory-category"><h4>${escapeHtml(category)} <span>${items.length}</span></h4>${items.map((item) => { const index = state.inventory.indexOf(item); return `<div class="inventory-row"><span class="inventory-icon">${escapeHtml((item.name || "?").slice(0, 1).toUpperCase())}</span><input class="inventory-edit-name" data-edit-name="${index}" value="${escapeAttribute(item.name)}" aria-label="Ingredient name"><input class="inventory-edit-quantity" data-edit-quantity="${index}" value="${escapeAttribute(item.quantity || "")}" placeholder="Amount" aria-label="Quantity"><select data-edit-category="${index}" aria-label="Category"><option ${item.category === "Fridge" ? "selected" : ""}>Fridge</option><option ${item.category === "Freezer" ? "selected" : ""}>Freezer</option><option ${item.category === "Pantry" ? "selected" : ""}>Pantry</option><option ${item.category === "Produce" ? "selected" : ""}>Produce</option><option ${item.category === "Other" ? "selected" : ""}>Other</option></select><button type="button" data-remove-large="${index}" aria-label="Remove ${escapeAttribute(item.name)}">Remove</button></div>`; }).join("")}</section>`).join("") : `<div class="empty-wide">${state.inventory.length ? "No inventory items match your search." : "Your inventory is empty. Scan your fridge or add an item."}</div>`;
    document.querySelectorAll("[data-remove-large]").forEach((button) => button.addEventListener("click", () => { state.inventory.splice(Number(button.dataset.removeLarge), 1); state.ingredients = state.inventory.map((item) => item.name); saveState(); render(); }));
    document.querySelectorAll("[data-edit-name], [data-edit-quantity], [data-edit-category]").forEach((field) => field.addEventListener("change", () => { const item = state.inventory[Number(field.dataset.editName ?? field.dataset.editQuantity ?? field.dataset.editCategory)]; if (field.dataset.editName !== undefined) item.name = field.value.trim(); if (field.dataset.editQuantity !== undefined) item.quantity = field.value.trim(); if (field.dataset.editCategory !== undefined) item.category = field.value; state.ingredients = state.inventory.map((entry) => entry.name); saveState(); render(); }));
    document.querySelectorAll("[data-favorite]").forEach((button) => button.addEventListener("click", () => { state.recipes[Number(button.dataset.favorite)].favorite = !state.recipes[Number(button.dataset.favorite)].favorite; saveState(); render(); }));
    document.querySelectorAll("[data-rating]").forEach((select) => select.addEventListener("change", () => { state.recipes[Number(select.dataset.rating)].rating = Number(select.value); saveState(); render(); }));
  const shopping = document.querySelector("#shopping-list");
  const shoppingCount = document.querySelector("#shopping-count");
  if (shoppingCount) shoppingCount.textContent = `${state.shoppingList.length} item${state.shoppingList.length === 1 ? "" : "s"}`;
    const shoppingGroups = state.shoppingList.reduce((groups, item) => { (groups[item.category || "Other"] ||= []).push(item); return groups; }, {});
    const shoppingMarkup = state.shoppingList.length ? Object.entries(shoppingGroups).map(([category, items]) => `<section class="shopping-category"><h4>${escapeHtml(category)} <span>${items.length}</span></h4>${items.map((item) => { const index = state.shoppingList.indexOf(item); return `<label class="shopping-item ${item.checked ? "checked" : ""}"><input type="checkbox" data-shop="${index}" ${item.checked ? "checked" : ""}><span>${escapeHtml(item.name)}${item.amount ? ` · ${escapeHtml(item.amount)}` : ""}</span><button type="button" class="shopping-remove" data-remove-shop="${index}" aria-label="Remove ${escapeAttribute(item.name)}">×</button></label>`; }).join("")}</section>`).join("") : `<span class="muted-label">Add your first shopping item above.</span>`;
    if (shopping) shopping.innerHTML = shoppingMarkup;
    const shoppingLarge = document.querySelector("#shopping-list-large");
    if (shoppingLarge) shoppingLarge.innerHTML = shoppingMarkup;
    const shoppingCountLarge = document.querySelector("#shopping-count-large");
    if (shoppingCountLarge) shoppingCountLarge.textContent = `${state.shoppingList.length} item${state.shoppingList.length === 1 ? "" : "s"}`;
  document.querySelectorAll("[data-shop]").forEach((input) => input.addEventListener("change", () => { state.shoppingList[Number(input.dataset.shop)].checked = input.checked; saveState(); render(); }));
  document.querySelectorAll("[data-remove-shop]").forEach((button) => button.addEventListener("click", () => { state.shoppingList.splice(Number(button.dataset.removeShop), 1); saveState(); render(); }));
   renderCalendar();
    const fields = { dietaryRestrictions: "dietary-input", allergies: "allergies-input", preferredCuisines: "cuisines-input", dislikedIngredients: "disliked-input", servingSize: "serving-size-input", notes: "notes-input" }; Object.entries(fields).forEach(([key, id]) => { const field = document.getElementById(id); if (field && document.activeElement !== field) field.value = state.preferences?.[key] || ""; });
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
function escapeAttribute(value) { return escapeHtml(value).split(String.fromCharCode(34)).join("&quot;").split(String.fromCharCode(39)).join("&#39;"); }
async function saveState() { try { await request("/fridge/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state) }); } catch (_) { /* local UI remains usable if persistence is briefly unavailable */ } }
async function loadState() { try { Object.assign(state, await request("/fridge/state")); render(); } catch (_) { render(); } }

function setupUpload() {
  const form = document.querySelector("#upload-form"); const input = document.querySelector("#fridge-photo"); const zone = document.querySelector(".drop-zone"); const preview = document.querySelector("#preview-wrap"); const image = document.querySelector("#preview-image"); const label = document.querySelector("#file-label"); const status = document.querySelector("#scan-status");
   function showFile(file) { if (!file) return; label.textContent = file.name; image.src = URL.createObjectURL(file); image.hidden = false; preview.hidden = false; }
  input.addEventListener("change", () => showFile(input.files[0]));
  ["dragenter", "dragover"].forEach((event) => zone.addEventListener(event, (e) => { e.preventDefault(); zone.classList.add("dragging"); }));
  ["dragleave", "drop"].forEach((event) => zone.addEventListener(event, (e) => { e.preventDefault(); zone.classList.remove("dragging"); }));
  zone.addEventListener("drop", (e) => { const file = e.dataTransfer.files[0]; if (file) { input.files = e.dataTransfer.files; showFile(file); } });
   document.querySelector("#clear-photo").addEventListener("click", () => { input.value = ""; image.removeAttribute("src"); image.hidden = true; preview.hidden = true; label.textContent = "Drop a photo here"; });
  form.addEventListener("submit", async (event) => { event.preventDefault(); const file = input.files[0]; if (!file) return; const button = document.querySelector("#scan-button"); button.disabled = true; button.firstElementChild.textContent = "Reading your fridge..."; status.textContent = "Looking for ingredients and building a week of meals."; status.className = "form-status"; const body = new FormData(); body.append("photo", file); try { const result = await request("/fridge/analyze", { method: "POST", body }); Object.assign(state, result.plan); render(); status.textContent = result.aiUsed ? "Scan complete. Your AI recipes are ready." : `Starter recipes shown. AI scan failed: ${result.fallbackReason || "check the model settings and try again."}`; status.className = result.aiUsed ? "form-status success" : "form-status error"; const planNote = document.querySelector("#plan-note"); if (planNote) planNote.textContent = result.aiUsed ? "Personalized by AI vision" : "Starter plan · AI unavailable"; } catch (error) { status.textContent = error.message; status.className = "form-status error"; } finally { button.disabled = false; button.firstElementChild.textContent = "Scan my fridge"; } });
}
  function setupAddIngredient() { const form = document.querySelector("#ingredient-form"); document.querySelector("#inventory-add").addEventListener("click", () => { form.hidden = !form.hidden; if (!form.hidden) document.querySelector("#ingredient-input").focus(); }); form.addEventListener("submit", (event) => { event.preventDefault(); const input = document.querySelector("#ingredient-input"); const quantity = document.querySelector("#quantity-input"); const category = document.querySelector("#category-input"); const value = input.value.trim(); if (value) { state.inventory.push({ name: value, quantity: quantity.value.trim(), category: category.value }); state.ingredients = state.inventory.map((item) => item.name); input.value = ""; quantity.value = ""; saveState(); render(); } }); document.querySelector("#inventory-search").addEventListener("input", (event) => { inventoryQuery = event.target.value.trim().toLowerCase(); render(); }); }
function setupNavigation() {
  const menu = document.querySelector("#mobile-menu"); const toggle = document.querySelector(".menu-toggle");
  const closeButton = menu.querySelector(".menu-close");
  function setMenuOpen(isOpen) { menu.classList.toggle("is-open", isOpen); menu.setAttribute("aria-hidden", String(!isOpen)); toggle.setAttribute("aria-expanded", String(isOpen)); document.body.classList.toggle("menu-open", isOpen); if (isOpen) closeButton.focus(); else toggle.focus(); }
  function closeMenu() { setMenuOpen(false); }
  toggle.addEventListener("click", () => setMenuOpen(!menu.classList.contains("is-open")));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && menu.classList.contains("is-open")) closeMenu(); });
  menu.querySelectorAll("[data-menu-close]").forEach((item) => item.addEventListener("click", closeMenu));
   document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => { const view = button.dataset.view; document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item.dataset.view === view)); document.querySelectorAll(".dashboard-view").forEach((panel) => panel.classList.toggle("active-view", panel.id === `${view}-view`)); closeMenu(); }));
}
function setupRecipeActions() {
  document.querySelector("#clear-inventory").addEventListener("click", () => { if (!state.inventory.length || !window.confirm("Clear your entire inventory?")) return; state.inventory = []; state.ingredients = []; saveState(); render(); });
  document.querySelector("#clear-recipes").addEventListener("click", () => { if (!state.recipes.length || !window.confirm("Clear all suggested recipes?")) return; state.recipes = []; state.mealPlan = {}; saveState(); render(); });
  document.querySelector("#generate-recipes").addEventListener("click", async (event) => { const button = event.currentTarget; const status = document.querySelector("#generate-status"); button.disabled = true; button.textContent = "Generating..."; status.textContent = "Finding new meals for your current inventory."; status.className = "form-status"; try { const result = await request("/fridge/generate", { method: "POST" }); Object.assign(state, result.plan); render(); status.textContent = `${result.generated} new recipes added.`; status.className = "form-status success"; } catch (error) { status.textContent = error.message; status.className = "form-status error"; } finally { button.disabled = false; button.textContent = "+ Generate more"; } });
}
function setupShopping() { document.querySelector("#shopping-form").addEventListener("submit", (event) => { event.preventDefault(); const name = document.querySelector("#shopping-item-input"); const amount = document.querySelector("#shopping-amount-input"); const category = document.querySelector("#shopping-category-input"); if (!name.value.trim()) return; state.shoppingList.push({ name: name.value.trim(), amount: amount.value.trim(), category: category.value, checked: false }); name.value = ""; amount.value = ""; saveState(); render(); name.focus(); }); }
  function setupSettings() { document.querySelector("#settings-form").addEventListener("submit", (event) => { event.preventDefault(); state.preferences = { dietaryRestrictions: document.querySelector("#dietary-input").value.trim(), allergies: document.querySelector("#allergies-input").value.trim(), preferredCuisines: document.querySelector("#cuisines-input").value.trim(), dislikedIngredients: document.querySelector("#disliked-input").value.trim(), servingSize: document.querySelector("#serving-size-input").value.trim(), notes: document.querySelector("#notes-input").value.trim() }; saveState(); document.querySelector("#settings-saved").textContent = "Preferences saved"; }); }
  function setupTheme() { const button = document.querySelector("#theme-toggle"); const applyTheme = () => { const dark = state.theme === "dark"; document.body.classList.toggle("dark-mode", dark); button.setAttribute("aria-pressed", String(dark)); button.textContent = dark ? "Light mode" : "Dark mode"; }; button.addEventListener("click", () => { state.theme = state.theme === "dark" ? "light" : "dark"; applyTheme(); saveState(); }); applyTheme(); }
 function bootstrap() { if (!window.GizmoAppRuntime) throw new Error("The shared app runtime did not load."); window.GizmoAppRuntime.readConfig(); setupUpload(); setupAddIngredient(); setupNavigation(); setupRecipeActions(); setupShopping(); setupSettings(); setupTheme(); loadState(); window.GizmoAppRuntime.markReady(); }
try { bootstrap(); } catch (error) { window.GizmoAppRuntime?.showFatalError(error); }
