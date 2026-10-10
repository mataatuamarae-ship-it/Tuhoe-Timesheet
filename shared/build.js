#!/usr/bin/env node
/* Assembles the three Tuhoe Timesheet builds from the shared shell +
 * shared app-core.js + a small per-target storage/library adapter.
 * Run: node build.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
// Works from two layouts: shared/ sitting inside the Electron project folder
// (the shipped layout: <project>/shared/build.js) or beside an electron/ folder.
const INSIDE_PROJECT = fs.existsSync(path.join(ROOT, "..", "package.json"));
const ELECTRON_DIR = INSIDE_PROJECT ? path.join(ROOT, "..") : path.join(ROOT, "..", "electron");
const DIST_DIR = path.join(ROOT, "..", "dist");
const shellTemplate = fs.readFileSync(path.join(ROOT, "shell-template.html"), "utf8");
const libsInline = fs.readFileSync(path.join(ROOT, "libs-inline.html"), "utf8");
const appCoreJs = fs.readFileSync(path.join(ROOT, "app-core.js"), "utf8");

function fillShell(vars) {
  let html = shellTemplate;
  for (const [key, value] of Object.entries(vars)) {
    const token = `{{${key}}}`;
    if (!html.includes(token)) throw new Error(`Missing placeholder ${token} in shell-template.html`);
    html = html.split(token).join(value);
  }
  if (/\{\{[A-Z_]+\}\}/.test(html)) {
    throw new Error("Unfilled placeholder remains: " + html.match(/\{\{[A-Z_]+\}\}/)[0]);
  }
  return html;
}

const BACKUP_RESTORE_BUTTONS =
`<button class="btn btn-ghost" id="backupBtn">Backup data</button>
        <button class="btn btn-ghost" id="restoreBtn">Restore data</button>
        <input type="file" id="restoreFileInput" accept="application/json" style="display:none;" />`;

const LOCALSTORAGE_ADAPTER_SNIPPET = `
  const STORAGE_KEY = "tuhoeTimesheetStandalone.state.v1";
  const localStorageAdapter = {
    load: () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return Promise.resolve(raw ? JSON.parse(raw) : null);
      } catch (e) { return Promise.resolve(null); }
    },
    save: (data) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        return Promise.resolve(true);
      } catch (e) { return Promise.resolve(false); }
    }
  };`;

// ---------------------------------------------------------------------------
// Target: Electron portable app (electron/app/index.html + app-core.js)
// ---------------------------------------------------------------------------
function buildElectron() {
  const html = fillShell({
    FONT_CSS: "Standalone build: no external font — falls back to system serif/sans so it works fully offline.",
    EYEBROW_SUFFIX: " · Portable app",
    STORAGE_NOTE_BLOCK: `<div style="font-size:12px; color:var(--muted); margin-bottom:14px; max-width:640px;" id="storageNote">Everything is saved right next to this app, works with no internet, and isn't shared with the online version. <strong>Backup data</strong> / <strong>Restore data</strong> are still there as an extra safety copy.</div>`,
    BACKUP_RESTORE_BLOCK: BACKUP_RESTORE_BUTTONS
  });

  const initSnippet = `
<script src="app-core.js"></script>
<script>
(function () {
${LOCALSTORAGE_ADAPTER_SNIPPET}
  // In the portable Electron app, window.timesheetStorage (from preload.js) saves
  // to a JSON file next to the .exe, so the data travels with the app on a USB
  // drive. Opened as a plain HTML file/browser instead, it falls back to localStorage.
  const hasFileStorage = typeof window.timesheetStorage !== "undefined";
  const storage = hasFileStorage
    ? {
        load: () => window.timesheetStorage.load(),
        save: (data) => window.timesheetStorage.save(data),
        registerFlush: (fn) => window.timesheetStorage.onFlushRequest(fn)
      }
    : localStorageAdapter;
  TuhoeTimesheet.init({
    storage: storage,
    storageNote: hasFileStorage ? null : "Opened directly in a browser (not the packaged app) — data is saved only in this browser on this device. Use Backup data / Restore data to move it around."
  });
})();
</script>
</body></html>`;

  const full = html + libsInline + initSnippet + "\n";
  const outDir = path.join(ELECTRON_DIR, "app");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "index.html"), full);
  fs.writeFileSync(path.join(outDir, "app-core.js"), appCoreJs);
  console.log("Built electron/app/index.html + app-core.js");
}

// ---------------------------------------------------------------------------
// Target: standalone offline single-file HTML
// ---------------------------------------------------------------------------
function buildStandalone() {
  const html = fillShell({
    FONT_CSS: "Standalone build: no external font — falls back to system serif/sans so it works fully offline.",
    EYEBROW_SUFFIX: " · Standalone / offline",
    STORAGE_NOTE_BLOCK: "",
    BACKUP_RESTORE_BLOCK: BACKUP_RESTORE_BUTTONS
  });

  const initSnippet = `
<script>
${appCoreJs}
</script>
<script>
(function () {
${LOCALSTORAGE_ADAPTER_SNIPPET}
  TuhoeTimesheet.init({ storage: localStorageAdapter });
})();
</script>
</body></html>`;

  const full = html + libsInline + initSnippet + "\n";
  const outDir = DIST_DIR;
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "tuhoe-timesheet-standalone.html"), full);
  console.log("Built dist/tuhoe-timesheet-standalone.html");
}

// ---------------------------------------------------------------------------
// Target: Claude Artifact (cloud db-backed, CDN libs)
// ---------------------------------------------------------------------------
function buildArtifact() {
  const html = fillShell({
    FONT_CSS: "@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Work+Sans:wght@400;500;600;700&display=swap');",
    EYEBROW_SUFFIX: "",
    STORAGE_NOTE_BLOCK: "",
    BACKUP_RESTORE_BLOCK: ""
  });

  const cdnLibs = `<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"></script>
`;

  const initSnippet = `
<script>
${appCoreJs}
</script>
<script>
(async function () {
  let db = null, downloads = null;
  const dbAdapter = {
    load: async () => {
      if (!db) return null;
      const doc = await db.doc("app/state").get();
      return (doc.exists && Array.isArray(doc.data().periods)) ? doc.data() : null;
    },
    save: async (data) => {
      if (!db) return false;
      await db.doc("app/state").set(data);
      return true;
    }
  };
  const savePdf = async (doc, filename) => {
    const blob = doc.output("blob");
    if (downloads) {
      try { await downloads.save({ filename, data: blob }); return; }
      catch (e) { /* fall through to direct output if the save affordance is unavailable */ }
    }
    doc.save(filename);
  };
  db = await claude.use("db").catch(() => null);
  downloads = await claude.use("downloads").catch(() => null);
  TuhoeTimesheet.init({ storage: dbAdapter, savePdf: savePdf });
})();
</script>
</body></html>`;

  const full = html + cdnLibs + initSnippet + "\n";
  const outDir = DIST_DIR;
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "tuhoe-timesheet-artifact.html"), full);
  console.log("Built dist/tuhoe-timesheet-artifact.html");
}

buildElectron();
buildStandalone();
buildArtifact();
