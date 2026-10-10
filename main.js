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
function getDataFilePath() {
  const baseDir = app.isPackaged
    ? (process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath))
    : __dirname;
  return path.join(baseDir, "timesheet-data.json");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// Load order: main file -> .bak (last known-good save) -> nothing (fresh start).
// A main file that exists but can't be read is kept aside, never overwritten.
function loadData() {
  const file = getDataFilePath();
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

function saveData(data) {
  try {
    const file = getDataFilePath();
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
    fs.renameSync(tmp, file); // atomic-ish replace, avoids a half-written file on a crash/power loss
    return true;
  } catch (e) {
    return false;
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
