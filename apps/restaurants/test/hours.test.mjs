import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isOpen,availability} from '../dist/hours.js';
import {profile} from '../dist/validation.js';
const date=s=>new Date(s);
test('overnight hours include the previous day and exclude the closing minute',()=>{
  const hours=[{day:1,open:1320,close:120}];
  assert.equal(isOpen(hours,'UTC',date('2026-11-02T21:59:59Z')),false);
  assert.equal(isOpen(hours,'UTC',date('2026-11-02T22:00:00Z')),true);
  assert.equal(isOpen(hours,'UTC',date('2026-11-03T01:59:59Z')),true);
  assert.equal(isOpen(hours,'UTC',date('2026-11-03T02:00:00Z')),false);
});
test('Saturday overnight wraps into Sunday and 24-hour intervals are explicit',()=>{
  assert.equal(isOpen([{day:6,open:1320,close:120}],'UTC',date('2026-11-01T01:00:00Z')),true);
  assert.equal(isOpen([{day:0,open:0,close:1440}],'UTC',date('2026-11-01T23:59:00Z')),true);
  assert.equal(isOpen([{day:0,open:0,close:1440}],'UTC',date('2026-11-02T00:00:00Z')),false);
});
test('timezone and DST use local wall-clock hours rather than server time',()=>{
  const hours=[{day:0,open:60,close:120}];
  assert.equal(isOpen(hours,'America/New_York',date('2026-11-01T05:30:00Z')),true);
  assert.equal(isOpen(hours,'America/New_York',date('2026-11-01T06:30:00Z')),true);
  assert.equal(isOpen(hours,'America/New_York',date('2026-11-01T07:00:00Z')),false);
  assert.equal(isOpen([{day:0,open:120,close:180}],'America/New_York',date('2026-03-08T07:00:00Z')),false);
});
test('approval, active status and closure override hours; closure expires exactly at deadline',()=>{
  const row={status:'APPROVED',active:true,temporaryClosedUntil:null,hours:[{day:1,open:0,close:1440}],timezone:'UTC'};
  const at=date('2026-11-02T12:00:00Z');assert.equal(availability(row,at).eligible,true);
  for(const status of ['PENDING','SUSPENDED'])assert.equal(availability({...row,status},at).eligible,false);
  assert.equal(availability({...row,active:false},at).eligible,false);
  assert.equal(availability({...row,temporaryClosedUntil:date('2026-11-02T12:01:00Z')},at).eligible,false);
  assert.equal(availability({...row,temporaryClosedUntil:at},at).eligible,true);
});
test('profile validation rejects escalation, invalid coordinates/timezones and overlapping hours',()=>{
  const data={name:'Fixture',address:'Test address',latitude:25,longitude:51,timezone:'UTC',active:true,hours:[]};
  assert.throws(()=>profile({...data,status:'APPROVED'}));
  assert.throws(()=>profile({...data,latitude:91}));
  assert.throws(()=>profile({...data,timezone:'Invalid/Zone'}));
  assert.throws(()=>profile({...data,hours:[{day:1,open:60,close:60}]}));
  assert.throws(()=>profile({...data,hours:[{day:6,open:1320,close:120},{day:0,open:60,close:180}]}));
  assert.throws(()=>profile({...data,temporaryClosedUntil:'2026-11-03T12:00:00'}));
});
