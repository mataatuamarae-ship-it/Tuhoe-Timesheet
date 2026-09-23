const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("timesheetStorage", {
  load: () => ipcRenderer.invoke("timesheet:load"),
  save: (data) => ipcRenderer.invoke("timesheet:save", data)
});
