"use strict";

// The omt config editor page. It talks only to the API under its own base path and builds every element with
// createElement and textContent, so that no config text is ever parsed as HTML.

const BASE = location.pathname.replace(/[^/]*$/, "");
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const LAYERS = ["defaults", "user", "project", "profile"];
const LAYER_NUM = { defaults: 1, user: 2, project: 3, profile: 4 };
const LETTER = { defaults: "D", user: "U", project: "P", profile: "F" };
const FILES = ["user", "project"];
const ROOT_ONLY = new Set(["profile", "harnesses", "profiles"]);
const PING_MS = 5000;

const app = {
  state: null,
  explain: null,
  profile: "",
  profileError: null,
  editIn: "user",
  queues: { user: new Map(), project: new Map() },
  bases: { user: null, project: null },
  writing: null,
  route: { screen: "effective", key: null, name: null },
  filter: "",
  open: new Set(["roles", "limits", "root"]),
  stopped: false,
  conflict: null,
  blocked: null,
  fileError: {},
  review: null,
  toast: null,
  error: null,
  explainCache: new Map(),
  gen: 0,
  seq: { state: 0, explain: 0 },
  drafts: {},
  fileDrafts: {},
  issuesOpen: false,
  activeRow: null,
  live: [],
  keyPaths: new Map(),
};

// ---------- small helpers ----------

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  let value;
  if (props) {
    for (const [key, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (key === "class") el.className = v;
      else if (key === "text") el.textContent = v;
      else if (key === "value") value = v;
      else if (key.startsWith("on") && typeof v === "function") el.addEventListener(key.slice(2), v);
      else if (key === "checked" || key === "disabled" || key === "hidden" || key === "selected") el[key] = true;
      else el.setAttribute(key, v === true ? "" : String(v));
    }
  }
  append(el, kids);
  if (value !== undefined) el.value = value;
  return el;
}

function append(el, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(typeof kid === "string" || typeof kid === "number" ? String(kid) : kid);
  }
}

const pk = (path) => JSON.stringify(path);
const dotted = (path) => path.join(".");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

