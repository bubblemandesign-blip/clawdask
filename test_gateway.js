const { spawn } = require('child_process');
const path = require('path');

const bin = 'c:\\Users\\bubbl\\Downloads\\ClawDesk_Final_User_Test\\resources\\app\\node_modules\\openclaw\\bin\\openclaw.js';

console.log('Spawning:', bin);

const p = spawn(process.execPath, [bin, 'gateway'], {
    env: {
        ...process.env,
        NODE_ENV: 'production',
        ELECTRON_RUN_AS_NODE: '1'
    }
});

p.stdout.on('data', d => console.log('OUT:', d.toString()));
p.stderr.on('data', d => console.error('ERR:', d.toString()));
p.on('exit', c => console.log('Exited with code:', c));
