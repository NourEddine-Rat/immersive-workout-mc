import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('signaling schema strips extra data and cannot carry a gameplay message',()=>{
 const script=`import serve,json
base={'t':'rtc-signal','hostId':'h','clientId':'p','peerId':'secret','negotiationId':'n','kind':'offer','description':{'type':'offer','sdp':'v=0\\r\\n'},'rows':[[1,2,3]],'profile':{'name':'private'}}
safe=serve.rtc_message(base)
assert 'rows' not in safe and 'profile' not in safe
for kind in ['samples','host-state','phone-profile','session-history','host-action']:
 assert serve.rtc_message({**base,'kind':kind}) is None
assert serve.rtc_message({**base,'description':{'type':'offer','sdp':'not SDP'}}) is None
print('ok')`;
 const result=spawnSync('python3',['-c',script],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/ok/);
});