function fmt(value) {
  if (value === undefined) return "not set";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every((item) => item && typeof item === "object" && "model" in item)) {
      return `[${value.map((rung) => [rung.model, rung.effort].filter(Boolean).join(" ")).join(", ")}]`;
    }
    return `[${value.map(fmt).join(", ")}]`;
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function joinAnd(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function shortLabel(source) {
  if (source.kind === "defaults") return "defaults";
  if (source.kind === "profile") return shortLabel(source.declaredIn);
  return source.kind;
}

function sourceLabel(source) {
  if (!source) return "";
  if (source.kind === "defaults") return "defaults";
  if (source.kind === "profile") return `profile ${source.profile} (${shortLabel(source.declaredIn)})`;
  return source.kind;
}

function layerName(source) {
  return source.kind === "profile" ? `profile ${source.profile}` : source.kind;
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

// Stable row ids for a list editor. The editor updates them with each change it makes, and a store whose length no
// longer matches its list (the owner reset the list) starts over.
let lastRowId = 0;

function newRowId() {
  lastRowId += 1;
  return lastRowId;
}

function rowIds(store, length) {
  if (!store.ids || store.ids.length !== length) store.ids = Array.from({ length }, newRowId);
  return store.ids;
}

// ---------- API ----------

async function api(path, body) {
  const init = body === undefined
    ? {}
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  let response;
  try {
    response = await fetch(BASE + path, init);
  } catch {
    const error = new Error("the editor does not answer");
    error.code = "network";
    error.status = 0;
    throw error;
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = new Error(data && data.message ? data.message : `HTTP ${response.status}`);
    error.status = response.status;
    error.code = data && data.code ? data.code : "http";
    error.hint = data ? data.hint : undefined;
    error.newErrors = data ? data.newErrors : undefined;
    throw error;
  }
  return data;
}

function showError(error) {
  if (error.code === "network") {
    stop();
    return;
  }
  app.error = { message: error.message, hint: error.hint };
  render();
}

// ---------- data ----------

function file(kind) {
  return app.state.files.find((entry) => entry.kind === kind);
}

function parseError(kind) {
  const issue = file(kind).issues.find((item) => item.severity === "error" && item.path === "");
  if (issue) return issue.message;
  const err = app.fileError[kind];
  return err && err.code === "jsonc_parse" ? err.message : null;
}

function absent(kind) {
  return !file(kind).present || (app.fileError[kind] && app.fileError[kind].code === "config_not_found");
}

function usable(kind) {
  return !absent(kind) && !parseError(kind);
}

// While a write to a file runs, its edits are off, so that no edit can be made against the state the write replaces.
function writeLocked(kind) {
  return app.writing === kind;
}

function canEdit() {
  return !app.stopped && usable(app.editIn) && !writeLocked(app.editIn);
}

function index() {
  app.rootMap = new Map(app.explain.root.map((entry) => [pk(entry.path), entry]));
  app.effMap = new Map(app.explain.effective.map((entry) => [pk(entry.path), entry]));
  refreshDrafts();
}

function selectedProfileName() {
  return app.profile || app.explain.profile.name;
}

function rootValue(path) {
  const entry = app.rootMap.get(pk(path));
  return entry ? entry.value : undefined;
}

// The value that one file itself sets at a leaf path.
function fileValue(kind, path) {
  const entry = app.rootMap.get(pk(path));
  if (!entry) return undefined;
  if (entry.source.kind === kind) return entry.value;
  const over = entry.overridden.find((item) => item.source.kind === kind);
  return over ? over.value : undefined;
}

function fileSets(kind, path) {
  const key = pk(path);
  const prefix = key.slice(0, -1) + ",";
  for (const entry of app.explain.root) {
    const own = pk(entry.path);
    if (own !== key && !own.startsWith(prefix)) continue;
    if (entry.source.kind === kind || entry.overridden.some((item) => item.source.kind === kind)) return true;
  }
  return false;
}

function queued(kind, path) {
  return app.queues[kind].get(pk(path));
}

// A queue keeps the hash of the file text that its first edit was made on, so that a reload for the other file
// cannot move its base past a change that the user never saw. Each edit names the hash of the text that its draft or
// control was built on, and queues only onto that text: onto the queue's base, or onto the file when the queue is
// empty. Else the page shows the changed-on-disk state.
function draftFits(kind, from) {
  const base = queueCount(kind) ? app.bases[kind] : file(kind).hash;
  if (from === base) return true;
  app.conflict = { file: kind, message: `the ${kind} file changed after this edit started`, confirming: false };
  return false;
}

function enqueue(kind, path, edit, from = file(kind).hash) {
  if (writeLocked(kind) || !draftFits(kind, from)) return false;
  const queue = app.queues[kind];
  if (queue.size === 0) app.bases[kind] = file(kind).hash;
  queue.delete(pk(path));
  queue.set(pk(path), { path, ...edit });
  if (app.blocked && app.blocked.file === kind) app.blocked = null;
  if (app.review && app.review.previews[kind]) delete app.review.previews[kind];
  return true;
}

// A draft is editor input that is not queued yet, for the edit-in file. It records the file hash that it was built
// on, and only user input to one of its controls makes it dirty. Each new state builds every clean draft again from
// that state. A dirty draft keeps its input. When its file's hash changed, its notice keeps it out of the queue until
// the user keeps it on the new text or discards it, so that the page never moves an edit onto text that the user did
// not see.
// reset() clears the input that the editor builds from the state.
function fresh(draft, reset = draft.reset) {
  draft.reset = reset;
  reset(draft);
  draft.hash = file(app.editIn).hash;
  draft.dirty = false;
  return draft;
}

function touch(draft) {
  draft.dirty = true;
}

function stale(draft) {
  return draft.dirty && draft.hash !== file(app.editIn).hash;
}

function refreshDrafts() {
  for (const draft of Object.values(app.drafts)) if (draft && draft.reset && !draft.dirty) fresh(draft);
}

// app.drafts holds the drafts of the edit-in file. The drafts of the other file wait in app.fileDrafts, so that a
// switch of the edit-in file drops no input, and they come back when the page edits in that file again.
function switchEditIn(kind) {
  if (kind === app.editIn) return;
  app.fileDrafts[app.editIn] = app.drafts;
  app.drafts = app.fileDrafts[kind] || {};
  delete app.fileDrafts[kind];
  app.editIn = kind;
}

// An editor holds its draft in one slot. When the user opens another item in that editor, a dirty draft stays under
// the name of its item, and the editor takes it back when the user returns to that item.
function keepDraft(slot, id) {
  const draft = app.drafts[slot];
  if (draft && draft.dirty) app.drafts[`${slot}@${id}`] = draft;
  app.drafts[slot] = null;
}

function takeDraft(slot, id) {
  const draft = app.drafts[`${slot}@${id}`] || null;
  delete app.drafts[`${slot}@${id}`];
  app.drafts[slot] = draft;
  return draft;
}

// A text field that queues its edit on change keeps the typed text in a draft of its own until then.
function typedDraft(name) {
  return app.drafts[name] || (app.drafts[name] = fresh({}, (d) => { d.raw = null; }));
}

function typedText(name, value) {
  const draft = app.drafts[name];
  return draft && draft.raw !== null ? draft.raw : value;
}

// commit(raw, hash) queues the text on the file text with that hash and returns true when it did: the hash of the
// draft, or else seen, the hash of the text that the field was rendered on. The draft goes before that render, and
// comes back when the text does not queue.
function typedField(input, name, seen, commit) {
  input.addEventListener("input", () => {
    const draft = typedDraft(name);
    touch(draft);
    draft.raw = input.value;
  });
  let sent = null;
  const run = () => {
    const draft = app.drafts[name];
    if (draft && stale(draft)) {
      render();
      return;
    }
    if (input.value === sent) return;
    sent = input.value;
    delete app.drafts[name];
    if (!commit(input.value, draft && draft.dirty ? draft.hash : seen) && draft && draft.dirty) {
      app.drafts[name] = draft;
      render();
    }
  };
  input.addEventListener("change", run);
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") run(); });
}

function staleNotice(name) {
  const draft = app.drafts[name];
  if (!draft || !stale(draft)) return null;
  const disabled = !canEdit();
  const keep = () => { draft.hash = file(app.editIn).hash; };
  return h("div", { class: "stale" },
    h("p", { text: "Based on older text. The file changed after you started this edit." }),
    h("div", { class: "btnrow" },
      h("button", { type: "button", class: "btn", text: "Keep my edit", disabled, "data-fk": `stale:${name}:keep`, onclick: () => { keep(); render(); } }),
      h("button", { type: "button", class: "btn", text: "Discard", disabled, "data-fk": `stale:${name}:discard`, onclick: () => { fresh(draft); render(); } })));
}

function unqueue(kind, path) {
  if (writeLocked(kind)) return;
  app.queues[kind].delete(pk(path));
  if (app.queues[kind].size === 0) app.bases[kind] = null;
  if (app.blocked && app.blocked.file === kind) app.blocked = null;
}

function clearQueue(kind) {
  app.queues[kind].clear();
  app.bases[kind] = null;
}

function queueCount(kind) {
  return app.queues[kind].size;
}

function totalQueued() {
  return queueCount("user") + queueCount("project");
}

function canSet(layer, path) {
  if (layer === "profile") return !ROOT_ONLY.has(path[0]);
  if (layer === "defaults") return path[0] !== "defaults";
  return path[0] !== "workflow";
}

// Which layer sets a path and which layers it overrides. Root entries give the file layers, effective entries the profile.
function stackOf(path) {
  const key = pk(path);
  const root = app.rootMap.get(key);
  const eff = app.effMap.get(key);
  const rows = {};
  const put = (source, value, state) => {
    if (!rows[source.kind]) rows[source.kind] = { source, value, state };
  };
  let main = root || eff;
  const otherProfiles = [];
  if (eff && eff.source.kind === "profile") {
    main = eff;
    put(eff.source, eff.value, "win");
    for (const item of eff.overridden) if (item.source.kind === "profile") otherProfiles.push(item.source.profile);
    if (root) {
      put(root.source, root.value, "over");
      for (const item of root.overridden) put(item.source, item.value, "over");
    } else {
      for (const item of eff.overridden) put(item.source, item.value, "over");
    }
  } else if (main) {
    put(main.source, main.value, "win");
    for (const item of main.overridden) put(item.source, item.value, "over");
  }
  return {
    path,
    rows,
    winner: main ? main.source.kind : null,
    value: main ? main.value : undefined,
    source: main ? main.source : undefined,
    otherProfiles,
  };
}

function harnessStack() {
  const stack = stackOf(["harnesses"]);
  if (stack.winner) return stack;
  return {
    path: ["harnesses"],
    rows: { defaults: { source: { kind: "defaults" }, value: undefined, state: "win" } },
    winner: "defaults",
    value: undefined,
    source: { kind: "defaults" },
    otherProfiles: [],
    noKey: true,
  };
}

// The higher layers that set the edited path, highest first.
function overridesOf(kind, path) {
  const out = [];
  if (path[0] === "profiles" && path.length > 2) {
    const entry = app.rootMap.get(pk(path));
    if (kind === "user" && entry && entry.source.kind === "project") out.push({ who: "project", value: entry.value });
    return out;
  }
  const eff = app.effMap.get(pk(path));
  if (eff && eff.source.kind === "profile") out.push({ who: `profile ${eff.source.profile}`, value: eff.value });
  const entry = app.rootMap.get(pk(path));
  if (kind === "user" && entry && entry.source.kind === "project") out.push({ who: "project", value: entry.value });
  return out;
}

function allIssues() {
  const seen = new Set();
  const out = [];
  for (const issue of [...app.state.issues, ...app.state.files.flatMap((entry) => entry.issues)]) {
    const key = pk([issue.source, issue.path, issue.message]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}

function issueSource(source) {
  const match = app.state.files.find((entry) => entry.path === source);
  return match ? match.kind : source;
}

function blockedFor(path) {
  if (!app.blocked) return [];
  const key = dotted(path);
  return app.blocked.errors.filter((issue) => {
    const where = issue.path.replace(/\[\d+\].*$/, "");
    return where === key || where.startsWith(key + ".") || (key.startsWith(where + ".") && where.split(".").length > 2);
  });
}

function roleNames() {
  const names = [];
  for (const entry of [...app.explain.root, ...app.explain.effective]) {
    if (entry.path[0] === "roles" && !names.includes(entry.path[1])) names.push(entry.path[1]);
  }
  return names;
}

function knownKinds() {
  const kinds = new Set();
  for (const entry of [...app.explain.root, ...app.explain.effective]) {
    if (entry.path[0] === "roles" && entry.path[2] === "chain" && Array.isArray(entry.value)) {
      for (const rung of entry.value) {
        if (rung && typeof rung === "object") kinds.add(rung.driver || rung.provider);
      }
    }
  }
  const list = rootValue(["harnesses"]);
  if (Array.isArray(list)) for (const kind of list) kinds.add(kind);
  for (const kind of FILES) {
    const edit = queued(kind, ["harnesses"]);
    if (edit && Array.isArray(edit.value)) for (const item of edit.value) kinds.add(item);
  }
  kinds.delete(undefined);
  return [...kinds].sort();
}

// ---------- state loading ----------

// Each state bumps the generation. A response that a request of an older generation gets is dropped, so that the
// values, the hashes, and the explain report on screen always come from one state.
function setState(state) {
  app.gen += 1;
  app.state = state;
  app.explainCache.clear();
  if (!app.profile) app.profile = state.selectedProfile;
  app.explain = state.explain;
  app.profileError = null;
  if (state.explain.effective.length === 0) {
    const issue = state.issues.find((item) => item.severity === "error");
    app.profileError = issue ? issue.message : "the profile does not resolve";
  }
  const editIn = usable(app.editIn) ? app.editIn : usable("user") ? "user" : usable("project") ? "project" : app.editIn;
  switchEditIn(editIn);
  index();
  if (app.profile !== state.explain.profile.name && state.profiles.includes(app.profile)) void pickProfile(app.profile);
}

async function loadState() {
  const token = ++app.seq.state;
  const gen = app.gen;
  const current = () => token === app.seq.state && gen === app.gen;
  try {
    const state = await api("api/state");
    if (!current()) return;
    setState(state);
  } catch (error) {
    if (current()) showError(error);
    return;
  }
  render();
}

async function pickProfile(name) {
  app.profile = name;
  const token = ++app.seq.explain;
  const gen = app.gen;
  const current = () => token === app.seq.explain && gen === app.gen;
  try {
    const report = await api(`api/explain?profile=${encodeURIComponent(name)}`);
    if (!current()) return;
    app.explain = report;
    app.profileError = null;
  } catch (error) {
    if (!current()) return;
    if (error.code === "profile_invalid") {
      app.profileError = error.message;
      app.explain = { ...app.state.explain, profile: { name, source: "config" }, effective: [] };
    } else {
      showError(error);
      return;
    }
  }
  index();
  render();
}

async function explainFor(name) {
  if (name === app.explain.profile.name && !app.profileError) return app.explain;
  if (app.explainCache.has(name)) return app.explainCache.get(name);
  app.explainCache.set(name, null);
  const gen = app.gen;
  let report;
  try {
    report = await api(`api/explain?profile=${encodeURIComponent(name)}`);
  } catch (error) {
    report = { error: error.message };
  }
  if (gen !== app.gen || app.explainCache.get(name) !== null) return app.explainCache.get(name);
  app.explainCache.set(name, report);
  render();
  return app.explainCache.get(name);
}

// ---------- ping and close ----------

let pingTimer;

function stop() {
  if (app.stopped) return;
  app.stopped = true;
  clearInterval(pingTimer);
  render();
}

async function ping() {
  if (app.stopped) return;
  try {
    const response = await fetch(BASE + "api/ping", { method: "POST" });
    if (!response.ok) stop();
  } catch {
    stop();
  }
}

// ---------- routing ----------

function parseHash() {
  const hash = location.hash.replace(/^#/, "");
  const at = hash.indexOf("?");
  const route = at === -1 ? hash : hash.slice(0, at);
  const params = new URLSearchParams(at === -1 ? "" : hash.slice(at + 1));
  const parts = route.split("/").filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  if (parts[0] === "role" && parts[1]) return { screen: "role", name: parts[1], key: null };
  if (parts[0] === "profile" && parts[1]) return { screen: "profile", name: parts[1], key: null };
  if (parts[0] === "root") return { screen: "root", name: null, key: null };
  return { screen: "effective", name: null, key: params.get("key") };
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

// ---------- rendering ----------

let pointerDown = false;
let renderPending = false;

function render() {
  if (pointerDown) {
    renderPending = true;
    return;
  }
  renderPending = false;
  // data-fid names a control by the row id of its list item, so focus follows a rung or an option that moved.
  const data = document.activeElement && document.activeElement.dataset;
  const focused = data && (data.fid ? ["fid", data.fid] : data.fk ? ["fk", data.fk] : undefined);
  const scrolls = {};
  for (const el of document.querySelectorAll("[data-scroll]")) scrolls[el.dataset.scroll] = [el.scrollTop, el.scrollLeft];
  app.live = [];
  renderCmdbar();
  renderContent();
  renderReview();
  renderBanners();
  renderStatus();
  runLive();
  for (const el of document.querySelectorAll("[data-scroll]")) {
    const saved = scrolls[el.dataset.scroll];
    if (saved) [el.scrollTop, el.scrollLeft] = saved;
  }
  if (focused) {
    const target = document.querySelector(`[data-${focused[0]}="${CSS.escape(focused[1])}"]`);
    if (target && document.activeElement !== target) target.focus({ preventScroll: true });
  }
  if (app.stopped) {
    for (const el of document.querySelectorAll("#cmdbar select, #content input, #content select, #content button, #content textarea, #review-host button, #banners .btn, #statusbar .review-btn")) {
      el.disabled = true;
    }
  }
}

function runLive() {
  for (const fn of app.live) fn();
}

function seg(options, current, onPick, props = {}) {
  const group = h("div", { class: `seg${props.small ? " small" : ""}`, role: "radiogroup", "aria-label": props.label });
  const buttons = options.map((option) => {
    const value = typeof option === "string" ? option : option.value;
    const label = typeof option === "string" ? option : option.label;
    const selected = value === current;
    return h("button", {
      type: "button",
      class: `seg-item${selected ? " on" : ""}`,
      role: "radio",
      "aria-checked": selected ? "true" : "false",
      tabindex: selected || (current === undefined && option === options[0]) ? "0" : "-1",
      disabled: props.disabled || (typeof option === "object" && option.disabled),
      "aria-disabled": typeof option === "object" && option.disabled ? "true" : undefined,
      title: typeof option === "object" ? option.title : undefined,
      "data-fk": props.fk ? `${props.fk}:${value}` : undefined,
      onclick: () => onPick(value),
      text: label,
    });
  });
  group.addEventListener("keydown", (event) => radioKeys(event, buttons));
  append(group, buttons);
  return group;
}

function radioKeys(event, items) {
  const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  if (!(event.key in keys)) return;
  event.preventDefault();
  const enabled = items.filter((item) => !item.disabled);
  const at = enabled.indexOf(document.activeElement);
  const next = enabled[(at + keys[event.key] + enabled.length) % enabled.length];
  if (next) {
    next.focus();
    next.click();
  }
}

// A select or a checkbox reports its pick on input. Change runs the pick only when no input event came first.
function onPick(el, read, pick) {
  let last = read();
  const run = () => {
    const value = read();
    if (value === last) return;
    last = value;
    pick(value);
  };
  el.addEventListener("input", run);
  el.addEventListener("change", run);
  return el;
}

function checkbox(checked, props, pick) {
  const el = h("input", { type: "checkbox", checked, ...props });
  return onPick(el, () => el.checked, pick);
}

function select(options, current, pick, props = {}) {
  const el = h("select", {
    class: props.class,
    "aria-label": props.label,
    disabled: props.disabled,
    "data-fk": props.fk,
    "data-fid": props.fid,
  }, options.map((option) => {
    const value = typeof option === "string" ? option : option.value;
    const label = typeof option === "string" ? option : option.label;
    return h("option", { value, text: label });
  }));
  el.value = current;
  onPick(el, () => el.value, pick);
  return h("span", { class: `select${props.dashed ? " dashed" : ""}${props.wide ? " wide" : ""}${props.error ? " error" : ""}` }, el,
    h("span", { class: "caret", "aria-hidden": "true", text: "▼" }));
}

function copyButton(command) {
  return h("button", {
    type: "button",
    class: "link copy",
    "aria-label": `Copy ${command}`,
    text: "copy",
    onclick: (event) => {
      const button = event.currentTarget;
      const done = () => {
        button.textContent = "copied";
        setTimeout(() => { button.textContent = "copy"; }, 1500);
      };
      if (navigator.clipboard) navigator.clipboard.writeText(command).then(done, () => {});
    },
  });
}

function cmdLine(command, extra) {
  return h("div", { class: "cmdline" }, h("span", { class: "prompt", text: "$" }), h("code", { text: command }), copyButton(command),
    extra ? h("span", { class: "muted", text: extra }) : null);
}

// ---------- command bar ----------

function renderCmdbar() {
  const state = app.state;
  if (!state) return;
  document.getElementById("version").textContent = `v${state.version}`;
  const picker = document.getElementById("profile-picker");
  picker.replaceChildren(...state.profiles.map((name) => h("option", { value: name, text: name })));
  if (!state.profiles.includes(app.profile)) picker.append(h("option", { value: app.profile, text: app.profile }));
  picker.value = app.profile;
  picker.disabled = app.stopped;
  const group = document.getElementById("edit-in");
  const items = FILES.map((kind) => {
    const reason = absent(kind) ? `the ${kind} file does not exist` : parseError(kind) ? `the ${kind} file does not parse` : null;
    const selected = app.editIn === kind;
    return h("button", {
      type: "button",
      class: `seg-item${selected ? " on" : ""}${reason ? " off" : ""}`,
      role: "radio",
      "aria-checked": selected ? "true" : "false",
      "aria-disabled": reason ? "true" : undefined,
      title: reason || undefined,
      tabindex: selected ? "0" : "-1",
      "data-fk": `editin:${kind}`,
      disabled: app.stopped,
      text: kind,
      onclick: () => {
        if (reason || kind === app.editIn) return;
        switchEditIn(kind);
        refreshDrafts();
        render();
      },
    });
  });
  group.replaceChildren(...items);
  group.onkeydown = (event) => radioKeys(event, items);
}

// ---------- content ----------

function renderContent() {
  const content = document.getElementById("content");
  if (!app.state) return;
  const screen = app.route.screen;
  let node;
  if (screen === "role") node = roleScreen();
  else if (screen === "profile") node = profileScreen();
  else if (screen === "root") node = rootScreen();
  else node = effectiveScreen();
  content.replaceChildren(node);
  content.classList.toggle("dim", Boolean(app.review));
  content.inert = Boolean(app.review);
  document.getElementById("cmdbar").inert = Boolean(app.review);
}

// ----- s1 / s2 -----

function effectiveScreen() {
  return h("section", { class: "screen-effective" }, pipeline(), h("div", { class: "columns" },
    h("div", { class: "tree-col", "data-scroll": "tree" }, notices(), filterRow(), tree()),
    inspector()));
}

function pipeline() {
  const state = app.state;
  const card = (layer, title, lines, props = {}) => {
    const cells = LAYERS.map((item) => h("span", { class: `cell${item === layer ? " self" : ""}` }));
    return h("div", { class: `pcard${props.cls ? ` ${props.cls}` : ""}` },
      h("div", { class: "pcard-head" }, h("span", { class: "strip mini", "aria-hidden": "true" }, cells),
        h("span", { class: "meta-caps", text: `${LAYER_NUM[layer]} · ${layer.toUpperCase()}` }), props.badge || null),
      lines);
  };
  const source = state.defaults.source;
  const accepted = source === "current" ? "from this release" : "last accepted configuration";
  const keysOf = (kind) => app.explain.root.filter((entry) => entry.source.kind === kind).length;
  const fileCard = (kind) => {
    const entry = file(kind);
    const missing = absent(kind);
    return card(kind, kind, [
      h("div", { class: "pcard-path", title: entry.path }, h("bdi", { text: entry.path })),
      h("div", { class: "pcard-sub", text: missing ? "the layer is empty" : plural(keysOf(kind), "key") }),
    ], {
      cls: missing ? "absent" : parseError(kind) ? "broken" : "",
      badge: h("span", { class: missing ? "badge warn" : "badge ok", text: missing ? "absent" : "present" }),
    });
  };
  const name = app.explain.profile.name;
  const preset = state.vocab.presetProfiles.includes(name) && !app.explain.root.some((entry) =>
    entry.path[0] === "profiles" && entry.path[1] === name && entry.source.kind !== "defaults");
  const declared = app.explain.root.find((entry) => entry.path[0] === "profiles" && entry.path[1] === name);
  const ext = rootValue(["profiles", name, "extends"]);
  const profileSub = [preset ? "preset" : `from ${declared ? shortLabel(declared.source) : "defaults"}`];
  if (ext) profileSub.push(`extends ${ext}`);
  return h("div", { class: "pipeline" },
    card("defaults", "defaults", [h("div", { class: "pcard-val", text: "active defaults" }), h("div", { class: "pcard-sub", text: accepted })], { cls: "c-defaults" }),
    h("span", { class: "arrow", text: "→" }),
    fileCard("user"),
    h("span", { class: "arrow", text: "→" }),
    fileCard("project"),
    h("span", { class: "arrow", text: "→" }),
    card("profile", "profile", [h("div", { class: "pcard-val", text: app.profile }), h("div", { class: "pcard-sub", text: profileSub.join(" · ") })], { cls: "c-profile" }),
    h("span", { class: "eq", text: "=" }),
    h("div", { class: "pcard effective" }, h("div", { class: "eff-title", text: "EFFECTIVE" }), h("div", { text: "what runs" })));
}

function notices() {
  const out = [];
  for (const kind of FILES) {
    if (absent(kind)) {
      const command = kind === "project" ? "omt init" : "omt config init";
      const other = kind === "project" ? "user file: omt config init" : "project file: omt init";
      out.push(h("div", { class: "notice" },
        h("div", { class: "notice-card absent" }, h("span", { class: "meta-caps", text: `${LAYER_NUM[kind]} · ${kind.toUpperCase()}` }),
          h("span", { class: "badge warn", text: " absent" }), h("div", { class: "notice-path", text: file(kind).path })),
        h("p", { class: "prose", text: `Edit in ${kind} is off and the ${kind} layer is empty. The editor does not create files.` }),
        cmdLine(command, `then reload · ${other}`)));
    } else if (parseError(kind)) {
      out.push(h("div", { class: "notice" },
        h("p", { class: "err", text: `✕ ${file(kind).path}: ${parseError(kind)}` }),
        h("p", { text: `Edit in ${kind} is off until the file parses. Fix it, then reload.` }),
        usable(kind === "user" ? "project" : "user") ? h("p", { class: "muted", text: `Edits for ${kind === "user" ? "project" : "user"} still work.` }) : null));
    }
  }
  if (app.profileError) {
    out.push(h("div", { class: "notice" }, h("p", {
      class: "warn-text",
      text: `profile ${app.profile}: ${app.profileError}. The tree shows root values only. Pick another profile, or fix extends in the profile editor.`,
    })));
  }
  return out;
}

function filterRow() {
  const input = h("input", {
    type: "text",
    id: "filter",
    class: "filter-input",
    placeholder: "filter keys, e.g. roles.review",
    "aria-label": "Filter keys",
    autocomplete: "off",
    spellcheck: "false",
    "data-fk": "filter",
    value: app.filter,
  });
  input.addEventListener("input", () => {
    app.filter = input.value;
    renderTreeOnly();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      app.filter = "";
      input.value = "";
      renderTreeOnly();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      const first = document.querySelector(".tree [role=treeitem]");
      if (first) first.focus();
    }
  });
  const legendCells = [h("span", { class: "cell over" }), h("span", { class: "cell unset" }), h("span", { class: "cell unset" }), h("span", { class: "cell win" })];
  return h("div", { class: "filter-row" },
    h("label", { class: "filter" }, h("span", { class: "slash", text: "/" }), input),
    h("span", { class: "legend" }, "strip = D U P F ", h("span", { class: "strip", "aria-hidden": "true" }, legendCells), " purple wins · gray overridden"));
}

function renderTreeOnly() {
  const old = document.querySelector(".tree");
  if (old) old.replaceWith(tree());
}

function strip(stack) {
  const cells = LAYERS.map((layer) => {
    const row = stack.rows[layer];
    const cls = !canSet(layer, stack.path) ? "na" : row && row.state === "win" ? "win" : row ? "over" : "unset";
    return h("span", { class: `cell ${cls}` });
  });
  const over = LAYERS.filter((layer) => stack.rows[layer] && stack.rows[layer].state === "over");
  const label = stack.winner ? `${stack.winner} wins${over.length ? `; ${joinAnd(over)} overridden` : ""}` : "not set";
  return h("span", { class: "strip", role: "img", "aria-label": label }, cells);
}

function queuedNote(path) {
  const notes = [];
  for (const kind of FILES) {
    const edit = queued(kind, path) || queued(kind, ["profiles", selectedProfileName(), ...path]);
    if (edit) notes.push(`${kind} ${edit.remove ? "reset" : fmt(edit.value)} queued`);
  }
  return notes.length ? ` · ${notes.join(" · ")}` : "";
}

function treeModel() {
  const ex = app.explain;
  const effOk = ex.effective.length > 0;
  const leaves = (prefix) => (effOk && prefix !== "profiles" ? ex.effective : ex.root).filter((entry) => entry.path[0] === prefix);
  const rows = [];
  const filter = app.filter.trim().toLowerCase();
  const leafRow = (entry, level, label, extra = {}) => {
    const stack = extra.stack || stackOf(entry.path);
    let value = extra.value !== undefined ? extra.value : fmt(stack.value);
    const root = rootValue(entry.path);
    let rootNote = "";
    if (effOk && root !== undefined && !same(root, stack.value) && entry.path[0] !== "workflow") rootNote = ` (root ${fmt(root)})`;
    return { kind: "leaf", id: `k:${pk(entry.path)}`, path: entry.path, label, level, value, rootNote, stack, queuedNote: queuedNote(entry.path) };
  };
  const matches = (path) => !filter || dotted(path).toLowerCase().includes(filter);

  // roles
  const roleEntries = leaves("roles");
  const byRole = new Map();
  for (const entry of roleEntries) {
    if (!byRole.has(entry.path[1])) byRole.set(entry.path[1], []);
    byRole.get(entry.path[1]).push(entry);
  }
  rows.push({ kind: "group", id: "g:roles", group: "roles", label: "roles", count: String(byRole.size), action: "+ role", actionHash: "#/role/+new" });
  if (filter || app.open.has("roles")) {
    const bucket = [];
    for (const [name, entries] of byRole) {
      const visible = entries.filter((entry) => matches(entry.path));
      if (filter) {
        if (visible.length === 0) continue;
        rows.push({ kind: "role", id: `r:${name}`, name, label: name, level: 1, open: true });
        for (const entry of visible) rows.push(leafRow(entry, 2, entry.path[2]));
        continue;
      }
      const changed = entries.filter((entry) => stackOf(entry.path).winner !== "defaults");
      if (changed.length === 0) {
        bucket.push([name, entries]);
        continue;
      }
      pushRole(rows, name, entries, changed, 1, leafRow);
    }
    if (!filter && bucket.length > 0) {
      const open = app.open.has("bucket");
      rows.push({ kind: "bucket", id: "b:roles", label: `${plural(bucket.length, "role")} · defaults ${ex.defaults.set} only`, level: 1, open });
      if (open) for (const [name, entries] of bucket) pushRole(rows, name, entries, [], 2, leafRow);
    }
  }

  // removed objects
  for (const item of ex.removed) {
    if (!matches(item.path)) continue;
    rows.push({ kind: "removed", id: `x:${pk(item.path)}`, path: item.path, label: dotted(item.path), level: 1, source: `removed by ${sourceLabel(item.source)}` });
  }

  // profiles
  const presets = app.state.vocab.presetProfiles;
  const own = app.state.profiles.filter((name) => !presets.includes(name));
  const summary = own.map((name) => {
    const entry = ex.root.find((item) => item.path[0] === "profiles" && item.path[1] === name);
    return `${name} from ${entry ? shortLabel(entry.source) : "defaults"}`;
  });
  summary.push(plural(app.state.profiles.length - own.length, "preset"));
  rows.push({ kind: "group", id: "g:profiles", group: "profiles", label: "profiles", count: `${app.state.profiles.length} · ${summary.join(", ")}`, action: "+ profile", actionHash: "#/profile/+new" });
  if (filter || app.open.has("profiles")) {
    for (const name of app.state.profiles) {
      if (filter && !`profiles.${name}`.includes(filter)) continue;
      const entry = ex.root.find((item) => item.path[0] === "profiles" && item.path[1] === name);
      const stack = entry ? stackOf(entry.path) : { path: ["profiles", name], rows: {}, winner: null };
      rows.push({
        kind: "profile", id: `p:${name}`, name, label: name, level: 1,
        value: rootValue(["profiles", name, "description"]) || "", stack,
        source: presets.includes(name) && stack.winner === "defaults" ? "preset" : entry ? sourceLabel(entry.source) : "",
      });
    }
  }

  // limits
  const limitEntries = leaves("limits").filter((entry) => matches(entry.path));
  if (!filter || limitEntries.length > 0) {
    rows.push({ kind: "group", id: "g:limits", group: "limits", label: "limits", count: "" });
    if (filter || app.open.has("limits")) for (const entry of limitEntries) rows.push(leafRow(entry, 1, entry.path[1]));
  }

  // workflow of the selected profile
  const workflow = effOk ? ex.effective.filter((entry) => entry.path[0] === "workflow" && matches(entry.path)) : [];
  if (workflow.length > 0 && (!filter || workflow.length > 0)) {
    rows.push({ kind: "group", id: "g:workflow", group: "workflow", label: "workflow", count: String(workflow.length) });
    if (filter || app.open.has("workflow")) for (const entry of workflow) rows.push(leafRow(entry, 1, entry.path.slice(1).join(".")));
  }

  // root settings
  const rootRows = [];
  const harness = harnessStack();
  if (matches(["harnesses"])) {
    rootRows.push(leafRow({ path: ["harnesses"] }, 1, "harnesses", harness.noKey ? { stack: harness, value: "every driver (no key)" } : { stack: harness }));
  }
  for (const entry of leaves("models")) if (matches(entry.path)) rootRows.push(leafRow(entry, 1, dotted(entry.path)));
  for (const path of [["profile"]]) {
    const entry = app.rootMap.get(pk(path));
    if (entry && matches(path)) rootRows.push(leafRow(entry, 1, path[0], { value: JSON.stringify(entry.value) }));
  }
  if (!filter || rootRows.length > 0) {
    rows.push({ kind: "group", id: "g:root", group: "root", label: "harnesses · models · profile", count: "", action: "edit", actionHash: "#/root" });
    if (filter || app.open.has("root")) rows.push(...rootRows);
  }
  return rows;
}

function pushRole(rows, name, entries, changed, level, leafRow) {
  const id = `r:${name}`;
  const open = app.open.has(id);
  if (!open && changed.length === 1) {
    const entry = changed[0];
    rows.push({ ...leafRow(entry, level, `${name}.${entry.path[2]}`), kind: "leaf", roleToggle: id, collapsedRole: true });
    return;
  }
  if (!open) {
    const access = entries.find((entry) => entry.path[2] === "access");
    const chain = entries.find((entry) => entry.path[2] === "chain");
    const first = chain && Array.isArray(chain.value) ? chain.value[0] : undefined;
    const parts = [access ? fmt(access.value) : "", first ? [first.model, first.effort].filter(Boolean).join(" ") : ""].filter(Boolean);
    const lead = changed[0] || access || entries[0];
    const stack = stackOf(lead.path);
    const fresh = access && stackOf(access.path).winner !== "defaults" && !app.explain.root.some((entry) =>
      entry.path[1] === name && entry.path[0] === "roles" && (entry.source.kind === "defaults" || entry.overridden.some((item) => item.source.kind === "defaults")));
    rows.push({ kind: "role", id, name, label: name, level, open: false, value: parts.join(" · "), stack, source: `${sourceLabel(stack.source)}${fresh ? " · new role" : ""}` });
    return;
  }
  rows.push({ kind: "role", id, name, label: name, level, open: true });
  for (const entry of entries) rows.push(leafRow(entry, level + 1, entry.path[2]));
}

function tree() {
  const rows = treeModel();
  app.keyPaths = new Map(rows.filter((row) => row.path).map((row) => [dotted(row.path), row.path]));
  const container = h("div", { class: "tree", role: "tree", "aria-label": "Config keys", "aria-busy": "false" });
  const selected = app.route.key;
  const items = [];
  for (const row of rows) {
    const el = treeRow(row, selected);
    if (el.getAttribute("role") === "treeitem") items.push(el);
    container.append(el);
  }
  const active = items.find((el) => el.dataset.id === app.activeRow) || items.find((el) => el.classList.contains("sel")) || items[0];
  if (active) active.tabIndex = 0;
  container.addEventListener("keydown", (event) => treeKeys(event, items, rows));
  if (app.filter.trim() && !rows.some((row) => row.kind === "leaf" || row.kind === "profile" || row.kind === "removed")) {
    container.append(emptyFilter());
  }
  return container;
}

function emptyFilter() {
  const filter = app.filter.trim();
  const keys = [];
  for (const entry of [...app.explain.root, ...app.explain.effective]) keys.push(dotted(entry.path));
  for (const name of roleNames()) keys.push(`roles.${name}`);
  let best = null;
  let bestDistance = Infinity;
  for (const key of new Set(keys)) {
    const distance = editDistance(filter, key);
    if (distance < bestDistance) {
      best = key;
      bestDistance = distance;
    }
  }
  return h("div", { class: "empty-filter" }, h("p", { text: `/ ${filter}` }),
    h("p", { text: best && bestDistance <= 3 ? `no key matches. Did you mean ${best}?` : "no key matches." }));
}

function treeRow(row, selected) {
  const caret = (open) => h("span", { class: "tcaret", "aria-hidden": "true", text: open ? "▾" : "▸" });
  if (row.kind === "group") {
    const open = app.filter.trim() !== "" || app.open.has(row.group);
    return h("div", {
      class: "trow group", role: "treeitem", "aria-expanded": open ? "true" : "false", tabindex: "-1",
      "data-id": row.id, "data-fk": `tree:${row.id}`,
      onclick: (event) => {
        if (event.target.closest(".gaction")) return;
        toggleOpen(row.group);
      },
    }, caret(open), h("span", { class: "gname", text: row.label }), h("span", { class: "gcount", text: row.count }), h("span", { class: "spacer" }),
    row.action ? h("a", { class: "gaction", href: row.actionHash, text: row.action, tabindex: "-1" }) : null);
  }
  if (row.kind === "bucket") {
    return h("div", {
      class: `trow bucket lvl-${row.level}`, role: "treeitem", "aria-expanded": row.open ? "true" : "false", tabindex: "-1",
      "data-id": row.id, "data-fk": `tree:${row.id}`, onclick: () => toggleOpen("bucket"),
    }, caret(row.open), h("span", { class: "tkey wide muted", text: row.label }));
  }
  if (row.kind === "removed") {
    return h("div", { class: `trow lvl-${row.level}`, role: "treeitem", tabindex: "-1", "data-id": row.id, "data-fk": `tree:${row.id}` },
      h("span", { class: "tkey struck", text: row.label }), h("span", { class: "tval" }), h("span", { class: "strip-slot" }),
      h("span", { class: "tsrc", text: row.source }));
  }
  if (row.kind === "role" || row.kind === "profile") {
    const isRole = row.kind === "role";
    const hash = isRole ? `#/role/${encodeURIComponent(row.name)}` : `#/profile/${encodeURIComponent(row.name)}`;
    return h("div", {
      class: `trow ${row.kind} lvl-${row.level}`, role: "treeitem", tabindex: "-1",
      "aria-expanded": isRole ? (row.open ? "true" : "false") : undefined,
      "data-id": row.id, "data-fk": `tree:${row.id}`,
      onclick: (event) => {
        if (event.target.closest(".tcaret")) toggleOpen(row.id);
        else go(hash);
      },
    }, isRole ? caret(row.open) : null, h("span", { class: "tkey", text: row.label }),
    h("span", { class: "tval", text: row.value || "" }),
    row.stack ? strip(row.stack) : h("span", { class: "strip-slot" }),
    h("span", { class: `tsrc${row.stack && row.stack.winner === "profile" ? " accent" : ""}`, text: row.source || "" }));
  }
  const key = dotted(row.path);
  const errors = blockedFor(row.path);
  const isSel = selected === key;
  const winnerProfile = row.stack.winner === "profile";
  return h("div", {
    class: `trow leaf lvl-${row.level}${isSel ? " sel" : ""}${errors.length ? " error" : ""}`, role: "treeitem", tabindex: "-1",
    "aria-selected": isSel ? "true" : "false",
    "aria-expanded": row.collapsedRole ? "false" : undefined,
    "data-id": row.id, "data-fk": `tree:${row.id}`,
    onclick: (event) => {
      if (row.roleToggle && event.target.closest(".tcaret")) {
        toggleOpen(row.roleToggle);
        return;
      }
      app.activeRow = row.id;
      go(`#/?key=${encodeURIComponent(key)}`);
    },
  }, row.collapsedRole ? caret(false) : null,
  h("span", { class: "tkey", text: row.label }),
  h("span", { class: "tval" },
    errors.length ? h("span", { class: "err", text: `${row.value} · ${errors[0].message}` }) : row.value,
    row.rootNote && !errors.length ? h("span", { class: "muted", text: row.rootNote }) : null,
    row.queuedNote ? h("span", { class: "queued-note", text: row.queuedNote }) : null),
  strip(row.stack),
  errors.length ? h("span", { class: "tsrc err", text: "✕ error" }) : h("span", { class: `tsrc${winnerProfile ? " accent" : ""}`, text: sourceLabel(row.stack.source) }));
}

function toggleOpen(id) {
  if (app.open.has(id)) app.open.delete(id);
  else app.open.add(id);
  app.activeRow = id.startsWith("r:") ? id : `g:${id}`;
  if (id === "bucket") app.activeRow = "b:roles";
  render();
}

function treeKeys(event, items, rows) {
  const at = items.indexOf(document.activeElement);
  if (at === -1) return;
  const el = items[at];
  const row = rows.find((item) => item.id === el.dataset.id);
  const move = (index) => {
    const next = items[Math.max(0, Math.min(items.length - 1, index))];
    if (!next) return;
    el.tabIndex = -1;
    next.tabIndex = 0;
    app.activeRow = next.dataset.id;
    next.focus();
  };
  const toggleId = row.kind === "group" ? row.group : row.kind === "bucket" ? "bucket" : row.kind === "role" ? row.id : row.roleToggle;
  if (event.key === "ArrowDown") move(at + 1);
  else if (event.key === "ArrowUp") move(at - 1);
  else if (event.key === "Home") move(0);
  else if (event.key === "End") move(items.length - 1);
  else if (event.key === "ArrowRight") {
    if (toggleId && el.getAttribute("aria-expanded") === "false") toggleOpen(toggleId);
    else move(at + 1);
  } else if (event.key === "ArrowLeft") {
    if (toggleId && el.getAttribute("aria-expanded") === "true") toggleOpen(toggleId);
    else {
      const level = Number((el.className.match(/lvl-(\d)/) || [])[1] || 0);
      for (let index = at - 1; index >= 0; index--) {
        const other = Number((items[index].className.match(/lvl-(\d)/) || [])[1] || 0);
        if (other < level || items[index].classList.contains("group")) {
          move(index);
          break;
        }
      }
    }
  } else if (event.key === "Enter") {
    if (row.kind === "role") go(`#/role/${encodeURIComponent(row.name)}`);
    else if (row.kind === "profile") go(`#/profile/${encodeURIComponent(row.name)}`);
    else if (row.kind === "group" && row.group === "root") go("#/root");
    else if (toggleId && row.kind !== "leaf") toggleOpen(toggleId);
    else if (row.kind === "leaf") el.click();
  } else return;
  event.preventDefault();
}

// ----- inspector -----

function blockedCard() {
  if (!app.blocked) return null;
  const errors = app.blocked.errors;
  return h("div", { class: "blocked" },
    h("div", { class: "meta-caps err", text: `WRITE BLOCKED · ${errors.length} NEW ERROR${errors.length === 1 ? "" : "S"}` }),
    errors.map((issue) => h("p", { text: `${issue.path}: ${issue.message}` })),
    h("p", { class: "prose muted", text: "Fix the value, then open the review again. Nothing was written." }));
}

function inspector() {
  const key = app.route.key;
  const path = key ? app.keyPaths.get(key) || findPath(key) : null;
  if (!path) {
    return h("aside", { class: "inspector", "data-scroll": "insp" }, blockedCard(),
      h("p", { class: "insp-empty", text: "Select a key to see where its value comes from." }));
  }
  const stack = path[0] === "harnesses" ? harnessStack() : stackOf(path);
  const valueText = stack.noKey ? "every driver" : fmt(stack.value);
  return h("aside", { class: "inspector", "data-scroll": "insp" },
    blockedCard(),
    h("section", { class: "insp-head" },
      h("div", { class: "meta-caps", text: "INSPECTOR" }),
      h("h2", { class: "insp-path", text: key }),
      h("div", { class: "insp-value-line" }, h("span", { class: "insp-value", text: valueText }),
        h("span", { class: `insp-src${stack.winner === "profile" ? " accent" : ""}`, text: sourceLabel(stack.source) }))),
    sourceStack(stack),
    editPanel(path, stack));
}

function findPath(key) {
  for (const entry of [...app.explain.root, ...app.explain.effective]) if (dotted(entry.path) === key) return entry.path;
  if (key === "harnesses") return ["harnesses"];
  return null;
}

function sourceStack(stack) {
  const path = stack.path;
  const leaf = path.at(-1);
  const profileName = selectedProfileName();
  const edit = queued(app.editIn, path);
  const profileEdit = path[0] !== "profiles" && !ROOT_ONLY.has(path[0]) ? queued(app.editIn, ["profiles", profileName, ...path]) : undefined;
  const winIndex = LAYERS.indexOf(stack.winner);
  const items = LAYERS.map((layer, index) => {
    const row = stack.rows[layer];
    const isQueued = (layer === app.editIn && edit) || (layer === "profile" && profileEdit);
    const title = layer === "profile" ? `4 profile ${row ? row.source.profile : profileName}` : `${LAYER_NUM[layer]} ${layer === "defaults" ? `defaults ${app.explain.defaults.set}` : layer}`;
    const railCls = `rail${index >= winIndex && winIndex >= 0 ? " hot" : ""}${index === LAYERS.length - 1 ? " last" : ""}`;
    let dot;
    let body;
    if (!canSet(layer, path)) {
      dot = "na";
      body = h("div", { class: "sbody" }, h("div", { class: "stitle dim", text: title }), h("div", { class: "ssub", text: `cannot set ${leaf}` }));
    } else if (isQueued) {
      const q = layer === "profile" ? profileEdit : edit;
      const has = row ? `file has ${fmt(row.value)} · ` : "";
      const higher = layer === "profile" ? [] : overridesOf(app.editIn, path);
      dot = "queued";
      body = h("div", { class: "scard queued" },
        h("div", { class: "scard-main" }, h("div", { class: "stitle b", text: `${title} · ${has}your edit ${q.remove ? "reset" : fmt(q.value)}` }),
          h("div", { class: "warn-text small", text: higher.length ? `queued · ▲ ${higher[0].who} overrides this value` : "queued · this layer would now win" })),
        h("span", { class: "sval", text: q.remove ? "·" : fmt(q.value) }));
    } else if (row && row.state === "win") {
      const sub = row.source.kind === "profile"
        ? `declared in ${row.source.declaredIn.path || sourceLabel(row.source.declaredIn)}`
        : row.source.kind === "defaults" ? "sets the base value" : file(row.source.kind).path;
      dot = "win";
      body = h("div", { class: "scard win" },
        h("div", { class: "scard-main" }, h("div", { class: "stitle b", text: `${title} · wins` }), h("div", { class: "ssub", text: sub }),
          stack.otherProfiles.length ? h("div", { class: "ssub", text: `overrides profile ${joinAnd(stack.otherProfiles)}` }) : null),
        h("span", { class: "sval", text: stack.noKey ? "all" : fmt(row.value) }));
    } else if (row) {
      const by = LAYERS.slice(index + 1).filter((other) => stack.rows[other]).map((other) => other);
      dot = "over";
      body = h("div", { class: "sbody" },
        h("div", { class: "srow" }, h("div", { class: "stitle", text: title }), h("span", { class: "sval struck", text: fmt(row.value) })),
        h("div", { class: "ssub", text: `overridden by ${joinAnd(by)}` }));
    } else {
      dot = "unset";
      const lower = LAYERS.slice(0, index).reverse().find((other) => stack.rows[other]);
      const sub = index < winIndex && lower ? `not set · ${fmt(stack.rows[lower].value)} passes through` : `does not set ${leaf}`;
      body = h("div", { class: "sbody" },
        h("div", { class: "srow" }, h("div", { class: "stitle dim", text: title }), h("span", { class: "sval faint", text: "·" })),
        h("div", { class: "ssub", text: sub }));
    }
    return h("div", { class: "sitem" }, h("div", { class: railCls }, h("span", { class: `sdot ${dot}` })), body);
  });
  return h("section", { class: "insp-stack" },
    h("div", { class: "meta-caps", text: "SOURCE STACK · TOP TO BOTTOM" }),
    h("div", { class: "stack" }, items),
    h("div", { class: "seff" }, h("span", { class: "accent", text: "=" }), ` effective ${stack.noKey ? "every driver" : fmt(stack.value)}`));
}

function pathOptions(path, stack) {
  const name = selectedProfileName();
  const profilePath = ["profiles", name, ...path];
  if (path[0] === "workflow") return [profilePath];
  if (path[0] === "roles" || path[0] === "limits" || path[0] === "models") {
    return stack.winner === "profile" ? [profilePath, path] : [path, profilePath];
  }
  return [path];
}

function valueKind(path) {
  const vocab = app.state.vocab;
  const last = path.at(-1);
  const rel = path[0] === "profiles" && path.length > 2 ? path.slice(2) : path;
  if (rel[0] === "limits") return { type: "number", range: vocab.limitRanges[last] };
  if (rel[0] === "workflow") {
    const rule = (vocab.workflow[rel[1]] || {})[rel[2]];
    if (rule && rule.values) return { type: "enum", values: rule.values };
    if (rule && rule.items) return { type: "items", items: rule.items };
    if (rule) return { type: "number", range: [rule.minimum, rule.maximum], auto: rule.auto };
  }
  if (rel[0] === "roles" && rel[2] === "chain") return { type: "chain" };
  if (rel[0] === "roles" && ["access", "result", "t3Role", "interactionMode", "runtimeMode"].includes(last)) return { type: "enum", values: vocab[last] };
  if (["fast", "crossFamily", "plan"].includes(last)) return { type: "bool" };
  if (path[0] === "profile") return { type: "enum", values: app.state.profiles };
  if (last === "extends") return { type: "enum", values: app.state.profiles.filter((item) => item !== path[1]) };
  if (path[0] === "harnesses") return { type: "list" };
  if (last === "description" || last === "model") return { type: "text" };
  return { type: "json" };
}

function parseValue(kind, raw) {
  if (kind.type === "number") {
    if (kind.auto && raw.trim() === "auto") return { value: "auto" };
    if (!/^-?\d+$/.test(raw.trim())) return { error: "enter an integer" };
    const number = Number(raw);
    const [min, max] = kind.range;
    if (number < min || number > max) return { value: number, error: `must be an integer from ${min} to ${max}` };
    return { value: number };
  }
  if (kind.type === "bool") return { value: raw === "true" };
  if (kind.type === "list") return { value: raw.split(/[\s,]+/).filter(Boolean) };
  if (kind.type === "json") {
    try {
      return { value: JSON.parse(raw) };
    } catch {
      return { error: "enter a JSON value" };
    }
  }
  return { value: raw };
}

function rawOf(kind, value) {
  if (value === undefined) return "";
  if (kind.type === "list") return Array.isArray(value) ? value.join(", ") : "";
  if (kind.type === "json") return JSON.stringify(value);
  if (kind.type === "items") return value;
  return String(value);
}

function overrideClause(kind, path, current) {
  const over = overridesOf(kind, path);
  if (over.length === 0) return "";
  const other = kind === "user" ? "project" : "user";
  return ` What runs stays ${fmt(current)}, because ${over[0].who === "project" ? "the project file" : over[0].who} sets it. To change what runs, pick the profile path or switch Edit in to ${other}.`;
}

function resetSentence(kind, path, stack) {
  if (!fileSets(kind, path)) return `Reset to inherited is off: the ${kind} file does not set this key.`;
  const own = stack.rows[kind];
  if (path[0] !== "profiles" && own && own.state === "win") {
    const next = LAYERS.slice(0, LAYERS.indexOf(kind)).reverse().find((layer) => stack.rows[layer]);
    if (next) return `Removes ${dotted(path)} from the ${kind} file. The value becomes ${fmt(stack.rows[next].value)} from ${sourceLabel(stack.rows[next].source)}.`;
    return `Removes ${dotted(path)} from the ${kind} file.`;
  }
  return `Removes ${dotted(path)} from the ${kind} file. What runs stays ${stack.noKey ? "every driver" : fmt(stack.value)} from ${sourceLabel(stack.source)}.`;
}

function editPanel(path, stack) {
  const kind = app.editIn;
  const options = pathOptions(path, stack);
  const key = dotted(path);
  const profileName = selectedProfileName();
  const id = `${kind}|${profileName}|${key}`;
  let draft = app.drafts.insp;
  if (!draft || draft.id !== id) {
    if (draft) keepDraft("insp", draft.id);
    draft = takeDraft("insp", id);
  }
  const start = (target) => fresh({ id, key, file: kind, profile: profileName, target }, (d) => { d.raw = null; });
  if (!draft || (draft.target !== null && !options.some((option) => pk(option) === draft.target))) {
    draft = takeDraft("insp", `${id}#${pk(options[0])}`) || (app.drafts.insp = start(null));
  }
  const chosen = Math.max(0, options.findIndex((option) => pk(option) === draft.target));
  const target = options[chosen];
  draft.target = pk(target);
  const valueType = valueKind(target);
  const edit = queued(kind, target);
  const current = edit && !edit.remove ? edit.value : stack.value;
  if (draft.raw === null) {
    if (valueType.type === "items") draft.raw = clone(current) || [];
    else draft.raw = target[0] === "defaults" && edit && edit.remove ? "latest" : rawOf(valueType, current);
  }
  const seen = file(kind).hash;
  const disabled = !canEdit();

  const radios = options.map((option, index) => {
    const on = index === chosen;
    const over = overridesOf(kind, option);
    const wins = over.length === 0;
    const note = wins ? (on ? "wins" : "would win") : "";
    const label = option === path && options.length > 1 ? `${dotted(option)} (root)` : dotted(option);
    return h("div", {
      class: `popt${on ? " on" : ""}`, role: "radio", "aria-checked": on ? "true" : "false", tabindex: on ? "0" : "-1",
      "data-fk": `popt:${index}`, "data-fid": `popt:${pk(option)}`, "aria-disabled": disabled ? "true" : undefined,
      onclick: () => {
        if (disabled || pk(option) === draft.target) return;
        keepDraft("insp", `${id}#${draft.target}`);
        if (!takeDraft("insp", `${id}#${pk(option)}`)) app.drafts.insp = start(pk(option));
        render();
      },
    }, h("span", { class: "pradio", "aria-hidden": "true" }), h("span", { class: "ppath", text: label }),
    h("span", { class: "pnote", text: note }),
    over.map((item) => h("div", { class: "pwarn", text: `▲ ${item.who} overrides this value${item.who === "project" && option[0] !== "profiles" ? ` · it sets ${fmt(item.value)}` : ""}` })));
  });
  const group = h("div", { class: "pchoice", role: "radiogroup", "aria-label": "Path in this file" }, radios);
  group.addEventListener("keydown", (event) => radioKeys(event, radios));

  const queueBtn = h("button", { type: "button", class: "btn primary", "data-fk": "insp-queue", disabled });
  const errLine = h("span", { class: "err small" });
  const explainLine = h("p", { class: "prose" });
  const parsed = () => {
    if (valueType.type === "items") return { value: draft.raw };
    if (valueType.type === "enum" && target[0] === "defaults" && draft.raw === "latest") return { remove: true };
    return parseValue(valueType, draft.raw);
  };
  const refresh = () => {
    const result = parsed();
    const isQueued = edit && same(edit.remove ? { remove: true } : { value: edit.value }, result.remove ? { remove: true } : { value: result.value });
    queueBtn.textContent = isQueued ? "Queued ✓" : "Queue edit";
    queueBtn.disabled = disabled || stale(draft) || Boolean(result.error && result.value === undefined) || isQueued;
    errLine.textContent = result.error || "";
    const shown = result.remove ? "latest (no key)" : fmt(result.value);
    explainLine.textContent = `Writes ${dotted(target)} = ${shown} to ${file(kind).path}.${overrideClause(kind, target, stack.value)}`;
  };
  app.live.push(refresh);
  queueBtn.addEventListener("click", () => {
    if (app.drafts.insp !== draft || draft.target !== pk(target) || stale(draft)) return;
    const result = parsed();
    if (result.value === undefined && !result.remove) return;
    if (enqueue(kind, target, result.remove ? { remove: true } : { value: result.value }, draft.hash)) fresh(draft);
    render();
  });

  let control;
  const onRaw = (raw) => { touch(draft); draft.raw = raw; runLive(); };
  const pick = (value) => { if (value !== draft.raw) { touch(draft); draft.raw = value; render(); } };
  if (valueType.type === "chain") {
    control = h("a", { class: "link", href: `#/role/${encodeURIComponent(path[1])}`, text: "Edit the chain in the role editor ›" });
  } else if (valueType.type === "number") {
    const input = h("input", { type: "text", inputmode: "numeric", class: "num", "aria-label": `Value of ${dotted(target)}`, value: draft.raw, disabled, "data-fk": "insp-value" });
    input.addEventListener("input", () => onRaw(input.value));
    control = [input, h("span", { class: "meta muted", text: `${valueType.range[0]}–${valueType.range[1]}${valueType.auto ? " or auto" : ""} · integer` })];
  } else if (valueType.type === "bool") {
    control = seg(["true", "false"], draft.raw, pick, { label: dotted(target), disabled, fk: "insp-bool" });
  } else if (valueType.type === "enum" && valueType.values.length <= 3) {
    control = seg(valueType.values, draft.raw, pick, { label: dotted(target), disabled, fk: "insp-enum" });
  } else if (valueType.type === "enum") {
    control = select(valueType.values, draft.raw, pick, { label: dotted(target), disabled, fk: "insp-select" });
  } else if (valueType.type === "items") {
    control = h("div", { class: "checks" }, valueType.items.map((item) => h("label", { class: "check" },
      checkbox(draft.raw.includes(item), { disabled, "data-fk": `insp-item:${item}` }, (checked) => {
        touch(draft);
        draft.raw = checked ? [...draft.raw, item] : draft.raw.filter((other) => other !== item);
        render();
      }), item)));
  } else {
    const input = h("input", { type: "text", class: `text${valueType.type === "text" ? " sans" : ""}`, "aria-label": `Value of ${dotted(target)}`, value: draft.raw, disabled, "data-fk": "insp-value" });
    input.addEventListener("input", () => onRaw(input.value));
    control = input;
  }

  const resetOn = fileSets(kind, target) && !disabled;
  const resetQueued = edit && edit.remove;
  return h("section", { class: "insp-edit" },
    h("div", { class: "meta-caps" }, "EDIT IN ", h("span", { class: "lc", text: kind }), " · PATH IN THIS FILE"),
    !usable(kind) ? h("p", { class: "warn-text", text: `Edit in ${kind} is off: ${absent(kind) ? "the file does not exist" : "the file does not parse"}.` }) : null,
    group,
    staleNotice("insp"),
    valueType.type === "chain" ? control : h("div", { class: "vrow" }, control, h("span", { class: "spacer" }), edit ? null : queueBtn),
    errLine,
    valueType.type === "chain" ? null : explainLine,
    edit ? h("div", { class: "btnrow" }, queueBtn, h("button", {
      type: "button", class: "btn", text: "Undo", "data-fk": "insp-undo", disabled: app.stopped || writeLocked(kind),
      onclick: () => {
        unqueue(kind, target);
        fresh(draft);
        render();
      },
    })) : null,
    h("div", { class: "reset" },
      h("button", {
        type: "button", class: "link plain", disabled: !resetOn || resetQueued, "data-fk": "insp-reset",
        text: resetQueued ? "Reset queued ✓" : "Reset to inherited",
        onclick: () => {
          enqueue(kind, target, { remove: true }, seen);
          render();
        },
      }),
      h("p", { class: "prose muted", text: resetSentence(kind, target, stack) })));
}

// ----- s3 role editor -----

function sidebarList(title, items, more) {
  return h("div", { class: "side-list" }, h("div", { class: "meta-caps side-title", text: title }), items, more);
}

function roleScreen() {
  const names = roleNames();
  const name = app.route.name === "+new" ? null : app.route.name;
  const showAll = app.drafts.allRoles;
  const limit = 8;
  const visible = showAll ? names : names.slice(0, limit).concat(name && names.indexOf(name) >= limit ? [name] : []);
  const items = visible.map((role) => {
    const letters = LAYERS.filter((layer) => (app.explain.effective.length ? app.explain.effective : app.explain.root)
      .some((entry) => entry.path[0] === "roles" && entry.path[1] === role && (stackOf(entry.path).rows[layer]))).map((layer) => LETTER[layer]);
    return h("a", { class: `side-row${role === name ? " sel" : ""}`, href: `#/role/${encodeURIComponent(role)}`, "data-fk": `side:${role}` },
      h("span", { text: role }), h("span", { class: "side-meta", text: letters.join(" ") }));
  });
  const more = names.length > visible.length
    ? h("button", { type: "button", class: "link side-more", text: `… ${names.length - visible.length} more`, onclick: () => { app.drafts.allRoles = true; render(); } })
    : null;
  return h("section", { class: "screen-split" },
    h("aside", { class: "sidebar", "data-scroll": "side" }, sidebarList("ROLES", items, more), newRoleForm()),
    h("div", { class: "pane", "data-scroll": "pane" }, blockedCard(), name && names.includes(name) ? roleEditor(name)
      : h("p", { class: "insp-empty", text: name ? `No role ${name}. Pick a role or add one.` : "Pick a role, or add one with the form." })));
}

function newRoleForm() {
  const vocab = app.state.vocab;
  const draft = app.drafts.newRole
    || (app.drafts.newRole = fresh({}, (d) => Object.assign(d, { name: "", description: "", access: "read-only", rung: "", error: "" })));
  const disabled = !canEdit();
  const errorEl = h("p", { class: "err small", text: draft.error });
  const field = (label, key, placeholder, sans) => {
    const input = h("input", { type: "text", class: `text${sans ? " sans" : ""}`, value: draft[key], placeholder, disabled, "data-fk": `nr:${key}`, "aria-label": label });
    input.addEventListener("input", () => { touch(draft); draft[key] = input.value; });
    return h("label", { class: "ffield" }, h("span", { class: "flabel", text: label }), input);
  };
  const pickAccess = (value) => { if (value !== draft.access) { touch(draft); draft.access = value; render(); } };
  return h("div", { class: "newform" },
    h("div", { class: "newtitle" }, "+ NEW ROLE · in ", h("span", { class: "lc", text: app.editIn })),
    field("name", "name", "security"),
    field("description", "description", "What the role does", true),
    h("div", { class: "ffield" }, h("span", { class: "flabel", text: "access" }),
      seg(["read-only", "edit"], draft.access, pickAccess, { label: "access", disabled, fk: "nr:access", small: true })),
    field("first rung", "rung", "provider · model · effort"),
    errorEl,
    staleNotice("newRole"),
    h("div", { class: "btnrow" },
      h("button", {
        type: "button", class: "btn primary", text: "Queue", disabled: disabled || stale(draft), "data-fk": "nr:queue",
        onclick: () => {
          if (stale(draft)) return;
          const parts = draft.rung.split(/[·\s]+/).filter(Boolean);
          const names = roleNames();
          if (!new RegExp(vocab.roleNamePattern).test(draft.name)) draft.error = `name must match ${vocab.roleNamePattern}`;
          else if (names.includes(draft.name)) draft.error = `role ${draft.name} exists`;
          else if (!draft.description.trim()) draft.error = "description is required";
          else if (parts.length < 2) draft.error = "first rung needs a provider and a model";
          else if (parts[2] && !vocab.effort.includes(parts[2])) draft.error = `effort must be one of ${vocab.effort.join(", ")}`;
          else {
            const rung = { provider: parts[0], model: parts[1] };
            if (parts[2]) rung.effort = parts[2];
            if (!enqueue(app.editIn, ["roles", draft.name], { value: { description: draft.description.trim(), access: draft.access, chain: [rung] } }, draft.hash)) {
              render();
              return;
            }
            app.drafts.newRole = null;
            render();
            return;
          }
          render();
        },
      }),
      h("button", { type: "button", class: "btn", text: "Cancel", "data-fk": "nr:cancel", onclick: () => { app.drafts.newRole = null; render(); } })));
}

// The role editor keeps one draft for each path in the file: a dirty draft of the path that the user leaves stays under
// "<id>#<base>".
function startRole(id, name, kind, profileName, base) {
  return fresh({ id, name, file: kind, profile: profileName, base }, (d) => Object.assign(d, { fields: {}, chain: null, rows: {} }));
}

function roleEditor(name) {
  const vocab = app.state.vocab;
  const kind = app.editIn;
  const profileName = selectedProfileName();
  const id = `${kind}|${profileName}|${name}`;
  let draft = app.drafts.role;
  if (!draft || draft.id !== id) {
    if (draft) keepDraft("role", draft.id);
    draft = takeDraft("role", id) || takeDraft("role", `${id}#root`) || (app.drafts.role = startRole(id, name, kind, profileName, "root"));
  }
  const baseNow = () => (draft.base === "root" ? ["roles", name] : ["profiles", profileName, "roles", name]);
  const base = baseNow();
  const disabled = !canEdit();
  const current = (field) => {
    if (Object.hasOwn(draft.fields, field)) return draft.fields[field];
    const edit = queued(kind, [...baseNow(), field]);
    if (edit && !edit.remove) return edit.value;
    return stackOf(["roles", name, field]).value;
  };
  const baseline = (field) => {
    const edit = queued(kind, [...baseNow(), field]);
    return edit && !edit.remove ? edit.value : stackOf(["roles", name, field]).value;
  };
  const setField = (field, value, rerender = true) => {
    if (same(value, current(field))) return;
    touch(draft);
    draft.fields[field] = value;
    if (rerender) render();
    else runLive();
  };
  const sources = [];
  for (const field of vocab.roleKeys) {
    const stack = stackOf(["roles", name, field]);
    if (stack.source) {
      const label = sourceLabel(stack.source);
      if (!sources.includes(label)) sources.push(label);
    }
  }
  const roleStack = stackOf(["roles", name, "access"]);
  const fieldRow = (label, fields, control) => {
    const field = fields[0];
    const stack = stackOf(["roles", name, field]);
    const edit = queued(kind, [...baseNow(), field]);
    const over = edit ? overridesOf(kind, [...base, field]) : [];
    const errors = blockedFor([...base, field]);
    return h("div", { class: `frow${over.length ? " warnrow" : ""}${errors.length ? " errrow" : ""}` },
      h("span", { class: "flab", text: label }),
      h("div", { class: "fctl" }, control,
        over.length ? h("span", { class: "warn-text small", text: `queued for ${dotted([...base, field])} · ▲ ${over[0].who} overrides this value` }) : null,
        errors.length ? h("span", { class: "err small", text: errors[0].message }) : null),
      h("span", { class: `fsrc${stack.winner === "profile" ? " accent" : ""}` },
        h("span", { class: "letter", text: stack.winner ? LETTER[stack.winner] : "·" }), ` ${stack.source ? sourceLabel(stack.source) : "not set"}`));
  };
  const desc = h("input", { type: "text", class: "text sans full", value: current("description") || "", disabled, "data-fk": "role:description", "aria-label": "description", maxlength: String(vocab.descriptionMax) });
  desc.addEventListener("input", () => setField("description", desc.value, false));
  const boolBox = (field) => {
    const value = current(field) === true;
    return h("label", { class: "check" }, checkbox(value, { disabled, "data-fk": `role:${field}` }, (checked) => setField(field, checked)), String(value));
  };
  const chainNow = () => draft.chain || clone(current("chain")) || [];
  const chainOut = () => resolveOptions(chainNow(), draft.rows);
  const queueBtn = h("button", { type: "button", class: "btn primary", "data-fk": "role:queue" });
  const chainEdited = () => draft.chain && !same(chainOut(), baseline("chain"));
  const editedFields = () => Object.keys(draft.fields).filter((field) => !same(draft.fields[field], baseline(field)));
  const pendingCount = () => editedFields().length + (chainEdited() ? 1 : 0);
  const seen = file(kind).hash;
  const refresh = () => {
    const count = pendingCount();
    queueBtn.textContent = count ? `Queue ${plural(count, "edit")}` : "Queue edits";
    queueBtn.disabled = disabled || stale(draft) || count === 0 || chainNow().length === 0 || !chainOut() || optionFormHasText(draft.rows);
  };
  app.live.push(refresh);
  queueBtn.addEventListener("click", () => {
    if (app.drafts.role !== draft || !canEdit() || stale(draft) || pendingCount() === 0 || chainNow().length === 0 || optionFormHasText(draft.rows)) return;
    const chain = chainOut();
    if (!chain || !draftFits(kind, draft.hash)) {
      render();
      return;
    }
    const target = baseNow();
    for (const field of editedFields()) enqueue(kind, [...target, field], { value: draft.fields[field] }, draft.hash);
    if (chainEdited()) enqueue(kind, [...target, "chain"], { value: chain }, draft.hash);
    app.drafts.role = null;
    render();
  });
  const rootPath = ["roles", name];
  const profilePath = ["profiles", profileName, "roles", name];
  return h("div", { class: "editor" },
    h("header", { class: "ed-head" },
      h("div", { class: "ed-title" }, h("h2", { class: "h2", text: dotted(rootPath) }), strip(roleStack), h("span", { class: "ed-src", text: sources.join(" + ") })),
      h("div", { class: "ed-sub" }, h("span", { class: "muted" }, "edit in ", app.editIn, " · path in this file"),
        seg([{ value: "root", label: dotted(rootPath) }, { value: "profile", label: dotted(profilePath) }], draft.base,
          (value) => {
            if (value === draft.base) return;
            keepDraft("role", `${id}#${draft.base}`);
            if (!takeDraft("role", `${id}#${value}`)) app.drafts.role = startRole(id, name, kind, profileName, value);
            render();
          }, { label: "Path in this file", disabled, fk: "role:base", small: true }))),
    staleNotice("role"),
    h("div", { class: "fields" },
      fieldRow("description", ["description"], desc),
      fieldRow("access", ["access"], seg(vocab.access.slice().reverse(), current("access"), (value) => setField("access", value), { label: "access", disabled, fk: "role:access", small: true })),
      fieldRow("result · t3Role", ["result", "t3Role"], h("div", { class: "pair" },
        select(vocab.result, current("result"), (value) => setField("result", value), { label: "result", disabled, fk: "role:result" }),
        select(vocab.t3Role, current("t3Role"), (value) => setField("t3Role", value), { label: "t3Role", disabled, fk: "role:t3Role" }))),
      fieldRow("interactionMode", ["interactionMode"], seg(vocab.interactionMode, current("interactionMode"), (value) => setField("interactionMode", value), { label: "interactionMode", disabled, fk: "role:im", small: true })),
      fieldRow("runtimeMode", ["runtimeMode"], select(vocab.runtimeMode, current("runtimeMode"), (value) => setField("runtimeMode", value), { label: "runtimeMode", disabled, fk: "role:rm" })),
      fieldRow("crossFamily", ["crossFamily"], boolBox("crossFamily")),
      fieldRow("fast", ["fast"], boolBox("fast"))),
    chainEditor(chainNow, (chain, typing) => { touch(draft); draft.chain = chain; if (typing) runLive(); else render(); }, disabled, blockedFor([...base, "chain"]), draft.rows,
      () => { touch(draft); draft.chain = chainNow(); }),
    h("footer", { class: "ed-foot" },
      draft.base === "root" ? h("button", {
        type: "button", class: "btn danger", text: "Remove role", disabled, "data-fk": "role:remove",
        onclick: () => { if (enqueue(kind, rootPath, { value: null }, seen)) app.drafts.role = null; render(); },
      }) : null,
      draft.base === "root" ? h("span", { class: "muted small", text: `writes ${dotted(rootPath)}: null` }) : null,
      h("span", { class: "spacer" }),
      h("button", {
        type: "button", class: "btn", text: "Reset to inherited", disabled: disabled || !fileSets(kind, base), "data-fk": "role:reset",
        title: fileSets(kind, base) ? `removes ${dotted(base)} from the ${kind} file` : `the ${kind} file does not set ${dotted(base)}`,
        onclick: () => { if (enqueue(kind, baseNow(), { remove: true }, seen)) app.drafts.role = null; render(); },
      }),
      queueBtn));
}

// The option lines of one rung with their typed keys. A typed key stays in store.raw until the chain takes it: an
// empty key removes its option, and a key that repeats another key of the rung, or that a plain object cannot hold
// as its own key, has a problem and stops the queue.
function optionLines(options, store) {
  const entries = Object.entries(options || {});
  const ids = rowIds(store, entries.length);
  const raw = store.raw || new Map();
  const lines = entries.map(([key, value], at) => {
    const typed = raw.has(`${ids[at]}:key`);
    return { id: ids[at], key: typed ? raw.get(`${ids[at]}:key`).trim() : key, value, typed, problem: null };
  });
  for (const line of lines) line.problem = optionKeyProblem(line.key, lines.filter((other) => other !== line).map((other) => other.key));
  return lines;
}

// A new-option form with text holds an option that the chain does not have yet, so Queue waits until the user adds
// it with Enter or clears the form.
function optionFormHasText(store) {
  return [...(store.opts || new Map()).values()].some((opts) => opts.adding && (opts.adding.key !== "" || opts.adding.value !== ""));
}

function optionKeyProblem(key, others) {
  if (key === "__proto__") return "this key is not allowed";
  if (key !== "" && others.includes(key)) return "another option of this rung has this key";
  return null;
}

// The chain with every typed option key in it, or null when a typed key has a problem. A Queue sends this chain, so
// that it sends what the editor shows.
function resolveOptions(chain, store) {
  const ids = rowIds(store, chain.length);
  let blocked = false;
  const next = chain.map((rung, at) => {
    const opts = store.opts && store.opts.get(ids[at]);
    if (!opts || !rung.options) return rung;
    const lines = optionLines(rung.options, opts);
    if (!lines.some((line) => line.typed)) return rung;
    if (lines.some((line) => line.problem)) blocked = true;
    const options = {};
    for (const line of lines) if (line.key !== "") options[line.key] = line.value;
    const out = { ...rung, options };
    if (Object.keys(options).length === 0) delete out.options;
    return out;
  });
  return blocked ? null : next;
}

// One line per option. A value keeps its type: a string stays a string, also "true", and a boolean stays a boolean.
// Each action reads the options through getOptions and finds its line by row id, because a click can run before the
// render of an earlier change that removed or reordered a line. store belongs to one rung id, so the new-option form
// stays with its rung when the rung moves and goes away when the rung is removed.
function optionsEditor(getOptions, index, disabled, onChange, store, rungId, onInput) {
  const entries = Object.entries(getOptions() || {});
  const label = `rung ${index + 1}`;
  const fk = `rung:${index}:opt`;
  const fid = `rung#${rungId}:opt`;
  const now = () => Object.entries(getOptions() || {});
  const ids = () => rowIds(store, now().length);
  const commit = (next, nextIds, typing) => {
    const out = {};
    const idOf = new Map();
    next.forEach(([key, value], at) => {
      if (key === "" || Object.hasOwn(out, key)) return;
      out[key] = value;
      idOf.set(key, nextIds[at]);
    });
    store.ids = Object.keys(out).map((key) => idOf.get(key));
    onChange(Object.keys(out).length ? out : undefined, typing);
  };
  const replace = (id, change, typing) => {
    const current = now();
    const rowIdsNow = ids();
    const at = rowIdsNow.indexOf(id);
    if (at === -1) return;
    commit(current.map((entry, other) => (other === at ? change(entry) : entry)), rowIdsNow, typing);
  };
  // The typed text of a line stays by its row id until change, so that a render or a move of the rung keeps it. A
  // key with a problem stays typed also after change.
  store.raw ||= new Map();
  const typed = (input, name, apply) => {
    input.addEventListener("input", () => {
      store.raw.set(name, input.value);
      if (apply(input.value, true)) return;
      onInput();
      runLive();
    });
    input.addEventListener("change", () => {
      store.raw.delete(name);
      if (apply(input.value, false)) return;
      store.raw.set(name, input.value);
      onInput();
      render();
    });
  };
  const problemOf = (id, key) => optionKeyProblem(key, optionLines(getOptions(), store).filter((line) => line.id !== id).map((line) => line.key));
  const remove = (id) => {
    const current = now();
    const rowIdsNow = ids();
    const at = rowIdsNow.indexOf(id);
    if (at === -1) return;
    commit(current.filter((_, other) => other !== at), rowIdsNow.filter((_, other) => other !== at));
  };
  const types = [{ value: "text", label: "text" }, { value: "true", label: "true" }, { value: "false", label: "false" }];
  const renderIds = [...ids()];
  const lines = entries.map(([key, value], at) => {
    const id = renderIds[at];
    const shown = (name, text) => (store.raw.has(name) ? store.raw.get(name) : text);
    const keyInput = h("input", { type: "text", class: "cell-input okey", value: shown(`${id}:key`, key), disabled, "aria-label": `option key ${at + 1} of ${label}`, "data-fk": `${fk}:${at}:key`, "data-fid": `${fid}:${id}:key` });
    typed(keyInput, `${id}:key`, (raw, typing) => {
      const next = raw.trim();
      if ((typing && next === "") || problemOf(id, next) || now().some(([other], line) => other === next && ids()[line] !== id)) return false;
      replace(id, ([, old]) => [next, old], typing);
      return true;
    });
    const problem = h("span", { class: "err small", "data-fk": `${fk}:${at}:problem` });
    const showProblem = () => {
      const line = optionLines(getOptions(), store).find((item) => item.id === id);
      problem.textContent = line && line.problem ? line.problem : "";
    };
    showProblem();
    app.live.push(showProblem);
    const type = select(types, typeof value === "boolean" ? String(value) : "text", (picked) => {
      store.raw.delete(`${id}:value`);
      replace(id, ([name, old]) => [name, picked === "text" ? String(old) : picked === "true"]);
    },
    { label: `type of option ${key} of ${label}`, disabled, fk: `${fk}:${at}:type`, fid: `${fid}:${id}:type`, class: "cell-select" });
    let valueInput = null;
    if (typeof value === "string") {
      valueInput = h("input", { type: "text", class: "cell-input oval", value: shown(`${id}:value`, value), disabled, "aria-label": `value of option ${key} of ${label}`, "data-fk": `${fk}:${at}:value`, "data-fid": `${fid}:${id}:value` });
      typed(valueInput, `${id}:value`, (raw, typing) => {
        replace(id, ([name]) => [name, raw], typing);
        return true;
      });
    }
    return h("div", { class: "opt-line" }, keyInput, h("span", { class: "faint", text: "=" }), type, valueInput,
      h("button", { type: "button", class: "icon", text: "✕", disabled, "aria-label": `Remove option ${key} of ${label}`, "data-fk": `${fk}:${at}:rm`, "data-fid": `${fid}:${id}:rm`, onclick: () => remove(id) }),
      problem);
  });
  const pending = store.adding || null;
  let add;
  if (pending) {
    const keyInput = h("input", { type: "text", class: "cell-input okey", value: pending.key, placeholder: "key", disabled, "aria-label": `new option key of ${label}`, "data-fk": `${fk}:new:key`, "data-fid": `${fid}:new:key` });
    const valueInput = h("input", { type: "text", class: "cell-input oval", value: pending.value, placeholder: "value", disabled, "aria-label": `new option value of ${label}`, "data-fk": `${fk}:new:value`, "data-fid": `${fid}:new:value` });
    keyInput.addEventListener("input", () => { pending.key = keyInput.value; onInput(); runLive(); });
    valueInput.addEventListener("input", () => { pending.value = valueInput.value; onInput(); runLive(); });
    const hint = h("span", { class: "warn-text small", "data-fk": `${fk}:new:hint` });
    const showHint = () => { hint.textContent = pending.key !== "" || pending.value !== "" ? "Press Enter to add the option, or clear it." : ""; };
    showHint();
    app.live.push(showHint);
    const keys = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (store.adding === pending) store.adding = null;
        render();
      } else if (event.key === "Enter" && pending.key.trim() && store.adding === pending) {
        // The typed keys of the existing lines resolve with the insertion, so that it keeps every option on screen.
        const current = optionLines(getOptions(), store);
        const blocked = current.find((line) => line.problem);
        pending.problem = blocked ? blocked.problem : optionKeyProblem(pending.key.trim(), current.map((line) => line.key));
        if (pending.problem) {
          render();
          return;
        }
        store.adding = null;
        for (const line of current) store.raw.delete(`${line.id}:key`);
        commit([...current.map((line) => [line.key, line.value]), [pending.key.trim(), pending.value]], [...current.map((line) => line.id), newRowId()]);
      }
    };
    keyInput.addEventListener("keydown", keys);
    valueInput.addEventListener("keydown", keys);
    add = h("div", { class: "opt-line" }, keyInput, h("span", { class: "faint", text: "=" }), valueInput,
      h("span", { class: "muted small", text: "⏎" }),
      hint,
      pending.problem ? h("span", { class: "err small", "data-fk": `${fk}:new:problem`, text: pending.problem }) : null);
  } else {
    add = h("button", {
      type: "button", class: "link", text: "+ key=value", disabled, "data-fk": `${fk}:add`, "data-fid": `${fid}:add`,
      onclick: () => {
        store.adding = { key: "", value: "" };
        render();
        const input = document.querySelector(`[data-fid="${fid}:new:key"]`);
        if (input) input.focus();
      },
    });
  }
  return h("div", { class: "opts" }, lines, add);
}

// getChain returns the current draft chain. Each action reads it when it runs, not when the control was rendered,
// and finds its rung by row id, because render waits while a pointer is down, so a click can follow a change event
// that removed or moved a rung before the next render. store keeps the row ids; its owner resets it with the chain.
// onChange gets typing = true for a keystroke: the owner saves the chain and does not render, so that the field keeps
// its caret. store.raw keeps the typed text of each field by row id until change. onInput runs on typing that changes
// no value, as in a new-option form. The owner then keeps the chain on screen as its draft chain, so that the form
// keeps its rung when a new state changes the chain.
function chainEditor(getChain, onChange, disabled, errors, store, onInput) {
  const vocab = app.state.vocab;
  const chain = getChain();
  const ids = () => rowIds(store, getChain().length);
  const indexOf = (id) => ids().indexOf(id);
  store.opts ||= new Map();
  store.raw ||= new Map();
  const update = (id, patch, typing) => {
    const index = indexOf(id);
    const next = clone(getChain());
    if (index === -1 || !next[index]) return;
    next[index] = { ...next[index], ...(typeof patch === "function" ? patch(next[index]) : patch) };
    for (const [key, value] of Object.entries(next[index])) if (value === undefined || value === "") delete next[index][key];
    onChange(next, typing);
  };
  const reorder = (from, to) => {
    const next = clone(getChain());
    const nextIds = [...ids()];
    if (from === -1 || to < 0 || to >= next.length || from === to) return false;
    next.splice(to, 0, ...next.splice(from, 1));
    nextIds.splice(to, 0, ...nextIds.splice(from, 1));
    store.ids = nextIds;
    onChange(next);
    return true;
  };
  const move = (id, delta) => {
    const index = indexOf(id);
    const to = index + delta;
    if (index === -1 || !reorder(index, to)) return;
    requestAnimationFrame(() => {
      const target = document.querySelector(`[data-fid="rung#${id}:provider"]`);
      if (target) target.focus();
    });
  };
  const renderIds = [...ids()];
  const rows = chain.map((rung, index) => {
    const id = renderIds[index];
    const text = (key, value, label, width) => {
      const name = `${id}:${key}`;
      const input = h("input", { type: "text", class: `cell-input ${width}`, value: store.raw.has(name) ? store.raw.get(name) : value || "", disabled, "aria-label": `${label} of rung ${index + 1}`, "data-fk": `rung:${index}:${key}`, "data-fid": `rung#${id}:${key}` });
      input.addEventListener("input", () => {
        store.raw.set(name, input.value);
        update(id, { [key]: input.value.trim() || undefined }, true);
      });
      input.addEventListener("change", () => {
        store.raw.delete(name);
        update(id, { [key]: input.value.trim() || undefined });
      });
      return input;
    };
    if (!store.opts.has(id)) store.opts.set(id, {});
    const opts = optionsEditor(() => {
      const at = indexOf(id);
      return at === -1 ? undefined : (getChain()[at] || {}).options;
    }, index, disabled, (options, typing) => update(id, { options }, typing), store.opts.get(id), id, onInput);
    const fastText = rung.fast === undefined ? "—" : rung.fast ? "✓" : "✕";
    const row = h("div", { class: "crow", role: "row", draggable: disabled ? undefined : "true", "data-index": String(index) },
      h("span", { class: "c-num", role: "cell" }, h("span", { class: "handle", "aria-hidden": "true", text: "⋮⋮" }), ` ${index + 1}`),
      h("span", { class: "c-prov", role: "cell" }, text("provider", rung.provider, "provider", "w110")),
      h("span", { class: "c-drv", role: "cell" }, text("driver", rung.driver, "driver", "w110")),
      h("span", { class: "c-model", role: "cell" }, text("model", rung.model, "model", "w150")),
      h("span", { class: "c-eff", role: "cell" }, select(["", ...vocab.effort].map((item) => ({ value: item, label: item || "—" })), rung.effort || "",
        (value) => update(id, { effort: value || undefined }), { label: `effort of rung ${index + 1}`, disabled, fk: `rung:${index}:effort`, fid: `rung#${id}:effort`, class: "cell-select" })),
      h("span", { class: "c-fast", role: "cell" }, h("button", {
        type: "button", class: "tri", text: fastText, disabled, "data-fk": `rung:${index}:fast`, "data-fid": `rung#${id}:fast`,
        "aria-label": `fast of rung ${index + 1}: ${rung.fast === undefined ? "not set" : String(rung.fast)}`,
        onclick: () => update(id, (now) => ({ fast: now.fast === undefined ? true : now.fast ? false : undefined })),
      })),
      h("span", { class: "c-opts", role: "cell" }, opts),
      h("span", { class: "c-act", role: "cell" },
        h("button", { type: "button", class: "icon", text: "↑", "aria-label": `Move rung ${index + 1} up`, disabled: disabled || index === 0, "data-fk": `rung:${index}:up`, "data-fid": `rung#${id}:up`, onclick: () => move(id, -1) }),
        h("button", { type: "button", class: "icon", text: "↓", "aria-label": `Move rung ${index + 1} down`, disabled: disabled || index === chain.length - 1, "data-fk": `rung:${index}:down`, "data-fid": `rung#${id}:down`, onclick: () => move(id, 1) }),
        h("button", {
          type: "button", class: "icon", text: "✕", "aria-label": `Remove rung ${index + 1}`, disabled: disabled || chain.length <= vocab.chainMin, "data-fk": `rung:${index}:rm`, "data-fid": `rung#${id}:rm`,
          onclick: () => {
            const current = getChain();
            const at = indexOf(id);
            if (at === -1 || current.length <= vocab.chainMin) return;
            store.ids = ids().filter((_, other) => other !== at);
            store.opts.delete(id);
            onChange(current.filter((_, other) => other !== at));
          },
        })));
    row.addEventListener("keydown", (event) => {
      if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        move(id, event.key === "ArrowUp" ? -1 : 1);
      }
    });
    row.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", String(id)));
    row.addEventListener("dragover", (event) => event.preventDefault());
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      const from = indexOf(Number(event.dataTransfer.getData("text/plain")));
      reorder(from, indexOf(id));
    });
    return row;
  });
  return h("section", { class: "chain" },
    h("div", { class: "chain-head" }, h("span", { class: "b", text: "chain" }),
      h("span", { class: "muted", text: `replaces the inherited chain as a whole · ${vocab.chainMin}–${vocab.chainMax} rungs` })),
    errors.length ? h("p", { class: "err small", text: errors.map((issue) => `${issue.path}: ${issue.message}`).join(" · ") }) : null,
    h("div", { class: `ctable${errors.length ? " error" : ""}`, role: "table", "aria-label": "chain" },
      h("div", { class: "crow chead", role: "row" }, ["#", "provider", "driver", "model", "effort", "fast", "options", ""].map((label, index) =>
        h("span", { class: ["c-num", "c-prov", "c-drv", "c-model", "c-eff", "c-fast", "c-opts", "c-act"][index], role: "columnheader", text: label }))),
      rows.length ? rows : h("p", { class: "chain-empty muted", text: `No rungs. Add ${vocab.chainMin} to ${vocab.chainMax}.` })),
    h("button", {
      type: "button", class: "link", text: "+ rung", disabled: disabled || chain.length >= vocab.chainMax, "data-fk": "rung:add",
      onclick: () => {
        const current = getChain();
        if (current.length >= vocab.chainMax) return;
        store.ids = [...ids(), newRowId()];
        onChange([...current, { provider: "", model: "" }]);
      },
    }));
}

