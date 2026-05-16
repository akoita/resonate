const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const {
  isAllowedNavigation,
  loadDesktopConfig,
} = require("./runtime-config.cjs");

const config = loadDesktopConfig();

function openExternalSafely(targetUrl) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return;
  }

  if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) {
    return;
  }

  shell.openExternal(targetUrl);
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    title: "Resonate",
    backgroundColor: "#15111f",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  win.once("ready-to-show", () => {
    win.show();
    if (config.openDevTools) {
      win.webContents.openDevTools({ mode: "detach" });
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedNavigation(url, config)) {
      return { action: "allow" };
    }
    openExternalSafely(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (isAllowedNavigation(url, config)) {
      return;
    }
    event.preventDefault();
    openExternalSafely(url);
  });

  win.webContents.session.on("will-download", (event, item) => {
    const defaultPath = path.join(app.getPath("downloads"), item.getFilename());
    const savePath = dialog.showSaveDialogSync(win, {
      defaultPath,
      buttonLabel: "Save",
    });

    if (!savePath) {
      item.cancel();
      return;
    }
    item.setSavePath(savePath);
  });

  win.loadURL(config.webUrl);
  return win;
}

app.setName("Resonate");

app.whenReady().then(() => {
  ipcMain.handle("resonate-desktop:get-runtime", () => ({
    platform: process.platform,
    version: app.getVersion(),
    webOrigin: config.webOrigin,
  }));

  ipcMain.handle("resonate-desktop:select-audio-files", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Audio",
          extensions: ["aif", "aiff", "flac", "m4a", "mp3", "ogg", "wav"],
        },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    return result.canceled ? [] : result.filePaths;
  });

  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
