import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import { join } from 'node:path'
import { IPC_CHANGED, IPC_INVOKE, type ApiMethod, type IpcResult } from '@shared/api'
import { formatHM, formatHMS } from '@shared/timecalc'
import { openDb } from '@core/db'
import { Repo } from '@core/repo'
import { AppService } from '@core/service'
import { SyncQueue } from '@core/booking'
import { createApi, refreshMasterData, trayProjects, youtrackClient, type MainApi } from './api'
import { circlePng } from './icon'
import { DebouncedSaver, readFileOrUndefined, writeAtomic } from './persist'
import { TokenStore } from './token'

const SYNC_INTERVAL_MS = 20_000
const MASTER_DATA_INTERVAL_MS = 60 * 60_000

let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

// German UI: date/time inputs and number formats follow the Chromium locale.
app.commandLine.appendSwitch('lang', 'de-DE')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
  app.whenReady().then(main)
}

function showWindow(): void {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function toggleWindow(): void {
  if (!win) return
  if (win.isVisible() && win.isFocused()) win.hide()
  else showWindow()
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    show: false,
    title: 'TimeToddler',
    autoHideMenuBar: true,
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  w.on('ready-to-show', () => w.show())
  // The window title carries the tracking state; don't let the page <title> overwrite it.
  w.on('page-title-updated', (e) => e.preventDefault())
  // Closing hides to the tray; the timer keeps running.
  w.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      w.hide()
    }
  })
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env['ELECTRON_RENDERER_URL']) void w.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void w.loadFile(join(__dirname, '../renderer/index.html'))
  return w
}

