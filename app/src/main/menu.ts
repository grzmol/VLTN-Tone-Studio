import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from "electron";
import type { AppEvent, MenuCommand } from "@shared/ipc";
import { sendTo } from "./ipc/handle";

export function buildMenu(getWindow: () => BrowserWindow | null): void {
  const send = (command: MenuCommand) => () => sendTo(getWindow, "app:event", { type: "menu", command } satisfies AppEvent);
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: "VLTN Tone Studio",
            submenu: [
              { label: "About VLTN Tone Studio", click: send("about") },
              { label: "Check for updates…", click: send("check-updates") },
              { type: "separator" as const },
              { label: "Settings…", accelerator: "Cmd+,", click: send("settings") },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        { label: "Import presets…", accelerator: "CmdOrCtrl+O", click: send("import-presets") },
        { label: "Export preset…", accelerator: "CmdOrCtrl+E", click: send("export-preset") },
        { type: "separator" },
        { label: "Back up pedal", accelerator: "Shift+CmdOrCtrl+B", click: send("backup-pedal") },
        { label: "Open backups folder", click: send("open-backups-folder") },
        ...(isMac ? [] : [{ type: "separator" as const }, { label: "Settings", accelerator: "CmdOrCtrl+,", click: send("settings") }, { type: "separator" as const }, { role: "quit" as const }]),
      ],
    },
    {
      label: "Edit",
      submenu: [
        { label: "Undo", accelerator: "CmdOrCtrl+Z", click: send("undo") },
        { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", click: send("redo") },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        { type: "separator" },
        { label: "Copy block settings", accelerator: "Alt+CmdOrCtrl+C", click: send("copy-block") },
        { label: "Paste block settings", accelerator: "Alt+CmdOrCtrl+V", click: send("paste-block") },
      ],
    },
    {
      label: "Device",
      submenu: [
        { label: "Reconnect", accelerator: "CmdOrCtrl+R", click: send("reconnect") },
        { label: "Save to slot", accelerator: "CmdOrCtrl+S", click: send("save-to-slot") },
        { label: "Compare with saved", accelerator: "CmdOrCtrl+D", click: send("compare-with-saved") },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Rig", accelerator: "Shift+CmdOrCtrl+1", click: send("go-rig") },
        { label: "Library", accelerator: "Shift+CmdOrCtrl+2", click: send("go-library") },
        { label: "Tones", accelerator: "Shift+CmdOrCtrl+3", click: send("go-tones") },
        { label: "Device", accelerator: "Shift+CmdOrCtrl+4", click: send("go-device") },
        { label: "Song", accelerator: "Shift+CmdOrCtrl+5", click: send("go-song") },
        { type: "separator" },
        { label: "Command palette", accelerator: "CmdOrCtrl+K", click: send("command-palette") },
        { type: "separator" },
        { role: "toggleDevTools" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        { label: "Diagnostics report", click: send("diagnostics-report") },
        ...(isMac ? [] : [{ label: "Check for updates…", click: send("check-updates") }]),
        { label: "What's new", click: send("whats-new") },
        { label: "About VLTN Tone Studio", click: send("about") },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
