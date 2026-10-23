import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANGED, IPC_INVOKE, type ApiMethod, type IpcResult } from '@shared/api'

const bridge = {
  async invoke(method: ApiMethod, ...args: unknown[]): Promise<unknown> {
    const res = (await ipcRenderer.invoke(IPC_INVOKE, method, args)) as IpcResult
    if (!res.ok) throw new Error(res.error)
    return res.value
  },
  onChanged(cb: () => void): () => void {
    const listener = (): void => cb()
    ipcRenderer.on(IPC_CHANGED, listener)
    return () => ipcRenderer.removeListener(IPC_CHANGED, listener)
  }
}

export type Bridge = typeof bridge

contextBridge.exposeInMainWorld('tt', bridge)
