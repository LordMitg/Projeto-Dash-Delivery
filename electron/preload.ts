import { contextBridge, ipcRenderer } from 'electron';

// Expõe API de impressão de forma segura para o renderer (React)
// Acessível via window.printer.xxx
contextBridge.exposeInMainWorld('printer', {
  printKitchen: (payload: unknown) =>
    ipcRenderer.invoke('print:kitchen', payload),

  printDelivery: (payload: unknown) =>
    ipcRenderer.invoke('print:delivery', payload),

  listPorts: () =>
    ipcRenderer.invoke('printer:list-ports'),

  test: (port: string) =>
    ipcRenderer.invoke('printer:test', port),
});

// Expõe informação do ambiente
contextBridge.exposeInMainWorld('electron', {
  isElectron: true,
  platform: process.platform,
});