// ----- s4 profile editor -----

function profileScreen() {
  const presets = app.state.vocab.presetProfiles;
  const name = app.route.name === "+new" ? null : app.route.name;
  const items = app.state.profiles.map((profile) => {
    const entry = app.explain.root.find((item) => item.path[0] === "profiles" && item.path[1] === profile && item.source.kind !== "defaults")
      || app.explain.root.find((item) => item.path[0] === "profiles" && item.path[1] === profile);
    const origin = entry ? LETTER[entry.source.kind] : "D";
    const tag = profile === app.profile ? "selected" : presets.includes(profile) ? "preset" : "";
    return h("a", { class: `side-row${profile === name ? " sel" : ""}`, href: `#/profile/${encodeURIComponent(profile)}`, "data-fk": `side:${profile}` },
      h("span", { text: profile }), h("span", { class: `side-meta${profile === app.profile ? " accent" : ""}`, text: [origin, tag].filter(Boolean).join(" · ") }));
  });
  return h("section", { class: "screen-split" },
    h("aside", { class: "sidebar", "data-scroll": "side" }, sidebarList("PROFILES", items, null), newProfileForm()),
    h("div", { class: "pane", "data-scroll": "pane" }, blockedCard(), name && app.state.profiles.includes(name) ? profileEditor(name)
      : h("p", { class: "insp-empty", text: name ? `No profile ${name}. Pick a profile or add one.` : "Pick a profile, or add one with the form." })));
}

