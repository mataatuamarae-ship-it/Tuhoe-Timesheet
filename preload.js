const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("timesheetStorage", {
  load: () => ipcRenderer.invoke("timesheet:load"),
  save: (data) => ipcRenderer.invoke("timesheet:save", data),
  // Main asks the page to save any pending edit before the window closes;
  // the page's callback runs, then we tell main we're done.
  onFlushRequest: (callback) => {
    ipcRenderer.on("timesheet:flush-request", async () => {
      try { await callback(); } catch (e) { /* closing anyway */ }
      ipcRenderer.send("timesheet:flush-done");
    });
  }
});
