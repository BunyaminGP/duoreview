const { contextBridge, ipcRenderer } = require("electron");

const on = (channel, cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload));

contextBridge.exposeInMainWorld("bridge", {
  pickProject: () => ipcRenderer.invoke("project:pick"),
  setProject: (dir) => ipcRenderer.invoke("project:set", dir),
  resolveTask: (id, decision, note) => ipcRenderer.invoke("task:resolve", { id, decision, note }),
  listModels: () => ipcRenderer.invoke("models:list"),
  talk: () => ipcRenderer.invoke("talk:get"),
  exportTalk: () => ipcRenderer.invoke("talk:export"),
  setLang: (code) => ipcRenderer.invoke("lang:set", code),
  resetBoard: () => ipcRenderer.invoke("board:reset"),
  saveCfg: (cfg) => ipcRenderer.send("cfg:save", cfg),
  start: (agent, cols, rows) => ipcRenderer.send("pty:start", { agent, cols, rows }),
  write: (agent, data) => ipcRenderer.send("pty:write", { agent, data }),
  resize: (agent, cols, rows) => ipcRenderer.send("pty:resize", { agent, cols, rows }),
  kill: (agent) => ipcRenderer.send("pty:kill", { agent }),
  startTeam: (payload) => ipcRenderer.send("team:start", payload),
  onData: (cb) => on("pty:data", cb),
  onExit: (cb) => on("pty:exit", cb),
  onState: (cb) => on("state", cb),
  onBoard: (cb) => on("board", cb),
});
