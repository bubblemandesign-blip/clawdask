const { app } = require('electron');
const fs = require('fs');
const log = 'C:\\Users\\bubbl\\.openclaw\\logs\\test_electron.log';
fs.appendFileSync(log, `[${new Date().toISOString()}] App: ${app ? 'Defined' : 'Undefined'}\n`);
if (app) app.quit();
else process.exit(0);