async function main(): Promise<void> {
  const dbPath = process.env['TIMETODDLER_DB'] ?? join(app.getPath('userData'), 'timetoddler.sqlite')
  let notifyTimer: NodeJS.Timeout | null = null
  let updateTray: () => void = () => undefined
  const notify = (): void => {
    if (notifyTimer) return
    notifyTimer = setTimeout(() => {
      notifyTimer = null
      win?.webContents.send(IPC_CHANGED)
      updateTray()
    }, 30)
  }

  const saver = new DebouncedSaver(() => writeAtomic(dbPath, db.export()))
  const db = await openDb({
    data: readFileOrUndefined(dbPath),
    wasmPath: require.resolve('sql.js/dist/sql-wasm.wasm'),
    onChange: () => {
      saver.schedule()
      notify()
    }
  })
  const repo = new Repo(db)
  const svc = new AppService(repo)
  const tokens = new TokenStore(join(app.getPath('userData'), 'youtrack.token'))
  const queue = new SyncQueue(repo, () => youtrackClient(svc, tokens))
  const api: MainApi = createApi({ svc, tokens, queue, window: () => win, toggleWindow, notify })

  ipcMain.handle(IPC_INVOKE, async (_e, method: ApiMethod, args: unknown[]): Promise<IpcResult> => {
    const fn = api[method] as ((...a: unknown[]) => unknown) | undefined
    if (!fn) return { ok: false, error: `Unbekannte Methode ${String(method)}` }
    try {
      return { ok: true, value: await fn(...(args ?? [])) }
    } catch (err) {
      return { ok: false, error: (err as Error).message ?? String(err) }
    }
  })

  const runSync = (): void => {
    void queue
      .runOnce()
      .then(() => queue.pullOnce())
      .finally(notify)
  }
  setInterval(runSync, SYNC_INTERVAL_MS)
  const refresh = (): void => {
    if (youtrackClient(svc, tokens)) refreshMasterData({ svc, tokens }).catch(() => undefined)
  }
  setInterval(refresh, MASTER_DATA_INTERVAL_MS)
  setTimeout(() => {
    runSync()
    refresh()
  }, 2000)

  // ---- tray, taskbar, dock --------------------------------------------------
  const trayImage = (color: string, filled: boolean) =>
    nativeImage.createFromBuffer(circlePng(32, color, filled)).resize({ width: 16, height: 16 })

  function menuTemplate(label: string, forDock: boolean): Electron.MenuItemConstructorOptions[] {
    const st = svc.state()
    const items: Electron.MenuItemConstructorOptions[] = [
      { label, enabled: false },
      { type: 'separator' },
      ...trayProjects(svc).map((p) => ({
        label: p.name,
        type: 'radio' as const,
        checked: st.running?.projectId === p.id,
        click: () => svc.toggle(p.id)
      })),
      { type: 'separator' },
      { label: 'Stopp', enabled: !!st.running, click: () => svc.stop() },
      st.mode === 'absent'
        ? { label: 'Kommen', click: () => svc.come() }
        : { label: st.mode === 'break' ? 'Pause beenden' : 'Pause', click: () => svc.togglePause() },
      { label: 'Gehen', enabled: st.mode !== 'absent', click: () => svc.go() }
    ]
    // The dock menu gets "Quit" from macOS itself.
    if (!forDock) {
      items.push(
        { type: 'separator' },
        { label: 'Fenster öffnen', click: showWindow },
        {
          label: 'Beenden',
          click: () => {
            quitting = true
            app.quit()
          }
        }
      )
    }
    return items
  }

  let indicatorKey = ''
  let badge = ''
  /** Shows the tracking state in tray, window title, Windows taskbar overlay and macOS dock. */
  function updateIndicators(structural: boolean): void {
    const st = svc.state()
    const project = st.running ? svc.repo.getProject(st.running.projectId) : undefined
    const color = st.mode === 'break' ? '#f58231' : (project?.color ?? '#888888')
    const elapsedSec = st.running ? (Date.now() - st.running.start) / 1000 : 0
    const label =
      st.mode === 'running'
        ? `${project?.name ?? ''} ${formatHMS(elapsedSec)}`
        : st.mode === 'break'
          ? 'Pause'
          : st.mode === 'idle'
            ? 'Kein Timer'
            : 'Abwesend'

    const key = `${color}|${st.mode}`
    const changed = key !== indicatorKey
    indicatorKey = key

    if (tray) {
      if (changed) tray.setImage(trayImage(color, st.mode === 'running'))
      tray.setToolTip(`TimeToddler – ${label}`)
      if (process.platform === 'darwin') tray.setTitle(st.mode === 'running' ? formatHMS(elapsedSec) : '')
      if (structural) tray.setContextMenu(Menu.buildFromTemplate(menuTemplate(label, false)))
    }

    // Taskbar entry / window switcher on every platform.
    win?.setTitle(
      st.mode === 'running'
        ? `${project?.name ?? ''} · ${formatHM(elapsedSec)} – TimeToddler`
        : st.mode === 'break'
          ? 'Pause – TimeToddler'
          : 'TimeToddler'
    )

    if (process.platform === 'win32' && win && changed) {
      const active = st.mode === 'running' || st.mode === 'break'
      win.setOverlayIcon(active ? nativeImage.createFromBuffer(circlePng(32, color, true)) : null, active ? label : '')
    }

    if (process.platform === 'darwin' && app.dock) {
      const next = st.mode === 'running' ? formatHM(elapsedSec) : st.mode === 'break' ? 'Pause' : ''
      if (next !== badge) {
        badge = next
        app.dock.setBadge(next)
      }
      if (structural) app.dock.setMenu(Menu.buildFromTemplate(menuTemplate(label, true)))
    }
  }
  updateTray = () => updateIndicators(true)

  tray = new Tray(trayImage('#888888', false))
  tray.on('click', toggleWindow)
  // Running time ticks in tooltip/title/badge; menus are rebuilt on data changes only.
  setInterval(() => {
    if (svc.state().mode === 'running') updateIndicators(false)
  }, process.platform === 'darwin' ? 1000 : 30_000)

  app.on('before-quit', () => {
    quitting = true
    saver.flush()
  })
  app.on('activate', showWindow)
  app.on('window-all-closed', () => {
    /* keep running in the tray */
  })

  win = createWindow()
  win.webContents.on('did-finish-load', () => updateTray())
}
