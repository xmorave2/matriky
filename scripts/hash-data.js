'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, '..', 'data.json');
const outPath  = path.join(__dirname, '..', 'data_hash.txt');

const hash = crypto
  .createHash('sha256')
  .update(fs.readFileSync(dataPath))
  .digest('hex');

fs.writeFileSync(outPath, 'sha256:' + hash);
console.log('data_hash.txt written:', hash.slice(0, 12) + '...');
