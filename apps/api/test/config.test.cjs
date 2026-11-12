const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readConfig}=require('../dist/config.js');
test('rejects missing database configuration',()=>assert.throws(()=>readConfig({}),/DATABASE_URL/));
test('rejects invalid environment and port',()=>{
 assert.throws(()=>readConfig({APP_ENV:'prod'}),/APP_ENV/);
 assert.throws(()=>readConfig({DATABASE_URL:'postgresql://localhost/test',PORT:'NaN'}),/PORT/);
});
