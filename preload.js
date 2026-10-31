const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("timesheetStorage", {
  load: () => ipcRenderer.invoke("timesheet:load"),
  // Resolves to a result object when saved (it may say the app had to use its
  // fallback folder); rejects with the real reason if nothing could be written.
  save: async (data) => {
    const r = await ipcRenderer.invoke("timesheet:save", data);
    if (!r || !r.ok) throw new Error((r && r.error ? r.error : "unknown error") + (r && r.path ? "  [" + r.path + "]" : ""));
    return r;
  },
  // Main asks the page to save any pending edit before the window closes;
  // the page's callback runs, then we tell main we're done.
  onFlushRequest: (callback) => {
    ipcRenderer.on("timesheet:flush-request", async () => {
      try { await callback(); } catch (e) { /* closing anyway */ }
      ipcRenderer.send("timesheet:flush-done");
    });
  }
});