function newProfileForm() {
  const draft = app.drafts.newProfile
    || (app.drafts.newProfile = fresh({}, (d) => Object.assign(d, { name: "", description: "", extends: "normal", error: "" })));
  const disabled = !canEdit();
  const field = (label, key, placeholder) => {
    const input = h("input", { type: "text", class: `text${key === "description" ? " sans" : ""}`, value: draft[key], placeholder, disabled, "data-fk": `np:${key}`, "aria-label": label });
    input.addEventListener("input", () => { touch(draft); draft[key] = input.value; });
    return h("label", { class: "ffield" }, h("span", { class: "flabel", text: label }), input);
  };
  return h("div", { class: "newform" },
    h("div", { class: "newtitle" }, "+ NEW PROFILE · in ", h("span", { class: "lc", text: app.editIn })),
    field("name", "name", "demo-day"),
    field("description (required)", "description", "What the profile is for"),
    h("div", { class: "ffield" }, h("span", { class: "flabel", text: "extends" }),
      select(app.state.profiles, draft.extends, (value) => { touch(draft); draft.extends = value; }, { label: "extends", disabled, fk: "np:extends", wide: true })),
    h("p", { class: "err small", text: draft.error }),
    staleNotice("newProfile"),
    h("div", { class: "btnrow" },
      h("button", {
        type: "button", class: "btn primary", text: "Queue", disabled: disabled || stale(draft), "data-fk": "np:queue",
        onclick: () => {
          if (stale(draft)) return;
          if (!/^[a-z][a-z0-9-]{0,31}$/.test(draft.name)) draft.error = "name must be lower case letters, digits, and dashes";
          else if (app.state.profiles.includes(draft.name)) draft.error = `profile ${draft.name} exists`;
          else if (!draft.description.trim()) draft.error = "description is required";
          else {
            if (!enqueue(app.editIn, ["profiles", draft.name], { value: { description: draft.description.trim(), extends: draft.extends } }, draft.hash)) {
              render();
              return;
            }
            app.drafts.newProfile = null;
            render();
            return;
          }
          render();
        },
      }),
      h("button", { type: "button", class: "btn", text: "Cancel", "data-fk": "np:cancel", onclick: () => { app.drafts.newProfile = null; render(); } })));
}

