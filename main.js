const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

// Portable storage: keep the data file right next to the executable (or next
// to main.js in dev), so the whole app — code + data — travels together on a
// USB drive and works the same on any Windows machine it's plugged into.
function getDataFilePath() {
  const baseDir = app.isPackaged
    ? path.dirname(process.execPath)
    : __dirname;
  return path.join(baseDir, "timesheet-data.json");
}

function loadData() {
  try {
    const file = getDataFilePath();
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function saveData(data) {
  try {
    const file = getDataFilePath();
    const tmp = file + ".tmp";
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
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
