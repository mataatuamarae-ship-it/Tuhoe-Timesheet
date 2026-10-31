const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

// Portable storage: keep the data file right next to the executable (or next
// to main.js in dev), so the whole app — code + data — travels together on a
// USB drive and works the same on any Windows machine it's plugged into.
// The single-file portable .exe unpacks itself into a temp folder at launch, so
// process.execPath points there. electron-builder exposes the folder the .exe
// really lives in as PORTABLE_EXECUTABLE_DIR (set only by the portable build);
// the zip and installer builds don't set it and fall back to the exe's folder.
const DATA_NAME = "timesheet-data.json";

function primaryDir() {
  return app.isPackaged
    ? (process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath))
    : __dirname;
}
// Used only if the folder next to the .exe can't be written to (protected
// folder, read-only drive, antivirus/"Controlled folder access" blocking it).
function fallbackDir() {
  return app.getPath("userData");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// Load order within a folder: main file -> .bak (last known-good save) -> nothing.
// A main file that exists but can't be read is kept aside, never overwritten.
function loadFromDir(dir) {
  const file = path.join(dir, DATA_NAME);
  const bak = file + ".bak";
  try {
    if (!fs.existsSync(file)) return null;
    return readJson(file);
  } catch (e) {
    try {
      fs.renameSync(file, file.replace(/\.json$/, "") + ".corrupt-" + Date.now() + ".json");
    } catch (e2) { /* keep going; the .bak is what matters */ }
    try {
      if (fs.existsSync(bak)) return readJson(bak);
    } catch (e3) { /* .bak unreadable too */ }
    return null;
  }
}

// If data exists in both places (e.g. saved to the fallback while the app
// folder was blocked, later unblocked), use the most recently saved one.
function loadData() {
  const found = [primaryDir(), fallbackDir()]
    .map(loadFromDir)
    .filter(Boolean);
  if (!found.length) return null;
  found.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return found[0];
}

function sleepMs(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (e) { /* ignore */ }
}

function writeAtomic(dir, data) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, DATA_NAME);
  const tmp = file + ".tmp";
  // Keep the previous save as .bak, but only if it is itself valid JSON,
  // so the .bak is always a good copy.
  try {
    if (fs.existsSync(file)) {
      readJson(file);
      fs.copyFileSync(file, file + ".bak");
    }
  } catch (e) { /* existing file unreadable: leave the old .bak alone */ }
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  // Replacing a file can briefly fail on Windows while antivirus/indexing has
  // the new file open, so retry a few times, then fall back to writing directly.
  let lastErr = null;
  for (let i = 0; i < 6; i++) {
    try { fs.renameSync(tmp, file); return file; }
    catch (e) { lastErr = e; sleepMs(60 * (i + 1)); }
  }
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
    try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
    return file;
  } catch (e) {
    throw lastErr || e;
  }
}

function describe(e) {
  return (e && (e.code ? e.code + ": " : "") + (e.message || e)) || "unknown error";
}

// Returns { ok, path, fellBack?, error? } so the page can say what happened.
function saveData(data) {
  let primaryErr = null;
  try {
    const file = writeAtomic(primaryDir(), data);
    return { ok: true, path: file };
  } catch (e) {
    primaryErr = e;
  }
  try {
    const file = writeAtomic(fallbackDir(), data);
    return {
      ok: true, path: file, fellBack: true,
      error: "Couldn't write next to the app (" + describe(primaryErr) + ")"
    };
  } catch (e2) {
    return {
      ok: false, path: path.join(primaryDir(), DATA_NAME),
      error: describe(primaryErr) + " | fallback: " + describe(e2)
    };
  }
}

ipcMain.handle("timesheet:load", () => loadData());
ipcMain.handle("timesheet:save", (event, data) => saveData(data));

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    icon: path.join(__dirname, app.isPackaged ? "icon.ico" : "icon.ico"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, "app", "index.html"));

  // Save-on-close: ask the page to flush any edit still waiting on its 600ms
  // debounce, then close. A 2s timeout guarantees the window can never hang.
  let flushed = false;
  win.on("close", (event) => {
    if (flushed) return;
    event.preventDefault();
    flushed = true;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      ipcMain.removeListener("timesheet:flush-done", onDone);
      if (!win.isDestroyed()) win.close();
    };
    const onDone = (e) => { if (e.sender === win.webContents) finish(); };
    ipcMain.on("timesheet:flush-done", onDone);
    setTimeout(finish, 2000);
    try { win.webContents.send("timesheet:flush-request"); } catch (e) { finish(); }
  });
}

// Single instance: two copies sharing one data file would silently overwrite
// each other's edits, so a second launch just brings the running window forward.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