function ancestorsOf(name) {
  const chain = [];
  const seen = new Set([name]);
  let current = rootValue(["profiles", name, "extends"]);
  while (typeof current === "string" && !seen.has(current) && chain.length < app.state.vocab.profileChainMax) {
    chain.unshift(current);
    seen.add(current);
    current = rootValue(["profiles", current, "extends"]);
  }
  if (name !== "normal" && chain[0] !== "normal" && app.state.profiles.includes("normal")) chain.unshift("normal");
  return chain;
}

function profileEditor(name) {
  const vocab = app.state.vocab;
  const kind = app.editIn;
  const presets = vocab.presetProfiles;
  const disabled = !canEdit();
  const id = `${kind}|${name}`;
  let draft = app.drafts.profile;
  if (!draft || draft.id !== id) {
    if (draft) for (const slot of ["profile", "chainPanel", "pAdd"]) keepDraft(slot, draft.id);
    draft = takeDraft("profile", id) || (app.drafts.profile = fresh({ id, name, file: kind, extraRows: [] }, (d) => { d.fields = {}; }));
    takeDraft("chainPanel", id);
    takeDraft("pAdd", id);
  }
  const panel = app.drafts.chainPanel;
  const seen = file(kind).hash;
  const own = ["profiles", name];
  const ownValue = (rel) => {
    const edit = queued(kind, [...own, ...rel]);
    if (edit) return edit.remove ? undefined : edit.value;
    return rootValue([...own, ...rel]);
  };
  const ancestors = ancestorsOf(name);
  const declared = app.explain.root.find((entry) => entry.path[0] === "profiles" && entry.path[1] === name && entry.source.kind !== "defaults")
    || app.explain.root.find((entry) => entry.path[0] === "profiles" && entry.path[1] === name);
  const effective = name === app.explain.profile.name && !app.profileError ? app.explain : app.explainCache.get(name);
  if (effective === undefined) void explainFor(name);
  const effMap = effective && effective.effective ? new Map(effective.effective.map((entry) => [pk(entry.path), entry])) : null;

  const queueBtn = h("button", { type: "button", class: "btn primary", "data-fk": "prof:queue" });
  const edited = () => Object.keys(draft.fields).filter((field) => (draft.fields[field] || "") !== (ownValue([field]) || ""));
  const refresh = () => {
    const count = edited().length;
    queueBtn.textContent = count ? `Queue ${plural(count, "edit")}` : "Queue edits";
    queueBtn.disabled = disabled || stale(draft) || count === 0;
  };
  app.live.push(refresh);
  queueBtn.addEventListener("click", () => {
    if (stale(draft) || !draftFits(kind, draft.hash)) {
      render();
      return;
    }
    for (const field of edited()) {
      const value = draft.fields[field];
      enqueue(kind, [...own, field], value === undefined ? { remove: true } : { value }, draft.hash);
    }
    fresh(draft);
    render();
  });
  const desc = h("input", { type: "text", class: "text sans full", disabled, "data-fk": "prof:description", "aria-label": "description",
    value: Object.hasOwn(draft.fields, "description") ? draft.fields.description : ownValue(["description"]) || "" });
  desc.addEventListener("input", () => {
    touch(draft);
    draft.fields.description = desc.value;
    runLive();
  });
  const extOptions = [{ value: "", label: "(none)" }, ...app.state.profiles.filter((item) => item !== name).map((item) => ({ value: item, label: item }))];
  const extValue = Object.hasOwn(draft.fields, "extends") ? draft.fields.extends || "" : ownValue(["extends"]) || "";

  // rows
  const groups = [];
  for (const group of Object.keys(vocab.workflow)) {
    groups.push({ id: `workflow.${group}`, rows: Object.keys(vocab.workflow[group]).map((key) => ["workflow", group, key]) });
  }
  const other = [];
  for (const key of vocab.limitKeys) other.push(["limits", key]);
  const extra = new Map();
  for (const profile of [...ancestors, name]) {
    for (const entry of app.explain.root) {
      if (entry.path[0] !== "profiles" || entry.path[1] !== profile) continue;
      const rel = entry.path.slice(2);
      if (rel[0] === "roles" || rel[0] === "models") extra.set(pk(rel), rel);
    }
    for (const [, edit] of app.queues[kind]) {
      if (edit.path[0] === "profiles" && edit.path[1] === profile && (edit.path[2] === "roles" || edit.path[2] === "models") && edit.path.length > 3) {
        const rel = edit.path.slice(2);
        extra.set(pk(rel), rel);
      }
    }
  }
  for (const rel of draft.extraRows) extra.set(pk(rel), rel);
  for (const [slot, kept] of Object.entries(app.drafts)) {
    if (kept && (slot === "chainPanel" || slot === `chainPanel@${id}` || slot.startsWith(`chainPanel@${id}|`))) extra.set(kept.rel, JSON.parse(kept.rel));
  }
  other.push(...extra.values());
  groups.push({ id: "limits · roles · models", rows: other, always: true });

  const closeChain = () => {
    app.drafts.chainPanel = null;
    render();
  };
  const chainCell = (rel, value, errors) => {
    const path = [...own, ...rel];
    const open = Boolean(panel) && panel.rel === pk(rel);
    return [
      h("span", { class: `mbox${value === undefined ? " dashed" : ""}${errors.length ? " error" : ""}`, title: value === undefined ? undefined : fmt(value), text: value === undefined ? "inherit" : fmt(value) }),
      h("button", {
        type: "button", class: "link", text: open ? "close" : "edit", disabled, "aria-expanded": open ? "true" : "false",
        "aria-label": `${open ? "Close" : "Edit"} ${dotted(path)}`, "data-fk": `mchain:${pk(rel)}`,
        onclick: () => {
          if (open) return closeChain();
          if (panel) keepDraft("chainPanel", `${id}|${panel.rel}`);
          if (!takeDraft("chainPanel", `${id}|${pk(rel)}`)) app.drafts.chainPanel = fresh({ rel: pk(rel) }, (d) => Object.assign(d, { chain: null, rows: {} }));
          render();
        },
      }),
      value === undefined ? null : h("button", {
        type: "button", class: "link plain muted", text: "inherit", disabled, "aria-label": `Inherit ${dotted(path)}`, "data-fk": `mchain:${pk(rel)}:inherit`,
        onclick: () => {
          if (fileSets(kind, path)) enqueue(kind, path, { remove: true }, seen);
          else unqueue(kind, path);
          closeChain();
        },
      }),
      errors.length ? h("span", { class: "err small", text: errors[0].message }) : null,
    ];
  };
  const chainRow = (rel, value, effEntry, errors) => {
    const path = [...own, ...rel];
    const start = value !== undefined ? value : effEntry ? effEntry.value : rootValue(rel);
    const chainNow = () => panel.chain || clone(start) || [];
    const chainOut = () => resolveOptions(chainNow(), panel.rows);
    const ready = (chain) => chain !== null && chain.length >= vocab.chainMin && !same(chain, value) && !optionFormHasText(panel.rows);
    const queueChain = h("button", {
      type: "button", class: "btn primary", text: "Queue chain", "data-fk": `mchain:${pk(rel)}:queue`,
      onclick: () => {
        const chain = chainOut();
        if (!chain) render();
        if (app.drafts.chainPanel !== panel || !canEdit() || stale(panel) || !ready(chain)) return;
        if (enqueue(kind, path, { value: clone(chain) }, panel.hash)) closeChain();
        else render();
      },
    });
    app.live.push(() => { queueChain.disabled = disabled || stale(panel) || !ready(chainOut()); });
    return h("div", { class: "mchain", role: "group", "aria-label": dotted(path) },
      h("div", { class: "meta-caps mchain-title", text: dotted(path) }),
      chainEditor(chainNow, (next, typing) => { touch(panel); panel.chain = next; if (typing) runLive(); else render(); }, disabled, errors, panel.rows,
        () => { touch(panel); panel.chain = chainNow(); }),
      staleNotice("chainPanel"),
      h("div", { class: "btnrow mchain-btns" },
        queueChain,
        h("button", { type: "button", class: "btn", text: "Cancel", "data-fk": `mchain:${pk(rel)}:cancel`, onclick: closeChain })));
  };
  const columns = [...ancestors, name];
  const cellValue = (profile, rel) => (profile === name ? ownValue(rel) : rootValue(["profiles", profile, ...rel]));
  const rowsEl = [];
  let panelEl = null;
  for (const group of groups) {
    const setsAny = group.rows.some((rel) => columns.some((profile) => profile !== "normal" && cellValue(profile, rel) !== undefined));
    const open = group.always || setsAny || app.open.has(`m:${group.id}`);
    rowsEl.push(h("div", { class: "mrow mgroup", role: "row" }, h("span", { class: "mg-name", role: "cell", text: group.id }),
      open ? null : h("button", {
        type: "button", class: "link plain muted", "data-fk": `mg:${group.id}`,
        text: `${plural(group.rows.length, "key")}, all from normal · expand`,
        onclick: () => { app.open.add(`m:${group.id}`); render(); },
      })));
    if (!open) continue;
    for (const rel of group.rows) {
      const values = columns.map((profile) => cellValue(profile, rel));
      const winner = values.map((value) => value !== undefined).lastIndexOf(true);
      const cells = ancestors.map((profile, index) => {
        const value = values[index];
        const cls = value === undefined ? "faint" : index === winner ? "winning" : "struck";
        return h("span", { class: `mcell anc ${cls}`, role: "cell", text: value === undefined ? "·" : fmt(value) });
      });
      const effEntry = effMap ? effMap.get(pk(rel)) : undefined;
      const rootVal = rel[0] === "workflow" ? undefined : rootValue(rel);
      const effText = effective === null || effective === undefined ? "…" : effEntry ? fmt(effEntry.value) : effective.error ? "—" : "·";
      const errors = blockedFor([...own, ...rel]);
      const isChain = rel[0] === "roles" && rel[2] === "chain";
      rowsEl.push(h("div", { class: `mrow${errors.length ? " errrow" : ""}`, role: "row" },
        h("span", { class: "mcell key", role: "cell", title: dotted(rel), text: rel[0] === "workflow" ? rel.slice(2).join(".") : dotted(rel) }),
        cells,
        h("span", { class: `mcell mine${queued(kind, [...own, ...rel]) ? " edited" : ""}`, role: "cell" },
          isChain ? chainCell(rel, values[values.length - 1], errors) : matrixControl(name, rel, values[values.length - 1], disabled, errors)),
        h("span", { class: "mcell eff", role: "cell" }, effText,
          effEntry && rootVal !== undefined && !same(rootVal, effEntry.value) ? h("span", { class: "muted", text: ` · root ${fmt(rootVal)}` }) : null)));
      if (isChain && panel && panel.rel === pk(rel)) panelEl = chainRow(rel, values[values.length - 1], effEntry, errors);
    }
  }
  const adding = app.drafts.pAdd;
  const addInput = adding ? h("input", {
    type: "text", class: "text", "data-fk": "prof:add", "aria-label": adding.type === "role" ? "role.field" : "model id",
    placeholder: adding.type === "role" ? "role.field, e.g. execute.fast" : "model id, e.g. gpt-6.1-sol", value: adding.value,
  }) : null;
  if (addInput) {
    addInput.addEventListener("input", () => { touch(adding); adding.value = addInput.value; });
    addInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      const raw = addInput.value.trim();
      if (adding.type === "role") {
        const [role, field] = raw.split(".");
        if (role && field && vocab.roleKeys.includes(field)) draft.extraRows.push(["roles", role, field]);
      } else if (raw) {
        draft.extraRows.push(["models", raw, "fast"]);
      }
      app.drafts.pAdd = null;
      render();
    });
  }
  const openAdd = (type) => { app.drafts.pAdd = fresh({ type }, (d) => { d.value = ""; }); render(); };
  const isPreset = presets.includes(name);
  return h("div", { class: "editor" },
    h("header", { class: "ed-head row" },
      h("h2", { class: "h2", text: `profiles.${name}` }),
      h("span", { class: "ed-src b", text: declared ? `declared in ${shortLabel(declared.source)}` : "" }),
      h("span", { class: "spacer" }),
      h("span", { class: "muted", text: `edit in ${kind} · path` }),
      h("span", { class: "chip", text: `profiles.${name}.*` })),
    staleNotice("profile"),
    h("div", { class: "desc-row" },
      h("label", { class: "ffield grow" }, h("span", { class: "flabel", text: "description" }), desc),
      h("div", { class: "ffield ext" }, h("span", { class: "flabel", text: "extends" }),
        select(extOptions, extValue, (value) => {
          touch(draft);
          draft.fields.extends = value || undefined;
          render();
        }, { label: "extends", disabled, fk: "prof:extends", wide: true }))),
    h("section", { class: "matrix-wrap" },
      h("div", { class: "meta-caps" }, "INHERITANCE MATRIX", h("span", { class: "lc", text: ` · a later profile wins · edit in the ${name} column` })),
      h("div", { class: "matrix-scroll", "data-scroll": "matrix" },
        h("div", { class: "matrix", role: "table", "aria-label": "Inheritance matrix" },
          h("div", { class: "mrow mhead", role: "row" }, h("span", { class: "mcell key", role: "columnheader", text: "key" }),
            ancestors.map((profile) => h("span", { class: "mcell anc", role: "columnheader", text: profile })),
            h("span", { class: "mcell mine accent", role: "columnheader", text: `${name} ✎` }),
            h("span", { class: "mcell eff", role: "columnheader", text: "effective" })),
          rowsEl)),
      panelEl),
    h("div", { class: "links" },
      h("button", { type: "button", class: "link", text: "+ limit", "data-fk": "prof:+limit", disabled, onclick: () => {
        const input = document.querySelector(".mcell.mine input[data-limit]");
        if (input) input.focus();
      } }),
      h("button", { type: "button", class: "link", text: "+ role override", "data-fk": "prof:+role", disabled, onclick: () => openAdd("role") }),
      h("button", { type: "button", class: "link", text: "+ model", "data-fk": "prof:+model", disabled, onclick: () => openAdd("model") }),
      addInput),
    staleNotice("pAdd"),
    h("footer", { class: "ed-foot" },
      isPreset ? null : h("button", {
        type: "button", class: "btn danger", text: "Remove profile", disabled, "data-fk": "prof:remove",
        onclick: () => { enqueue(kind, own, { value: null }, seen); render(); },
      }),
      h("span", { class: "muted small", text: `writes profiles.${name}: null · presets have no Remove` }),
      h("span", { class: "spacer" }),
      queueBtn));
}

