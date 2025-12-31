/* Meal Timing Coordinator - offline-friendly, vanilla JS, localStorage.
   Designed for iPad use. */

const STORAGE_KEY = "cooktiming.meals.v1";
const APP_VERSION = "v0.1.1";
const ACTIVE_KEY  = "cooktiming.activeMealId.v1";
const SESSION_KEY = "cooktiming.session.v1"; // active cooking session state

// ---------- Utilities ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const uid = () => Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);

function clampInt(n, min, max){
  const v = parseInt(n, 10);
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function pad2(n){ return String(n).padStart(2, "0"); }

function toLocalISODate(d){
  const x = new Date(d.getTime() - d.getTimezoneOffset()*60000);
  return x.toISOString().slice(0,10);
}

function toTimeLabel(d){
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

function parseServeDateTime(dateStr, timeStr){
  // dateStr YYYY-MM-DD, timeStr HH:MM
  if (!dateStr || !timeStr) return null;
  const [Y,M,D] = dateStr.split("-").map(Number);
  const [h,m] = timeStr.split(":").map(Number);
  const dt = new Date(Y, M-1, D, h, m, 0, 0);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

// ---------- Default meal template ----------
function roastBeefTemplate(){
  return {
    id: uid(),
    name: "Roast Beef Dinner",
    serveDate: toLocalISODate(new Date()),
    serveTime: "18:30",
    dishes: [
      {
        id: uid(),
        name: "Roast Beef",
        stages: [
          { id: uid(), name: "Take out of fridge (temper)", durationMin: 45, alertStart: true, alertEnd: true, notes: "" },
          { id: uid(), name: "Preheat oven", durationMin: 20, alertStart: true, alertEnd: true, notes: "" },
          { id: uid(), name: "Roast (hot start)", durationMin: 20, alertStart: true, alertEnd: true, notes: "e.g. 220°C (adjust)" },
          { id: uid(), name: "Roast (lower heat)", durationMin: 45, alertStart: true, alertEnd: true, notes: "adjust for weight/doneness" },
          { id: uid(), name: "Rest joint", durationMin: 20, alertStart: true, alertEnd: true, notes: "" },
        ]
      },
      {
        id: uid(),
        name: "Roast Potatoes",
        stages: [
          { id: uid(), name: "Parboil", durationMin: 15, alertStart: true, alertEnd: true, notes: "" },
          { id: uid(), name: "Steam-dry & rough up", durationMin: 10, alertStart: true, alertEnd: true, notes: "" },
          { id: uid(), name: "Roast", durationMin: 50, alertStart: true, alertEnd: true, notes: "turn halfway" },
        ]
      },
      {
        id: uid(),
        name: "Yorkshire Puddings",
        stages: [
          { id: uid(), name: "Batter prep", durationMin: 10, alertStart: true, alertEnd: true, notes: "" },
          { id: uid(), name: "Batter rest", durationMin: 30, alertStart: true, alertEnd: true, notes: "" },
          { id: uid(), name: "Heat tin + fat", durationMin: 10, alertStart: true, alertEnd: true, notes: "" },
          { id: uid(), name: "Bake", durationMin: 20, alertStart: true, alertEnd: true, notes: "no peeking" },
        ]
      },
      {
        id: uid(),
        name: "Veg + Gravy",
        stages: [
          { id: uid(), name: "Prep veg", durationMin: 15, alertStart: true, alertEnd: true, notes: "" },
          { id: uid(), name: "Cook veg", durationMin: 12, alertStart: true, alertEnd: true, notes: "" },
          { id: uid(), name: "Make gravy", durationMin: 10, alertStart: true, alertEnd: true, notes: "" },
        ]
      }
    ]
  };
}

// ---------- Storage ----------
function loadMeals(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data;
  }catch(e){
    console.warn("Failed to load meals", e);
    return [];
  }
}

function saveMeals(meals){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(meals));
}

function getActiveMealId(){
  return localStorage.getItem(ACTIVE_KEY);
}
function setActiveMealId(id){
  localStorage.setItem(ACTIVE_KEY, id);
}

function getSession(){
  try{
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  }catch{ return null; }
}
function setSession(s){
  if (!s) localStorage.removeItem(SESSION_KEY);
  else localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

// ---------- Global State ----------
let meals = [];
let meal = null;
let audio = { ctx: null, enabled: false };
let timers = []; // active setTimeout handles
let tickInterval = null;

// ---------- Audio ----------
function ensureAudio(){
  if (audio.ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  audio.ctx = new AC();
}
async function enableSound(){
  ensureAudio();
  if (!audio.ctx) {
    showToast("Sound unavailable", "This browser doesn't support Web Audio.");
    return;
  }
  // iOS requires a user gesture; resume inside click handler
  if (audio.ctx.state === "suspended") await audio.ctx.resume();
  audio.enabled = true;
  beep(0.06, 880);
  beep(0.06, 660, 0.09);
}
function beep(duration=0.08, freq=740, delay=0){
  if (!audio.enabled || !audio.ctx) return;
  const t0 = audio.ctx.currentTime + delay;
  const osc = audio.ctx.createOscillator();
  const gain = audio.ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(audio.ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

// ---------- UI helpers ----------
function showToast(title, body){
  $("#toastTitle").textContent = title;
  $("#toastBody").textContent = body;
  $("#toast").classList.remove("hidden");
}
function hideToast(){
  $("#toast").classList.add("hidden");
}

function setTab(tabName){
  const isDishes = tabName === "dishes";
  $("#tabDishes").classList.toggle("active", isDishes);
  $("#tabTimeline").classList.toggle("active", !isDishes);
  $("#pageDishes").classList.toggle("hidden", !isDishes);
  $("#pageTimeline").classList.toggle("hidden", isDishes);

  // Header only on dishes
  $("#header").classList.toggle("hidden", !isDishes);

  // Refresh timeline when entering timeline
  if (!isDishes) renderTimeline();
}

function confirmDanger(msg){
  return window.confirm(msg);
}

// ---------- Meal management ----------
function ensureBootstrap(){
  meals = loadMeals();
  if (meals.length === 0){
    const m = roastBeefTemplate();
    meals = [m];
    saveMeals(meals);
    setActiveMealId(m.id);
  }

  const active = getActiveMealId();
  meal = meals.find(x => x.id === active) || meals[0];
  setActiveMealId(meal.id);

  // Ensure defaults for serve date/time
  if (!meal.serveDate) meal.serveDate = toLocalISODate(new Date());
  if (!meal.serveTime) meal.serveTime = "18:30";
}

function upsertMeal(updated){
  const idx = meals.findIndex(m => m.id === updated.id);
  if (idx >= 0) meals[idx] = updated;
  else meals.unshift(updated);
  saveMeals(meals);
  meal = updated;
  setActiveMealId(meal.id);
  rebuildMealSelect();
}

function rebuildMealSelect(){
  const sel = $("#mealSelect");
  sel.innerHTML = "";
  meals.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.name;
    if (m.id === meal.id) opt.selected = true;
    sel.appendChild(opt);
  });
}

function setMealById(id){
  const m = meals.find(x => x.id === id);
  if (!m) return;
  meal = m;
  setActiveMealId(meal.id);
  // update inputs + render
  $("#serveTime").value = meal.serveTime || "";
  $("#serveDate").value = meal.serveDate || toLocalISODate(new Date());
  renderDishes();
  renderTimeline();
}

function createNewMeal(){
  const name = prompt("Name your new meal:", "New Meal");
  if (!name) return;
  const m = {
    id: uid(),
    name: name.trim(),
    serveDate: toLocalISODate(new Date()),
    serveTime: "18:30",
    dishes: []
  };
  meals.unshift(m);
  upsertMeal(m);
  setMealById(m.id);
}

function copyMeal(){
  const name = prompt("Name for the copy:", meal.name + " (Copy)");
  if (!name) return;
  const clone = structuredClone(meal);
  clone.id = uid();
  clone.name = name.trim();
  // new IDs for dishes/stages
  clone.dishes = (clone.dishes || []).map(d => ({
    ...d,
    id: uid(),
    stages: (d.stages || []).map(s => ({ ...s, id: uid() }))
  }));
  meals.unshift(clone);
  upsertMeal(clone);
  setMealById(clone.id);
}

function deleteMeal(){
  if (meals.length <= 1){
    showToast("Can't delete", "Keep at least one meal (copy it first if you like).");
    return;
  }
  if (!confirmDanger(`Delete "${meal.name}"? This can't be undone.`)) return;
  meals = meals.filter(m => m.id !== meal.id);
  saveMeals(meals);
  const next = meals[0];
  setActiveMealId(next.id);
  setMealById(next.id);
  rebuildMealSelect();
}

function exportMealJSON(){
  const dlg = $("#jsonDialog");
  $("#jsonDialogTitle").textContent = "Export meal JSON";
  $("#jsonActionBtn").textContent = "Copy & close";
  const data = JSON.stringify(meal, null, 2);
  $("#jsonText").value = data;
  dlg.showModal();

  $("#jsonActionBtn").onclick = async (ev) => {
    ev.preventDefault();
    try{
      await navigator.clipboard.writeText($("#jsonText").value);
      showToast("Copied", "Meal JSON copied to clipboard.");
    }catch{
      // clipboard may fail on iOS; still fine
      showToast("Ready", "Select all and copy the JSON manually if needed.");
    }
    dlg.close();
  };
}

function importMealJSON(){
  const dlg = $("#jsonDialog");
  $("#jsonDialogTitle").textContent = "Import meal JSON";
  $("#jsonActionBtn").textContent = "Import";
  $("#jsonText").value = "";
  dlg.showModal();

  $("#jsonActionBtn").onclick = (ev) => {
    ev.preventDefault();
    let obj = null;
    try{
      obj = JSON.parse($("#jsonText").value);
    }catch{
      showToast("Invalid JSON", "That didn't parse as valid JSON.");
      return;
    }
    if (!obj || typeof obj !== "object" || !obj.name){
      showToast("Not a meal", "JSON must look like a meal with at least a name.");
      return;
    }
    obj.id = uid();
    obj.dishes = (obj.dishes || []).map(d => ({
      id: uid(),
      name: d.name || "Dish",
      stages: (d.stages || []).map(s => ({
        id: uid(),
        name: s.name || "Stage",
        durationMin: clampInt(s.durationMin ?? 10, 0, 2000),
        alertStart: s.alertStart !== false,
        alertEnd: s.alertEnd !== false,
        notes: s.notes || ""
      }))
    }));
    obj.serveDate = obj.serveDate || toLocalISODate(new Date());
    obj.serveTime = obj.serveTime || "18:30";

    meals.unshift(obj);
    upsertMeal(obj);
    setMealById(obj.id);
    dlg.close();
    showToast("Imported", `Imported "${obj.name}".`);
  };
}

// ---------- Dishes editor ----------
function renderDishes(){
  // serve controls
  $("#serveTime").value = meal.serveTime || "";
  $("#serveDate").value = meal.serveDate || toLocalISODate(new Date());

  const list = $("#dishList");
  list.innerHTML = "";

  (meal.dishes || []).forEach((dish, dishIdx) => {
    const card = document.createElement("div");
    card.className = "dishCard";

    const head = document.createElement("div");
    head.className = "dishHead";

    const nameField = document.createElement("label");
    nameField.className = "field dishName";
    nameField.innerHTML = `<span class="label">Dish name</span>
      <input type="text" value="${escapeHtml(dish.name || "")}" data-dish="${dish.id}" class="dishNameInput"/>`;

    const actions = document.createElement("div");
    actions.className = "dishActions";
    actions.innerHTML = `
      <div class="dishMove">
        <button class="miniBtn" title="Move dish up" data-action="moveDishUp" data-dish="${dish.id}">▲</button>
        <button class="miniBtn" title="Move dish down" data-action="moveDishDown" data-dish="${dish.id}">▼</button>
      </div>
      <button class="btn" data-action="addStage" data-dish="${dish.id}">Add stage</button>
      <button class="btn danger" data-action="deleteDish" data-dish="${dish.id}">Delete dish</button>
    `;

    head.appendChild(nameField);
    head.appendChild(actions);

    const table = document.createElement("table");
    table.className = "stageTable";
    table.innerHTML = `
      <thead>
        <tr>
          <th style="width:32%;">Stage</th>
          <th style="width:12%;">Mins</th>
          <th style="width:30%;">Notes</th>
          <th style="width:18%;">Alerts</th>
          <th style="width:12%; text-align:right;"> </th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector("tbody");

    (dish.stages || []).forEach((stage, stageIdx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input class="smallInput" type="text" value="${escapeHtml(stage.name || "")}" data-stage="${stage.id}" data-dish="${dish.id}" data-field="name"/></td>
        <td><input class="smallInput" type="number" inputmode="numeric" min="0" max="2000" value="${stage.durationMin ?? 0}" data-stage="${stage.id}" data-dish="${dish.id}" data-field="durationMin"/></td>
        <td><input class="smallInput" type="text" value="${escapeHtml(stage.notes || "")}" data-stage="${stage.id}" data-dish="${dish.id}" data-field="notes"/></td>
        <td>
          <label class="checkbox"><input type="checkbox" ${stage.alertStart ? "checked":""} data-stage="${stage.id}" data-dish="${dish.id}" data-field="alertStart">Start</label>
          <label class="checkbox"><input type="checkbox" ${stage.alertEnd ? "checked":""} data-stage="${stage.id}" data-dish="${dish.id}" data-field="alertEnd">End</label>
        </td>
        <td style="text-align:right; white-space:nowrap;">
          <button class="miniBtn" title="Move stage up" data-action="moveStageUp" data-dish="${dish.id}" data-stage="${stage.id}">▲</button>
          <button class="miniBtn" title="Move stage down" data-action="moveStageDown" data-dish="${dish.id}" data-stage="${stage.id}">▼</button>
          <button class="btn danger" data-action="deleteStage" data-dish="${dish.id}" data-stage="${stage.id}">Del</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    card.appendChild(head);
    card.appendChild(table);
    list.appendChild(card);
  });

  wireDishHandlers();
}

function addDish(){
  const name = prompt("Dish name:", "New Dish");
  if (!name) return;
  meal.dishes = meal.dishes || [];
  meal.dishes.push({ id: uid(), name: name.trim(), stages: [] });
  upsertMeal(meal);
  renderDishes();
}

function deleteDish(dishId){
  if (!confirmDanger("Delete this dish?")) return;
  meal.dishes = (meal.dishes || []).filter(d => d.id !== dishId);
  upsertMeal(meal);
  renderDishes();
}

function addStage(dishId){
  const dish = (meal.dishes || []).find(d => d.id === dishId);
  if (!dish) return;
  dish.stages = dish.stages || [];
  dish.stages.push({ id: uid(), name: "New stage", durationMin: 10, alertStart: true, alertEnd: true, notes: "" });
  upsertMeal(meal);
  renderDishes();
}

function deleteStage(dishId, stageId){
  const dish = (meal.dishes || []).find(d => d.id === dishId);
  if (!dish) return;
  dish.stages = (dish.stages || []).filter(s => s.id !== stageId);
  upsertMeal(meal);
  renderDishes();
}


function moveDish(dishId, dir){
  const arr = meal.dishes || [];
  const idx = arr.findIndex(d => d.id === dishId);
  if (idx < 0) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= arr.length) return;
  const [item] = arr.splice(idx, 1);
  arr.splice(newIdx, 0, item);
  meal.dishes = arr;
  upsertMeal(meal);
  renderDishes();
}

function moveStage(dishId, stageId, dir){
  const dish = (meal.dishes || []).find(d => d.id === dishId);
  if (!dish) return;
  const arr = dish.stages || [];
  const idx = arr.findIndex(s => s.id === stageId);
  if (idx < 0) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= arr.length) return;
  const [item] = arr.splice(idx, 1);
  arr.splice(newIdx, 0, item);
  dish.stages = arr;
  upsertMeal(meal);
  renderDishes();
}

function updateDishName(dishId, value){
  const dish = (meal.dishes || []).find(d => d.id === dishId);
  if (!dish) return;
  dish.name = value;
  upsertMeal(meal);
}

function updateStageField(dishId, stageId, field, value, isCheckbox=false){
  const dish = (meal.dishes || []).find(d => d.id === dishId);
  if (!dish) return;
  const stage = (dish.stages || []).find(s => s.id === stageId);
  if (!stage) return;

  if (field === "durationMin"){
    stage.durationMin = clampInt(value, 0, 2000);
  }else if (field === "alertStart" || field === "alertEnd"){
    stage[field] = !!value;
  }else{
    stage[field] = value;
  }
  upsertMeal(meal);
}

function wireDishHandlers(){
  // dish name inputs
  $$(".dishNameInput").forEach(inp => {
    inp.oninput = (e) => updateDishName(inp.dataset.dish, e.target.value);
  });

  // stage inputs
  $$(".stageTable input").forEach(inp => {
    const field = inp.dataset.field;
    if (!field) return;
    inp.oninput = (e) => {
      const dishId = inp.dataset.dish;
      const stageId = inp.dataset.stage;
      if (inp.type === "checkbox"){
        updateStageField(dishId, stageId, field, inp.checked, true);
      }else{
        updateStageField(dishId, stageId, field, e.target.value);
      }
    };
    if (inp.type === "number"){
      inp.onblur = (e) => { // clamp on blur
        inp.value = String(clampInt(inp.value, 0, 2000));
      };
    }
  });

  // buttons
  $$(".dishCard button").forEach(btn => {
    const action = btn.dataset.action;
    if (!action) return;
    btn.onclick = () => {
      const dishId = btn.dataset.dish;
      if (action === "addStage") addStage(dishId);
      if (action === "deleteDish") deleteDish(dishId);
      if (action === "moveDishUp") moveDish(dishId, -1);
      if (action === "moveDishDown") moveDish(dishId, 1);
      if (action === "moveStageUp") moveStage(dishId, btn.dataset.stage, -1);
      if (action === "moveStageDown") moveStage(dishId, btn.dataset.stage, 1);
      if (action === "deleteStage") deleteStage(dishId, btn.dataset.stage);
    };
  });
}

// ---------- Timeline ----------
function computeEvents(){
  const serveDt = parseServeDateTime(meal.serveDate, meal.serveTime);
  if (!serveDt) return [];

  const events = [];
  (meal.dishes || []).forEach(dish => {
    const stages = dish.stages || [];
    // total duration
    const totalMin = stages.reduce((sum, s) => sum + clampInt(s.durationMin ?? 0, 0, 2000), 0);
    const dishStart = new Date(serveDt.getTime() - totalMin*60000);

    let cursor = dishStart.getTime();
    stages.forEach((stage, idx) => {
      const durMin = clampInt(stage.durationMin ?? 0, 0, 2000);
      const start = new Date(cursor);
      const end = new Date(cursor + durMin*60000);

      if (stage.alertStart){
        events.push({
          id: uid(),
          when: start.getTime(),
          type: "start",
          dish: dish.name,
          stage: stage.name,
          notes: stage.notes || "",
          durationMin: durMin
        });
      }
      if (stage.alertEnd){
        events.push({
          id: uid(),
          when: end.getTime(),
          type: "end",
          dish: dish.name,
          stage: stage.name,
          notes: stage.notes || "",
          durationMin: durMin
        });
      }
      cursor = end.getTime();
    });
  });

  // de-dup any exact duplicates (rare)
  events.sort((a,b) => a.when - b.when || a.type.localeCompare(b.type));
  return events;
}

function renderTimeline(){
  const serveDt = parseServeDateTime(meal.serveDate, meal.serveTime);
  $("#timelineMeta").textContent = serveDt
    ? `Serve at ${toTimeLabel(serveDt)} on ${meal.serveDate}`
    : "Set a serve time on the Dishes tab.";

  const filter = $("#timelineFilter").value;
  const gran = $("#timelineGranularity").value;
  const now = Date.now();

  const events = computeEvents().filter(ev => {
    if (gran === "start" && ev.type !== "start") return false;
    if (gran === "end" && ev.type !== "end") return false;
    if (filter === "upcoming" && ev.when < now) return false;
    if (filter === "done" && ev.when >= now) return false;
    return true;
  });

  const wrap = $("#timeline");
  wrap.innerHTML = "";

  if (events.length === 0){
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No events yet — add dishes/stages on the Dishes tab.";
    wrap.appendChild(empty);
    return;
  }

  // find nearest upcoming for highlight
  const nearestUpcoming = events.find(ev => ev.when >= now) || null;

  events.forEach(ev => {
    const d = new Date(ev.when);
    const isDone = ev.when < now;
    const card = document.createElement("div");
    card.className = "event" + (isDone ? " done":"") + (nearestUpcoming && ev.id === nearestUpcoming.id ? " leftNow":"");
    card.dataset.when = String(ev.when);

    const pill = ev.type === "start" ? "START" : "END";
    const title = `${pill}: ${ev.dish} — ${ev.stage}`;
    const meta = ev.notes ? ev.notes : (ev.type === "start" ? `Duration: ${ev.durationMin} min` : `Stage complete`);

    card.innerHTML = `
      <div class="eventTime">${toTimeLabel(d)}</div>
      <div class="eventMain">
        <div class="eventTitle">${escapeHtml(title)}</div>
        <div class="eventMeta">${escapeHtml(meta)}</div>
      </div>
      <div class="pill">${pill}</div>
    `;
    wrap.appendChild(card);
  });
}

function scrollToNow(){
  const now = Date.now();
  const events = $$("#timeline .event");
  if (events.length === 0) return;
  // pick first event >= now else last
  let target = events.find(el => parseInt(el.dataset.when,10) >= now) || events[events.length-1];
  target.scrollIntoView({ behavior:"smooth", block:"center" });
}

// ---------- Alerts / session ----------
function clearTimers(){
  timers.forEach(t => clearTimeout(t));
  timers = [];
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = null;
}

function scheduleSession(){
  const serveDt = parseServeDateTime(meal.serveDate, meal.serveTime);
  if (!serveDt){
    showToast("Serve time missing", "Set serve date/time on the Dishes tab.");
    return;
  }
  const events = computeEvents();
  if (events.length === 0){
    showToast("Nothing to schedule", "Add at least one stage with alerts enabled.");
    return;
  }

  clearTimers();
  const now = Date.now();

  // store session for reload recovery
  const session = {
    mealId: meal.id,
    startedAt: now,
    serveWhen: serveDt.getTime(),
    armedAt: now,
    firedEventIds: []
  };
  setSession(session);

  // Schedule upcoming events
  events.forEach(ev => {
    if (ev.when < now) return;
    const delay = ev.when - now;
    const handle = setTimeout(() => fireEvent(ev), delay);
    timers.push(handle);
  });

  // UI updates
  $("#startSessionBtn").disabled = true;
  $("#stopSessionBtn").disabled = false;

  // tick to re-render timeline highlight/status every 10s
  tickInterval = setInterval(() => renderTimeline(), 10000);
  renderTimeline();

  showToast("Session started", "You're armed. You'll get alerts at each start/end.");
  beep(0.08, 740); beep(0.08, 520, 0.11);
}

function stopSession(){
  clearTimers();
  setSession(null);
  $("#startSessionBtn").disabled = false;
  $("#stopSessionBtn").disabled = true;
  showToast("Stopped", "Cooking session stopped. You can start again any time.");
}

function fireEvent(ev){
  // Guard against double-fire on reload race
  const session = getSession();
  if (session){
    if (session.firedEventIds?.includes(ev.id)) return;
    session.firedEventIds = session.firedEventIds || [];
    session.firedEventIds.push(ev.id);
    setSession(session);
  }

  const when = new Date(ev.when);
  const pill = ev.type === "start" ? "START" : "END";
  const title = `${pill}: ${ev.dish}`;
  const body = `${toTimeLabel(when)} — ${ev.stage}${ev.notes ? "\n" + ev.notes : ""}`;

  // sound pattern
  if (ev.type === "start"){
    beep(0.07, 880); beep(0.07, 660, 0.10);
  }else{
    beep(0.09, 520); beep(0.09, 520, 0.12); beep(0.09, 420, 0.24);
  }

  showToast(title, body);
  renderTimeline();
}

function recoverSessionIfAny(){
  const s = getSession();
  if (!s) return;

  // Only recover if the active meal matches.
  if (s.mealId !== meal.id) return;

  // Re-arm timers for remaining events (best effort)
  const now = Date.now();
  const events = computeEvents();

  clearTimers();
  events.forEach(ev => {
    if (ev.when < now) return;
    const delay = ev.when - now;
    const handle = setTimeout(() => fireEvent(ev), delay);
    timers.push(handle);
  });

  $("#startSessionBtn").disabled = true;
  $("#stopSessionBtn").disabled = false;
  tickInterval = setInterval(() => renderTimeline(), 10000);
  renderTimeline();
}

// ---------- Sanitisation ----------
function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// ---------- App bootstrap ----------
function init(){
  ensureBootstrap();

  const v = $("#versionLabel");
  if (v) v.textContent = `Meal Timer ${APP_VERSION}`;

  // PWA optional SW
  if ("serviceWorker" in navigator){
    navigator.serviceWorker.register("sw.js").catch(()=>{});
  }

  rebuildMealSelect();

  // hook controls
  $("#mealSelect").onchange = (e) => setMealById(e.target.value);
  $("#newMealBtn").onclick = createNewMeal;
  $("#copyMealBtn").onclick = copyMeal;
  $("#deleteMealBtn").onclick = deleteMeal;

  $("#addDishBtn").onclick = addDish;
  $("#recalcBtn").onclick = () => { upsertMeal(meal); renderTimeline(); showToast("Updated", "Timeline recalculated."); };
  $("#exportBtn").onclick = exportMealJSON;
  $("#importBtn").onclick = importMealJSON;

  $("#serveTime").onchange = (e) => { meal.serveTime = e.target.value; upsertMeal(meal); };
  $("#serveDate").onchange = (e) => { meal.serveDate = e.target.value; upsertMeal(meal); };

  // tabs
  $("#tabDishes").onclick = () => setTab("dishes");
  $("#tabTimeline").onclick = () => setTab("timeline");

  // timeline controls
  $("#timelineFilter").onchange = renderTimeline;
  $("#timelineGranularity").onchange = renderTimeline;
  $("#scrollNowBtn").onclick = scrollToNow;

  // toast
  $("#toastOkBtn").onclick = hideToast;
  $("#toast").onclick = (e) => { if (e.target.id === "toast") hideToast(); };

  // session buttons
  $("#enableSoundBtn").onclick = async () => {
    await enableSound();
    showToast("Sound enabled", "Right, you're set. You'll hear beeps for alerts.");
  };
  $("#startSessionBtn").onclick = () => scheduleSession();
  $("#stopSessionBtn").onclick = () => stopSession();

  // initial render
  setMealById(meal.id);

  // recovery
  recoverSessionIfAny();
}

document.addEventListener("DOMContentLoaded", init);
