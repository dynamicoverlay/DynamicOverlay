const {
    app,
    BrowserWindow,
    Menu
} = require('electron');

let mainApp = require('./express');

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
    win.loadURL('http://localhost:3000/');
    win.on('closed', () => {
        win = null
    })
    const menu = Menu.buildFromTemplate([{
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
                label: 'Reload',
                accelerator: 'CmdOrCtrl+R',
                click (item, focusedWindow) {
                  if (focusedWindow) focusedWindow.reload()
                }
            },
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