function matrixControl(name, rel, value, disabled, errors) {
  const kind = app.editIn;
  const path = ["profiles", name, ...rel];
  const type = valueKind(path);
  const seen = file(kind).hash;
  const set = (raw, from = seen) => {
    let done = true;
    if (raw === "__inherit" || raw === "") {
      if (fileSets(kind, path) || queued(kind, path)) {
        if (fileSets(kind, path)) done = enqueue(kind, path, { remove: true }, from);
        else unqueue(kind, path);
      }
    } else {
      const parsed = parseValue(type, raw);
      done = parsed.value !== undefined && enqueue(kind, path, { value: parsed.value }, from);
    }
    render();
    return done;
  };
  const dashed = value === undefined;
  const errorText = errors.length ? h("span", { class: "err small", text: errors[0].message }) : null;
  if (type.type === "enum" || type.type === "bool") {
    const values = type.type === "bool" ? ["true", "false"] : type.values;
    return [select([{ value: "__inherit", label: "inherit" }, ...values.map((item) => ({ value: item, label: item }))],
      value === undefined ? "__inherit" : String(value), set, { label: dotted(path), disabled, fk: `m:${pk(rel)}`, dashed, error: errors.length > 0, class: "cell-select" }), errorText];
  }
  if (type.type === "items") {
    const list = Array.isArray(value) ? value : [];
    return [h("span", { class: `mitems${dashed ? " dashed" : ""}${errors.length ? " error" : ""}`, role: "group", "aria-label": dotted(path) },
      dashed ? h("span", { class: "muted", text: "inherit" }) : null,
      type.items.map((item) => h("label", { class: "check" }, checkbox(list.includes(item), { disabled, "data-fk": `m:${pk(rel)}:${item}` }, (checked) => {
        const edit = queued(kind, path);
        const now = edit ? (edit.remove ? undefined : edit.value) : rootValue(path);
        const current = Array.isArray(now) ? now : [];
        const next = checked ? type.items.filter((other) => other === item || current.includes(other)) : current.filter((other) => other !== item);
        enqueue(kind, path, { value: next }, seen);
        render();
      }), item))),
    dashed ? null : h("button", { type: "button", class: "link plain muted", text: "inherit", disabled, "aria-label": `Inherit ${dotted(path)}`, "data-fk": `m:${pk(rel)}:inherit`, onclick: () => set("__inherit") }),
    errorText];
  }
  const placeholder = type.type === "number" ? `${type.range[0]}–${type.range[1]}${type.auto ? " or auto" : ""}` : "inherit";
  const cell = `cell:${kind}|${pk(path)}`;
  const input = h("input", {
    type: "text", class: `cell-input full${dashed ? " dashed" : ""}${errors.length ? " error" : ""}`, disabled, placeholder,
    "aria-label": dotted(path), "data-fk": `m:${pk(rel)}`, "data-limit": rel[0] === "limits" ? "1" : undefined,
    value: typedText(cell, value === undefined ? "" : type.type === "json" ? JSON.stringify(value) : String(value)),
  });
  typedField(input, cell, seen, (raw, from) => set(raw.trim(), from));
  return [input, staleNotice(cell), errorText];
}

