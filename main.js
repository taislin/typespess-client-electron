const { app, BrowserWindow } = require('electron');
//electron stuff
let win;
function createWindow() {
    win = new BrowserWindow({
        width: 1280,
        height: 720,
        webPreferences: { nodeIntegration: true }
    });
    win.loadFile(`${__dirname}/index.html`)
    win.on('closed', function () { win = null; });
}
app.on('ready', createWindow);
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
app.on('activate', function () {
    if (win === null) {
        createWindow();
    }
});
//end of electron stuff