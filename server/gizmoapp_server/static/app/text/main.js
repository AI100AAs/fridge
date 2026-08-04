const state = { ingredients: [], inventory: [], recipes: [], shoppingList: [] };

function apiBase() { return window.GizmoAppRuntime.readConfig().apiBase; }
async function request(path, options = {}) {
  const response = await fetch(`${apiBase()}${path}`, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.errors?.[0] || "Something went wrong.");
  return payload;
}

function render() {
  const list = document.querySelector("#ingredient-list");
  if (!Array.isArray(state.inventory) || !state.inventory.length) state.inventory = state.ingredients.map((name) => ({ name, quantity: "", category: "Fridge" }));
  state.ingredients = state.inventory.map((item) => item.name);
  document.querySelector("#week-count").textContent = state.inventory.length;
  list.innerHTML = state.inventory.length ? state.inventory.map((item, index) => `<span class="ingredient-chip"><span><strong>${escapeHtml(item.name)}</strong>${item.quantity ? `<small>${escapeHtml(item.quantity)}</small>` : ""}</span><button type="button" data-remove="${index}" aria-label="Remove ${escapeHtml(item.name)}">×</button></span>`).join("") : `<div class="empty-copy"><span class="empty-emoji">✦</span><p>Scan your fridge to start your ingredient list.</p></div>`;
  list.querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", () => { state.inventory.splice(Number(button.dataset.remove), 1); state.ingredients = state.inventory.map((item) => item.name); saveState(); render(); }));
  const recipes = document.querySelector("#recipe-list");
  recipes.innerHTML = state.recipes.length ? state.recipes.map((recipe, index) => `<article class="recipe-card"><div class="recipe-topline"><span class="recipe-meta">${index === 0 ? "Best match" : `#${index + 1} match`}</span><strong class="match-score">${Number(recipe.matchScore || 0)}%</strong></div><h4>${escapeHtml(recipe.title)}</h4><p>${escapeHtml(recipe.description)}</p><span class="recipe-tag">${escapeHtml(recipe.time || "30 min")}</span>${recipe.matchedIngredients?.length ? `<div class="matched-list">Uses: ${escapeHtml(recipe.matchedIngredients.join(", "))}</div>` : ""}${recipe.ingredients?.length ? `<div class="recipe-details"><strong>Ingredients</strong><span>${escapeHtml(recipe.ingredients.join(", "))}</span></div>` : ""}${recipe.steps?.length ? `<ol class="recipe-steps">${recipe.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>` : ""}</article>`).join("") : `<div class="empty-wide">Your personalized recipes will appear here after a scan.</div>`;
  const shopping = document.querySelector("#shopping-list");
  document.querySelector("#shopping-count").textContent = `${state.shoppingList.length} item${state.shoppingList.length === 1 ? "" : "s"}`;
  shopping.innerHTML = state.shoppingList.length ? state.shoppingList.map((item, index) => `<label class="shopping-item ${item.checked ? "checked" : ""}"><input type="checkbox" data-shop="${index}" ${item.checked ? "checked" : ""}><span>${escapeHtml(item.name)}${item.amount ? ` · ${escapeHtml(item.amount)}` : ""}</span></label>`).join("") : `<span class="muted-label">We’ll only add what your recipes need.</span>`;
  shopping.querySelectorAll("[data-shop]").forEach((input) => input.addEventListener("change", () => { state.shoppingList[Number(input.dataset.shop)].checked = input.checked; saveState(); render(); }));
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
function bootstrap() { if (!window.GizmoAppRuntime) throw new Error("The shared app runtime did not load."); window.GizmoAppRuntime.readConfig(); setupUpload(); setupAddIngredient(); loadState(); window.GizmoAppRuntime.markReady(); }
try { bootstrap(); } catch (error) { window.GizmoAppRuntime?.showFatalError(error); }
