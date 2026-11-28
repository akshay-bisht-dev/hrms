// Preload (sandboxed, CommonJS): the only bridge between the status window and the main process.
// A narrow API with fixed channel names; the renderer gets no Node.js, no ipcRenderer and no file access.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('agent', {
  getState: () => invoke('agent:get-state'),
  pair: (code, ownership) =>
    invoke('agent:pair', {
      code: String(code),
      ownership: ownership === 'BYOD' ? 'BYOD' : 'COMPANY_MANAGED',
    }),
  acknowledge: (activationId) => invoke('agent:acknowledge', { activationId: String(activationId) }),
  startSession: (workLocationId) => invoke('agent:start-session', { workLocationId: String(workLocationId) }),
  startBreak: () => invoke('agent:start-break'),
  endBreak: () => invoke('agent:end-break'),
  endSession: () => invoke('agent:end-session'),
  signOut: () => invoke('agent:sign-out'),
  onState: (fn) => {
    const listener = (_event, state) => fn(state);
    ipcRenderer.on('agent:state', listener);
    return () => ipcRenderer.removeListener('agent:state', listener);
  },
});
