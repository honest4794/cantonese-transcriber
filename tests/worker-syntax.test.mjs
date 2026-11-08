import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Workers are loaded by the browser rather than imported by Node unit tests.
// Parse their actual entry points so syntax errors cannot hide behind fallback.
for(const name of ['gpu-worker.js','inference-worker.js','segmentation-worker.js'])test(`${name} can be parsed as a classic Worker`,()=>{
 const file=fileURLToPath(new URL('../web/'+name,import.meta.url));
 const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr||result.stdout);
});