// ----- s5 root settings -----

function rootScreen() {
  const kind = app.editIn;
  const vocab = app.state.vocab;
  const disabled = !canEdit();
  const f = file(kind);
  const seen = f.hash;
  const own = (path) => {
    const edit = queued(kind, path);
    if (edit) return { set: !edit.remove, value: edit.remove ? undefined : edit.value, edited: true, edit };
    const value = fileValue(kind, path);
    return { set: value !== undefined, value, edited: false };
  };
  const effOf = (path) => stackOf(path);
  const row = (key, path, control, hint, props = {}) => {
    const mine = own(path);
    const errors = blockedFor(path);
    const localError = props.error;
    return h("div", { class: `jrow lvl-${props.level || 0}${mine.edited ? " edited" : ""}${errors.length || localError ? " errrow" : ""}` },
      h("span", { class: `jkey${mine.set ? "" : " muted"}`, text: key ? `"${key}":` : "" }),
      h("span", { class: "jctl" }, control),
      h("span", { class: "jhint" }, errors.length ? h("span", { class: "err", text: errors[0].message }) : localError ? h("span", { class: "err", text: localError }) : hint),
      props.right ? h("span", { class: "jright muted", text: props.right }) : null);
  };

  // profile
  const profileOwn = own(["profile"]);
  const profileEntry = app.rootMap.get(pk(["profile"]));
  const profileCtl = select([{ value: "__inherit", label: "inherit" }, ...app.state.profiles.map((item) => ({ value: item, label: `"${item}"` }))],
    profileOwn.set ? profileOwn.value : "__inherit", (value) => {
      if (value === "__inherit") {
        if (fileValue(kind, ["profile"]) !== undefined) enqueue(kind, ["profile"], { remove: true }, seen);
        else unqueue(kind, ["profile"]);
      } else if (value === fileValue(kind, ["profile"])) unqueue(kind, ["profile"]);
      else enqueue(kind, ["profile"], { value }, seen);
      render();
    }, { label: "profile", disabled, fk: "root:profile", dashed: !profileOwn.set });
  const profileHint = profileEntry ? `${profileEntry.source.kind === "defaults" ? `defaults ${profileEntry.source.set}` : profileEntry.source.kind} sets "${profileEntry.value}"` : "";

  // limits
  const limitRows = vocab.limitKeys.map((key) => {
    const path = ["limits", key];
    const mine = own(path);
    const [min, max] = vocab.limitRanges[key];
    const stack = effOf(path);
    const cell = `cell:${kind}|${pk(path)}`;
    const input = h("input", {
      type: "text", inputmode: "numeric", class: `num small${mine.set ? "" : " dashed"}`, disabled, "aria-label": `limits.${key}`,
      placeholder: mine.set ? "" : fmt(rootValue(path)),
      value: typedText(cell, mine.value === undefined ? "" : String(mine.value)), "data-fk": `root:limit:${key}`,
    });
    typedField(input, cell, seen, (text, from) => {
      const raw = text.trim();
      const number = /^-?\d+$/.test(raw) ? Number(raw) : undefined;
      let done = raw === "" || number !== undefined;
      if (raw === "" && fileValue(kind, path) !== undefined) done = enqueue(kind, path, { remove: true }, from);
      else if (number !== undefined && number !== fileValue(kind, path)) done = enqueue(kind, path, { value: number }, from);
      else if (done) unqueue(kind, path);
      render();
      return done;
    });
    const over = overridesOf(kind, path);
    const parts = [`${min}–${max}`];
    if (!mine.set) parts.push(`inherited${stack.rows.defaults && !over.length && stack.winner === "defaults" ? " from defaults" : ""}`);
    else {
      const lower = LAYERS.slice(0, LAYERS.indexOf(kind)).reverse().find((layer) => stack.rows[layer] && layer !== "defaults");
      if (!over.length && lower) parts.push(`wins over ${lower} ${fmt(stack.rows[lower].value)}`);
    }
    const hint = h("span", null, h("span", { class: "muted", text: parts.join(" · ") }),
      over.map((item) => h("span", { class: "warn-text", text: ` · ▲ ${item.who} overrides this value (sets ${fmt(item.value)})` })));
    const value = mine.value;
    const localError = typeof value === "number" && (value < min || value > max) ? `must be an integer from ${min} to ${max}` : undefined;
    return row(key, path, [input, staleNotice(cell)], hint, { level: 1, error: localError });
  });

  // harnesses
  const harnessOwn = own(["harnesses"]);
  const harnessEff = harnessStack();
  const kinds = knownKinds();
  const listNow = () => {
    const mine = own(["harnesses"]);
    return mine.set ? mine.value : harnessEff.noKey ? null : harnessEff.value;
  };
  const list = listNow();
  const setList = (next, from = seen) => {
    if (same(next, fileValue(kind, ["harnesses"]))) unqueue(kind, ["harnesses"]);
    else if (!enqueue(kind, ["harnesses"], { value: next }, from)) return false;
    render();
    return true;
  };
  const chips = kinds.map((driver) => {
    const on = list ? list.includes(driver) : true;
    return h("button", {
      type: "button", class: `hchip${on ? " on" : ""}${harnessOwn.set ? "" : " dashed"}`, disabled, "aria-pressed": on ? "true" : "false",
      "data-fk": `root:h:${driver}`,
      onclick: () => {
        const current = listNow();
        const base = current ? [...current] : knownKinds();
        setList(base.includes(driver) ? base.filter((item) => item !== driver) : [...base, driver]);
      },
    }, h("span", { class: "sq", "aria-hidden": "true" }), `"${driver}"`);
  });
  const hAdd = app.drafts.hAdd;
  const hInput = hAdd ? h("input", { type: "text", class: "text small", value: hAdd.value, placeholder: "driver kind", "aria-label": "new driver kind", "data-fk": "root:h:add" }) : null;
  if (hInput) {
    hInput.addEventListener("input", () => { touch(hAdd); hAdd.value = hInput.value; });
    hInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { app.drafts.hAdd = undefined; render(); }
      if (event.key !== "Enter" || stale(hAdd)) return;
      if (!new RegExp(vocab.providerPattern).test(hInput.value)) {
        hAdd.error = `a driver kind matches ${vocab.providerPattern}`;
        render();
        return;
      }
      const current = listNow();
      const base = current ? [...current] : knownKinds();
      if (!base.includes(hInput.value)) base.push(hInput.value);
      app.drafts.hAdd = undefined;
      if (!setList(base, hAdd.hash)) {
        app.drafts.hAdd = hAdd;
        render();
      }
    });
  }
  const effList = list || kinds;
  const orphaned = roleNames().filter((role) => {
    const chain = stackOf(["roles", role, "chain"]).value;
    return Array.isArray(chain) && chain.length > 0 && !chain.some((rung) => effList.includes(rung.driver || rung.provider));
  });
  const missing = kinds.filter((item) => !effList.includes(item));
  const harnessCtl = h("span", { class: "hlist" }, h("span", { class: "faint", text: "[" }), chips,
    h("button", { type: "button", class: "link", text: "+ kind", disabled, "data-fk": "root:h:+", onclick: () => { app.drafts.hAdd = fresh({}, (d) => Object.assign(d, { value: "", error: "" })); render(); } }),
    hInput, h("span", { class: "faint", text: "]" }), h("span", { class: "muted", text: " or " }),
    h("button", {
      type: "button", class: "link plain", text: "remove key (every driver)", disabled: disabled || !fileSets(kind, ["harnesses"]), "data-fk": "root:h:rm",
      onclick: () => { enqueue(kind, ["harnesses"], { remove: true }, seen); render(); },
    }));
  const harnessNote = [
    staleNotice("hAdd"),
    hAdd && hAdd.error ? h("div", { class: "err small", text: hAdd.error }) : null,
    orphaned.length ? h("div", { class: "warn-sentence", text: `Without ${joinAnd(missing)}, ${joinAnd(orphaned)} ${orphaned.length === 1 ? "becomes" : "become"} unavailable.` }) : null,
    !harnessOwn.set && harnessEff.noKey ? h("div", { class: "muted small", text: "No key: every driver kind runs." }) : null,
  ];

  // models
  const modelIds = [];
  for (const entry of app.explain.root) if (entry.path[0] === "models" && !modelIds.includes(entry.path[1])) modelIds.push(entry.path[1]);
  for (const [, edit] of app.queues[kind]) if (edit.path[0] === "models" && edit.path[1] && !modelIds.includes(edit.path[1])) modelIds.push(edit.path[1]);
  const modelCtl = (id) => {
    const path = ["models", id, "fast"];
    const mine = own(path);
    const inherited = rootValue(path);
    return h("span", { class: "inline" }, h("span", { class: "faint", text: `{ "${id}": { "fast": ` }),
      select([{ value: "true", label: "true" }, { value: "false", label: "false" }, { value: "__inherit", label: `inherit (${inherited === undefined ? "not set" : fmt(inherited)})` }],
        mine.set ? String(mine.value) : "__inherit", (value) => {
          if (value === "__inherit") {
            if (fileValue(kind, path) !== undefined) enqueue(kind, path, { remove: true }, seen);
            else unqueue(kind, path);
          } else {
            const next = value === "true";
            if (next === fileValue(kind, path)) unqueue(kind, path);
            else enqueue(kind, path, { value: next }, seen);
          }
          render();
        }, { label: `models.${id}.fast`, disabled, fk: `root:model:${id}`, dashed: !mine.set }),
      h("span", { class: "faint", text: " } }" }));
  };
  const mAdd = app.drafts.mAdd;
  const modelRows = modelIds.map((id, index) => row(index === 0 ? "models" : "", ["models", id, "fast"], modelCtl(id), null));
  const mInput = mAdd ? h("input", { type: "text", class: "text small", value: mAdd.value, placeholder: "model id", "aria-label": "new model id", "data-fk": "root:m:add" }) : null;
  const mNote = staleNotice("mAdd");
  if (mInput) {
    mInput.addEventListener("input", () => { touch(mAdd); mAdd.value = mInput.value; });
    mInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { app.drafts.mAdd = undefined; render(); }
      if (event.key !== "Enter" || !mInput.value.trim() || stale(mAdd)) return;
      if (enqueue(kind, ["models", mInput.value.trim(), "fast"], { value: true }, mAdd.hash)) app.drafts.mAdd = undefined;
      render();
    });
  }

  const content = h("div", { class: "jform", "data-scroll": "jform" },
    h("header", { class: "root-head" }, h("h2", { class: "h3", text: "root settings" }),
      h("span", { class: "muted", text: `edit in ${kind} · root paths of ${f.path}` })),
    !usable(kind) ? h("p", { class: "warn-text", text: `Edit in ${kind} is off: ${absent(kind) ? "the file does not exist" : "the file does not parse"}.` }) : null,
    h("div", { class: "jpunct", text: "{" }),
    row("profile", ["profile"], profileCtl, h("span", { class: "muted", text: profileHint })),
    h("div", { class: "jrow" }, h("span", { class: `jkey${fileSets(kind, ["limits"]) ? "" : " muted"}`, text: '"limits": {' })),
    limitRows,
    h("div", { class: "jpunct in1", text: "}," }),
    row("harnesses", ["harnesses"], harnessCtl, null),
    h("div", { class: "jnote" }, harnessNote),
    modelRows.length ? modelRows : null,
    h("div", { class: "jrow" }, h("span", { class: "jkey" }), h("span", { class: "jctl" },
      h("button", { type: "button", class: "link", text: "+ model", disabled, "data-fk": "root:m:+", onclick: () => { app.drafts.mAdd = fresh({}, (d) => { d.value = ""; }); render(); } }), mInput)),
    mNote ? h("div", { class: "jnote" }, mNote) : null,
    h("div", { class: "jpunct", text: "}" }),
    h("p", { class: "prose muted foot", text: `Solid box: the ${kind} file sets this key. Dashed box: not set here, the value is inherited. Profiles cannot set defaults or harnesses.` }));
  return h("section", { class: "screen-root" }, h("div", { class: "root-main" }, blockedCard(), content), previewPanel());
}

