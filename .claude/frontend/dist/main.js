"use strict";

// Tailon frontend: framework-free vanilla JavaScript. It fetches the file list
// and streams lines over Server-Sent Events. Modes: "tail" (follow) and "grep"
// (whole file); a regexp filter (server-side, invertible) narrows the output.
// Injected globals: relativeRoot, allowDownload, wrapLinesInitial,
// tailLinesInitial.

const RELATIVE_ROOT = (typeof relativeRoot !== "undefined" && relativeRoot) || "/";
const MODES = ["tail", "grep"];

const state = {
    files: [], file: null, mode: "tail", filter: "", invert: false,
    nlines: (typeof tailLinesInitial !== "undefined" && tailLinesInitial) || 10,
    history: 2000,
    wrap: (typeof wrapLinesInitial !== "undefined" && wrapLinesInitial) || false,
    source: null,
};

const el = {};
[
    "file-select", "mode-select", "filter-input", "filter-apply",
    "cfg-invert", "cfg-nlines", "cfg-history", "cfg-wrap",
    "action-download", "status", "scrollable", "logview",
].forEach(function (id) { el[id] = document.getElementById(id); });

// Log view: append-only lines with autoscroll and history trimming.
const logview = {
    lines: [],
    atBottom: function () {
        const p = el["scrollable"];
        return Math.abs(p.scrollTop - (p.scrollHeight - p.offsetHeight)) < 50;
    },
    clear: function () { el["logview"].replaceChildren(); this.lines = []; },
    trim: function () {
        while (state.history > 0 && this.lines.length > state.history) {
            el["logview"].removeChild(this.lines.shift());
        }
    },
    write: function (text) {
        const scroll = this.atBottom();
        const span = document.createElement("span");
        span.className = "log-entry";
        span.textContent = text;
        el["logview"].appendChild(span);
        this.lines.push(span);
        this.trim();
        if (scroll) el["scrollable"].scrollTop = el["scrollable"].scrollHeight;
    },
};

function setStatus(text) { el["status"].textContent = text; el["status"].hidden = !text; }

function connect() {
    if (state.source) { state.source.close(); state.source = null; }
    if (!state.file) return;
    logview.clear();

    const p = new URLSearchParams({ mode: state.mode, filter: state.filter, nlines: String(state.nlines) });
    if (state.invert) p.set("invert", "1");
    if (state.file.all) p.set("all", "1"); else p.set("path", state.file.path);

    setStatus("connecting…");
    const src = new EventSource(RELATIVE_ROOT + "stream?" + p.toString());
    state.source = src;
    src.onopen = function () { setStatus(""); };
    src.onmessage = function (e) { logview.write(JSON.parse(e.data)); };
    src.addEventListener("eof", function () { src.close(); state.source = null; setStatus(""); });
    src.onerror = function () { setStatus("reconnecting…"); };
}

async function refreshFiles() {
    let data;
    try { data = await (await fetch(RELATIVE_ROOT + "list")).json(); }
    catch (e) { setStatus("could not load file list"); return; }

    const prev = state.file && state.file.path;
    state.files = [];
    el["file-select"].replaceChildren();

    el["file-select"].add(new Option("All files", "0"));
    state.files.push({ path: "", alias: "All files", all: true });

    Object.keys(data).forEach(function (key) {
        const group = document.createElement("optgroup");
        group.label = key === "__default__" ? "Ungrouped Files" : key;
        data[key].forEach(function (entry) {
            group.appendChild(new Option(entry.alias || entry.path, String(state.files.length)));
            state.files.push(entry);
        });
        el["file-select"].appendChild(group);
    });

    // Restore the previous selection by path, else select the first entry.
    let i = state.files.findIndex(function (f) { return f.path === prev; });
    if (i < 0) i = state.files.length ? 0 : -1;
    state.file = i >= 0 ? state.files[i] : null;
    if (i >= 0) el["file-select"].value = String(i);
}

function updateDownload() {
    const off = !allowDownload || !state.file || state.file.all;
    el["action-download"].hidden = off;
    if (!off) {
        el["action-download"].href = RELATIVE_ROOT + "files/?path=" + encodeURIComponent(state.file.path);
        el["action-download"].download = state.file.path.split("/").pop();
    }
}

function applyFilter() {
    if (el["filter-input"].value === state.filter) return; // no change, no reconnect
    state.filter = el["filter-input"].value;
    connect();
}

function init() {
    MODES.forEach(function (m) { el["mode-select"].add(new Option(m, m)); });
    el["mode-select"].value = state.mode;
    el["mode-select"].onchange = function () { state.mode = el["mode-select"].value; connect(); };

    el["filter-input"].value = state.filter;
    el["filter-input"].addEventListener("keyup", function (e) { if (e.key === "Enter") applyFilter(); });
    el["filter-input"].addEventListener("change", applyFilter); // also apply on focus loss
    el["filter-apply"].onclick = applyFilter;

    el["file-select"].addEventListener("focus", refreshFiles);
    el["file-select"].onchange = function () {
        state.file = state.files[Number(el["file-select"].value)];
        updateDownload();
        connect();
    };

    el["cfg-invert"].checked = state.invert;
    el["cfg-invert"].onchange = function () { state.invert = el["cfg-invert"].checked; connect(); };
    el["cfg-nlines"].value = state.nlines;
    el["cfg-nlines"].onchange = function () { state.nlines = Math.max(1, parseInt(el["cfg-nlines"].value, 10) || 1); connect(); };
    el["cfg-history"].value = state.history;
    el["cfg-history"].onchange = function () { state.history = Math.max(0, parseInt(el["cfg-history"].value, 10) || 0); logview.trim(); };
    el["cfg-wrap"].checked = state.wrap;
    el["cfg-wrap"].onchange = function () { state.wrap = el["cfg-wrap"].checked; el["logview"].classList.toggle("wrap", state.wrap); };
    el["logview"].classList.toggle("wrap", state.wrap);

    refreshFiles().then(function () { updateDownload(); connect(); });
}

init();
