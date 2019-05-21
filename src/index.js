
const {
    app,
    BrowserWindow,
    Menu,
    clipboard,
    shell,
    remote
} = require('electron');

const path = require('path');

let mainApp = require('./express');

const userPath = (app || remote.app).getPath('userData');

let win

function createWindow() {
    win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: false
        },
        icon: __dirname + '/icon.ico'
    });
    win.loadURL('http://localhost:3001/');
    win.toggleDevTools();
    win.on('closed', () => {
        win = null
    })
    win.webContents.on('new-window', function(e, url) {
        e.preventDefault();
        require('electron').shell.openExternal(url);
    });
    const menu = Menu.buildFromTemplate([{
        label: 'File',
        submenu: [
            {
                label: 'Copy View URL',
                role: 'copyurl',
                click: () => {
                    clipboard.writeText("http://localhost:3001/view");
                }
            },
            {
                label: 'Open Macros Folder',
                role: 'copyurl',
                click: () => {
                    shell.openItem(path.join(userPath, 'macros'))
                }
            },
            {
                label: 'Open Modules Folder',
                role: 'copyurl',
                click: () => {
                    shell.openItem(path.join(userPath, 'modules'))
                }
            },
            {
                label: 'Reload',
                accelerator: 'CmdOrCtrl+R',
                click (item, focusedWindow) {
                  if (focusedWindow) focusedWindow.reload()
                }
            },{
                label: 'Toggle Dev Tools',
                click (item, focusedWindow) {
                  if (focusedWindow) focusedWindow.toggleDevTools()
                }
            },
        ]
    },{
        label: 'Settings',
        submenu: [
            {
                label: 'Toggle Dark mode',
                role: 'dark',
                click: () => {
                    mainApp.toggleDarkMode();
                }
            },
            {
                label: 'Toggle Edit mode',
                role: 'edit',
                click: () => {
                    mainApp.toggleEditMode();
                }
            },
            {
                label: 'Settings Menu',
                role: 'settings',
                click: () => {
                    mainApp.toggleSettingsMenu();
                }
            }
        ]
    }])
    Menu.setApplicationMenu(menu)
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        mainApp.save();
        app.quit()
    }
})

app.on('activate', () => {
    if (win === null) {
        createWindow()
    }
})