function previewPanel() {
  return h("aside", { class: "preview", "data-scroll": "preview" },
    h("div", { class: "meta-caps", text: "DEFAULTS" }),
    h("p", { class: "prose", text: "Run omt doctor or omt update to review and accept current defaults. Your overrides stay in these config files." }));
}

// ---------- s6 review ----------

function sentEdit(edit) {
  return edit.remove ? { path: [...edit.path], remove: true } : { path: [...edit.path], value: clone(edit.value) };
}

// The request is a deep copy, so that a later edit of the queue cannot change what a preview showed.
function requestFor(kind) {
  return {
    file: kind,
    base: app.bases[kind] || file(kind).hash || "",
    edits: [...app.queues[kind].values()].map(sentEdit),
  };
}

function bodyOf(request) {
  return JSON.stringify(request);
}

function handleEditError(kind, error) {
  if (error.code === "config_changed") app.conflict = { file: kind, message: error.message, confirming: false };
  else if (error.code === "config_invalid") app.blocked = { file: kind, errors: error.newErrors || [] };
  else if (error.code === "config_not_found" || error.code === "jsonc_parse") app.fileError[kind] = { code: error.code, message: error.message };
  else if (error.code === "network") stop();
  else app.error = { message: error.message, hint: error.hint };
}

function openReview() {
  if (app.stopped || totalQueued() === 0) return;
  const tab = queueCount(app.editIn) ? app.editIn : FILES.find((kind) => queueCount(kind));
  app.review = { tab, previews: {} };
  app.issuesOpen = false;
  render();
  requestAnimationFrame(() => {
    const first = document.querySelector("#review-host .rtab");
    if (first) first.focus();
  });
}

// Review shows a file that has queued edits, and closes when no file has any.
function settleReview() {
  if (!app.review || queueCount(app.review.tab)) return;
  const next = FILES.find((kind) => queueCount(kind));
  if (next) app.review.tab = next;
  else app.review = null;
}

function closeReview() {
  app.review = null;
  render();
  const button = document.querySelector("#statusbar .review-btn");
  if (button) button.focus();
}

// Each preview belongs to one review session and one request. A response for an older session or request is dropped,
// and Write sends the request of the preview on screen.
function startPreview(kind) {
  const session = app.review;
  const request = requestFor(kind);
  const slot = { status: "loading", request, body: bodyOf(request), gen: app.gen };
  session.previews[kind] = slot;
  const current = () => app.review === session && session.previews[kind] === slot && slot.gen === app.gen;
  api("api/preview", request).then((result) => {
    if (!current()) return;
    slot.status = "ok";
    slot.result = result;
    if (result.newErrors.length > 0) app.blocked = { file: kind, errors: result.newErrors };
    else if (app.blocked && app.blocked.file === kind) app.blocked = null;
    render();
  }, (error) => {
    if (!current()) return;
    handleEditError(kind, error);
    slot.status = "error";
    slot.message = error.message;
    slot.code = error.code;
    render();
  });
  return slot;
}

// After a write, only the sent edits leave the queue. An edit that changed while the write ran stays queued.
function dropSent(kind, edits) {
  const queue = app.queues[kind];
  for (const edit of edits) {
    const key = pk(edit.path);
    const entry = queue.get(key);
    if (entry && same(sentEdit(entry), edit)) queue.delete(key);
  }
}

async function writeFile(kind) {
  const session = app.review;
  const preview = session && session.previews[kind];
  if (app.writing || !preview || preview.status !== "ok" || preview.gen !== app.gen || bodyOf(requestFor(kind)) !== preview.body) return;
  const request = preview.request;
  app.writing = kind;
  render();
  try {
    const result = await api("api/write", request);
    dropSent(kind, request.edits);
    if (app.blocked && app.blocked.file === kind) app.blocked = null;
    if (app.conflict && app.conflict.file === kind) app.conflict = null;
    delete app.fileError[kind];
    setState(result.state);
    app.bases[kind] = queueCount(kind) ? file(kind).hash : null;
    app.toast = { text: `✓ wrote ${plural(request.edits.length, "edit")} to ${kind}` };
    setTimeout(() => { app.toast = null; render(); }, 4000);
    if (app.review) {
      delete app.review.previews[kind];
      settleReview();
    }
  } catch (error) {
    handleEditError(kind, error);
    if (error.code === "config_invalid" && preview.result && session.previews[kind] === preview) {
      preview.result.newErrors = error.newErrors || [];
    }
  } finally {
    app.writing = null;
  }
  render();
}

function diffHunks(diff, edits) {
  let oldLine = 0;
  let newLine = 0;
  const lines = diff.map((item) => {
    if (item.op === " ") {
      oldLine++;
      newLine++;
      return { ...item, num: oldLine };
    }
    if (item.op === "-") {
      oldLine++;
      return { ...item, num: oldLine };
    }
    newLine++;
    return { ...item, num: newLine };
  });
  const blocks = [];
  lines.forEach((line, index) => {
    if (line.op === " ") return;
    const start = Math.max(0, index - 3);
    const end = Math.min(lines.length - 1, index + 3);
    const last = blocks.at(-1);
    if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
    else blocks.push({ start, end });
  });
  return blocks.map((block) => {
    const slice = lines.slice(block.start, block.end + 1);
    const changed = slice.filter((line) => line.op !== " ");
    const edit = edits.find((item) => changed.some((line) => line.line.includes(`"${item.path.at(-1)}"`)));
    return { label: edit ? dotted(edit.path) : `lines ${slice[0].num}–${slice.at(-1).num}`, lines: slice };
  });
}

function renderReview() {
  const host = document.getElementById("review-host");
  settleReview();
  if (!app.review || !app.state) {
    host.replaceChildren();
    return;
  }
  const kind = app.review.tab;
  const edits = [...app.queues[kind].values()];
  let preview = app.review.previews[kind];
  if (edits.length && (!preview || preview.gen !== app.gen || preview.body !== bodyOf(requestFor(kind)))) preview = startPreview(kind);
  const tabs = FILES.filter((item) => queueCount(item)).map((item) => h("button", {
    type: "button", class: `rtab${item === kind ? " on" : ""}`, role: "tab", "aria-selected": item === kind ? "true" : "false",
    "data-fk": `rtab:${item}`, text: `${item} · ${queueCount(item)}`,
    onclick: () => { app.review.tab = item; render(); },
  }));
  const editBlocks = edits.map((edit) => {
    const old = edit.path[0] === "profiles" && edit.path.length === 2 ? (fileSets(kind, edit.path) ? "set" : undefined) : fileValue(kind, edit.path);
    const wasSet = old !== undefined || fileSets(kind, edit.path);
    const removing = edit.remove || edit.value === null;
    const mark = removing ? "-" : wasSet ? "~" : "+";
    const to = edit.remove ? "not set" : fmt(edit.value);
    const over = overridesOf(kind, edit.path);
    return h("div", { class: "redit" },
      h("div", { class: "redit-path" }, h("span", { class: `mark m${mark === "-" ? "rm" : mark === "+" ? "add" : "chg"}`, text: mark }), ` ${dotted(edit.path)}`),
      h("div", { class: "redit-chg", text: `${wasSet ? (old === undefined ? "set" : fmt(old)) : "not set"} → ${to}` }),
      over.length && !removing ? h("div", { class: "warn-text small", text: `▲ ${over[0].who} overrides this value (sets ${fmt(over[0].value)})` }) : null);
  });
  const result = preview && preview.status === "ok" ? preview.result : null;
  const newErrors = result ? result.newErrors : app.blocked && app.blocked.file === kind ? app.blocked.errors : [];
  const warnings = result ? result.issues.filter((issue) => issue.severity === "warning" && issueSource(issue.source) === kind) : [];
  const known = new Set(allIssues().map((issue) => pk([issue.source, issue.path, issue.message])));
  const newWarnings = warnings.filter((issue) => !known.has(pk([issue.source, issue.path, issue.message])));
  const check = h("div", { class: "rcheck", "aria-live": "polite" }, h("div", { class: "meta-caps", text: "CHECK" }),
    !result ? h("p", { class: "muted", text: preview && preview.status === "error" ? `✕ ${preview.message}` : "checking…" })
      : newErrors.length === 0 ? h("p", { class: "ok", text: "✓ no new errors (validateLayer + merge)" })
        : [h("p", { class: "err", text: `✕ ${plural(newErrors.length, "new error")}` }), newErrors.map((issue) => h("p", { class: "err small", text: `${issue.path}: ${issue.message}` }))],
    warnings.length ? h("p", { class: "warn", text: `▲ ${plural(warnings.length, "warning")} already in ${kind} · does not block` }) : null,
    newWarnings.map((issue) => h("p", { class: "warn-text small", text: `▲ ${issue.path || "(file)"}: ${issue.message}` })),
    result ? h("p", { class: "text-2", text: "✓ comments outside the edited values kept" }) : null);
  let diffEl;
  if (!result) diffEl = h("p", { class: "muted pad", text: preview && preview.status === "error" ? "No diff: the preview failed." : "checking…" });
  else {
    const hunks = diffHunks(result.diff, edits);
    diffEl = hunks.length === 0 ? h("p", { class: "muted pad", text: "The edits do not change the file text." }) : hunks.map((hunk) => h("div", { class: "hunk" },
      h("div", { class: "dline head" }, h("span", { class: "dnum" }), h("span", { class: "dop faint", text: "@@" }), h("span", { class: "dtext muted", text: hunk.label })),
      hunk.lines.map((line) => h("div", { class: `dline${line.op === "+" ? " add" : line.op === "-" ? " rm" : ""}` },
        h("span", { class: "dnum", text: String(line.num) }), h("span", { class: "dop", text: line.op === "-" ? "−" : line.op === "+" ? "+" : "" }),
        h("span", { class: "dtext", text: line.line })))));
  }
  const conflict = app.conflict && app.conflict.file === kind ? conflictBanner() : null;
  const writeBtn = h("button", {
    type: "button", class: "btn accent", "data-fk": "review:write",
    text: app.writing === kind ? `Writing to ${kind}…` : `Write ${plural(result ? preview.request.edits.length : edits.length, "edit")} to ${kind}`,
    disabled: app.stopped || !result || newErrors.length > 0 || Boolean(conflict) || Boolean(app.writing),
    onclick: () => writeFile(kind),
  });
  const panel = h("div", { class: "review", role: "dialog", "aria-modal": "true", "aria-label": "Review changes" },
    h("div", { class: "rtabs", role: "tablist" }, h("span", { class: "rtitle", text: "REVIEW" }), tabs, h("span", { class: "spacer" }), h("span", { class: "muted small", text: "esc to close" })),
    h("div", { class: "rbody" },
      h("div", { class: "redits", "data-scroll": "redits" }, h("div", { class: "meta-caps" }, "EDITS → ", h("span", { class: "lc", text: file(kind).path })), editBlocks, check),
      h("div", { class: "rdiff", "data-scroll": "rdiff" }, diffEl)),
    conflict,
    h("div", { class: "rfoot" }, h("span", { class: "muted small", text: 'The write stops with "changed on disk" if another tool edited the file after the page read it.' }),
      h("span", { class: "spacer" }),
      h("button", { type: "button", class: "btn", text: "Back", "data-fk": "review:back", onclick: closeReview }),
      writeBtn));
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusables = [...panel.querySelectorAll("button:not([disabled]), [tabindex='0']")];
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  host.replaceChildren(panel);
}

function conflictBanner() {
  const conflict = app.conflict;
  const count = queueCount(conflict.file);
  const other = conflict.file === "user" ? "project" : "user";
  return h("div", { class: "conflict" },
    h("div", { class: "conflict-main" }, h("span", { class: "err b", text: "✕ CHANGED ON DISK" }), h("span", { class: "conflict-msg", text: conflict.message }),
      h("span", { class: "spacer" }),
      conflict.confirming ? null : h("button", {
        type: "button", class: "btn primary", text: "Reload…", "data-fk": "conflict:reload",
        onclick: () => {
          conflict.confirming = true;
          render();
          const keep = document.querySelector('[data-fk="conflict:keep"]');
          if (keep) keep.focus();
        },
      })),
    conflict.confirming ? h("div", { class: "conflict-confirm" },
      h("p", { text: `Reload drops the ${plural(count, "queued edit")} for ${conflict.file}.${queueCount(other) ? ` Edits for ${other} stay.` : ""}` }),
      h("div", { class: "btnrow" },
        h("button", { type: "button", class: "btn", text: "Keep editing", "data-fk": "conflict:keep", onclick: () => { conflict.confirming = false; render(); } }),
        h("button", {
          type: "button", class: "btn err-fill", text: `Drop ${plural(count, "edit")} and reload`, "data-fk": "conflict:drop",
          onclick: async () => {
            clearQueue(conflict.file);
            app.conflict = null;
            app.blocked = null;
            if (app.review) delete app.review.previews[conflict.file];
            settleReview();
            await loadState();
          },
        }))) : null);
}

// ---------- banners and status bar ----------

function renderBanners() {
  const host = document.getElementById("banners");
  const out = [];
  if (app.stopped && app.state) {
    out.push(h("div", { class: "stopped-card" },
      h("p", { class: "err", text: "● disconnected · the editor stopped" }),
      h("p", { class: "prose", text: "The page is read-only now. Queued edits were not written. Start the editor again:" }),
      cmdLine("omt config edit --web")));
  }
  if (app.conflict && !app.review) out.push(conflictBanner());
  host.replaceChildren(...out);
}

function renderStatus() {
  const bar = document.getElementById("statusbar");
  if (!app.state) {
    bar.replaceChildren();
    append(bar, [
      h("span", { class: `dot ${app.stopped ? "err" : "ok"}`, role: "img", "aria-label": app.stopped ? "Editor stopped" : "Editor connected" }),
      h("span", { class: app.stopped ? "err" : "conn", text: app.stopped ? "disconnected · the editor stopped" : "connected · 127.0.0.1" }),
      app.error ? h("span", { class: "err", text: `✕ ${app.error.message}${app.error.hint ? ` · ${app.error.hint}` : ""}` }) : null]);
    return;
  }
  const issues = allIssues();
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  let summary = null;
  if (app.toast) summary = h("span", { class: "ok", text: app.toast.text });
  else if (app.error) summary = h("span", { class: "err" }, `✕ ${app.error.message}`, app.error.hint ? h("span", { class: "muted", text: ` · ${app.error.hint}` }) : null);
  else if (errors.length || warnings.length) {
    const first = errors[0] || warnings[0];
    summary = h("button", {
      type: "button", class: "issues-btn", "aria-expanded": app.issuesOpen ? "true" : "false", "data-fk": "status:issues",
      onclick: () => { app.issuesOpen = !app.issuesOpen; render(); },
    }, errors.length ? h("span", { class: "err", text: `✕ ${plural(errors.length, "error")}` }) : h("span", { class: "warn", text: `▲ ${plural(warnings.length, "warning")}` }),
    h("span", { class: "muted", text: ` ${first.path || "(file)"} (${issueSource(first.source)}): ${first.message}` }));
  }
  const counts = app.stopped
    ? FILES.filter((kind) => queueCount(kind)).map((kind) => `${kind}: ${queueCount(kind)} queued (not written)`).join(" · ") || "nothing queued"
    : `user: ${queueCount("user")} queued · project: ${queueCount("project")}`;
  bar.replaceChildren();
  append(bar, [
    h("span", { class: `dot ${app.stopped ? "err" : "ok"}`, role: "img", "aria-label": app.stopped ? "Editor stopped" : "Editor connected" }),
    h("span", { class: app.stopped ? "err" : "conn", text: app.stopped ? "disconnected · the editor stopped" : "connected · 127.0.0.1" }),
    summary,
    h("span", { class: "spacer" }),
    h("span", { class: "counts", text: counts }),
    h("button", {
      type: "button", class: "btn accent review-btn", "data-fk": "status:review", text: "Review changes ⏎",
      "aria-keyshortcuts": IS_MAC ? "Meta+Enter" : "Control+Enter",
      disabled: app.stopped || totalQueued() === 0,
      onclick: openReview,
    })]);
  const pop = document.getElementById("issues-pop");
  pop.hidden = !app.issuesOpen;
  if (app.issuesOpen) {
    pop.replaceChildren(h("div", { class: "meta-caps", text: "ISSUES" }), ...issues.map((issue) => h("p", { class: issue.severity === "error" ? "err" : "warn-text" },
      `${issue.severity === "error" ? "✕" : "▲"} ${issue.path || "(file)"} (${issueSource(issue.source)}): `, h("span", { class: "text", text: issue.message }))));
  }
}

// ---------- global keys and start ----------

function isField(el) {
  return el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA");
}

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    openReview();
    return;
  }
  if (event.key === "Escape") {
    if (app.review) {
      event.preventDefault();
      closeReview();
    } else if (app.issuesOpen) {
      app.issuesOpen = false;
      render();
    } else if (!isField(document.activeElement) && app.route.screen !== "effective") {
      go("#/");
    }
    return;
  }
  if (event.key === "/" && !isField(document.activeElement) && !app.review) {
    const filter = document.getElementById("filter");
    if (filter) {
      event.preventDefault();
      filter.focus();
    }
  }
});

document.addEventListener("pointerdown", () => { pointerDown = true; }, true);
document.addEventListener("pointerup", () => {
  pointerDown = false;
  if (renderPending) setTimeout(() => { if (renderPending) render(); }, 0);
}, true);
document.addEventListener("pointercancel", () => { pointerDown = false; }, true);

document.getElementById("profile-picker").addEventListener("change", (event) => pickProfile(event.target.value));

addEventListener("hashchange", () => {
  app.route = parseHash();
  render();
});

addEventListener("pagehide", () => navigator.sendBeacon(BASE + "api/close"));

app.route = parseHash();
void ping();
pingTimer = setInterval(ping, PING_MS);
void loadState();
