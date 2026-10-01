import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeSessions,totals,periodRows,readSessions} from '../engine/activity-store.js';
const session={id:'run-1',userId:'phone-1',game:'subway',startedAt:+new Date(2026,8,30,10),updatedAt:10,steps:12,metres:42,kcal:5,seconds:20};
test('reconnect updates do not double-count a session',()=>{
 const rows=mergeSessions([], [session,session,{...session,updatedAt:20,steps:24,complete:true}]);
 assert.equal(rows.length,1);assert.equal(totals(rows).steps,24);assert.equal(totals(rows).runs,1);
});
test('late incomplete snapshots cannot overwrite a finished result',()=>{
 const rows=mergeSessions([{...session,updatedAt:20,complete:true}], [{...session,updatedAt:30,complete:false}]);
 assert.equal(rows[0].complete,true);assert.equal(rows[0].updatedAt,20);
});
test('invalid storage and fields recover safely',()=>{
 assert.deepEqual(readSessions({getItem:()=>'{broken'}),[]);
 const rows=mergeSessions([], [null,{}, {...session,kcal:-3,metres:NaN}]);
 assert.equal(rows.length,1);assert.equal(rows[0].kcal,0);assert.equal(rows[0].metres,0);
});
test('periods use local calendar boundaries; unfinished games retain activity',()=>{
 const rows=mergeSessions([], [session,{...session,id:'older',startedAt:+new Date(2026,8,29,10),complete:true}]);
 const today=periodRows(rows,'D',new Date(2026,8,30,12));assert.equal(today.length,1);assert.equal(totals(today).runs,0);assert.equal(totals(today).steps,12);
 assert.equal(periodRows(rows,'W',new Date(2026,8,30,12)).length,2);
 assert.equal(periodRows(rows,'M',new Date(2026,9,1,12)).length,0);
});
