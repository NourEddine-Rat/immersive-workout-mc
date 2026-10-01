import test from 'node:test';
import assert from 'node:assert/strict';
import {localAddress,localCandidate,localSDP,selectedLocalRoute,candidateInfo,lanIPv4,hintedCandidate} from '../engine/lib/local-route.js';
import {BATCH} from '../engine/lib/protocol.js';
const candidate=(address='192.168.1.5',type='host',protocol='udp')=>`candidate:123 1 ${protocol} 2113937151 ${address} 5000 typ ${type}`;
const report=(local={},remote={})=>new Map([
 ['transport',{type:'transport',selectedCandidatePairId:'pair'}],
 ['pair',{type:'candidate-pair',state:'succeeded',nominated:true,localCandidateId:'a',remoteCandidateId:'b',currentRoundTripTime:.003}],
 ['a',{candidateType:'host',protocol:'udp',address:'192.168.1.5',foundation:'123',port:5000,...local}],
 ['b',{candidateType:'host',protocol:'udp',address:'192.168.1.6',foundation:'456',port:5001,...remote}]
]);
test('a PC address hint only supplements private host UDP routes and preserves the original candidate',()=>{
 const original=candidate('pc.local');
 for(const address of ['192.168.1.20','10.0.0.2','172.18.0.2']){
  assert.equal(lanIPv4(address),true);
  assert.equal(hintedCandidate(original,address),candidate(address));
  const sdp=localSDP('v=0\r\na='+original+'\r\n',address);
  assert.ok(sdp.includes('a='+candidate(address)));assert.ok(sdp.includes('a='+original));
 }
 for(const address of ['8.8.8.8','127.0.0.1','pc.local','010.0.0.2','192.168.999.2','192.168.1.20\r\na=bad',''])assert.equal(hintedCandidate(original,address),null);
 assert.equal(hintedCandidate(candidate('8.8.8.8'),'192.168.1.20'),null);
 assert.equal(hintedCandidate(candidate('pc.local','relay'),'192.168.1.20'),null);
});
test('only private/link-local/loopback/mDNS addresses and host UDP candidates are offered',()=>{
 for(const ip of ['192.168.1.5','10.2.3.4','172.16.0.1','172.31.255.255','169.254.0.1','fd12::1','fe80::1234','127.0.0.1','peer-123.local'])assert.equal(localAddress(ip),true,ip);
 for(const ip of ['8.8.8.8','172.32.0.1','100.64.0.1','2001:4860::1','peer.local.evil','192.168.999.2','fe80:invalid'])assert.equal(localAddress(ip),false,ip);
 assert.equal(localCandidate(candidate()),true);
 for(const c of [candidate('8.8.8.8'),candidate('192.168.1.5','relay'),candidate('192.168.1.5','srflx'),candidate('192.168.1.5','host','tcp')])assert.equal(localCandidate(c),false,c);
 const sdp=localSDP('v=0\r\na='+candidate()+'\r\na='+candidate('8.8.8.8')+'\r\n');assert.match(sdp,/192\.168/);assert.doesNotMatch(sdp,/8\.8\.8\.8/);
 assert.equal(BATCH,1,'motion must not wait for a batch');
});
test('selected route rejects relay, public, VPN, unknown and unverifiable redacted candidates',()=>{
 assert.equal(selectedLocalRoute(report()).allowed,true);
 for(const bad of [{candidateType:'relay'},{candidateType:'srflx'},{protocol:'tcp'},{address:'8.8.8.8'},{networkType:'vpn'},{address:''}])assert.equal(selectedLocalRoute(report(bad)).allowed,false);
 assert.equal(selectedLocalRoute(new Map()),null);
});
test('privacy-redacted stats require an exact selected-candidate match from this negotiation',()=>{
 const known={localCandidates:[candidateInfo(candidate('local-123.local'))],remoteCandidates:[candidateInfo('candidate:456 1 udp 2113937151 remote-456.local 5001 typ host')]};
 assert.equal(selectedLocalRoute(report({address:''},{address:''}),known).allowed,true);
 assert.equal(selectedLocalRoute(report({address:'',port:9999},{address:''}),known).allowed,false);
 assert.equal(selectedLocalRoute(report({address:'8.8.8.8'},{address:''}),known).allowed,false);
});

test('a redacted reverse path needs verified peer proof and an exact announced UDP port',()=>{
 const remote={address:'',candidateType:'prflx',foundation:'new-foundation'};
 const known={localCandidates:[],remoteCandidates:[candidateInfo('candidate:456 1 udp 2113937151 phone.local 5001 typ host')]};
 assert.equal(selectedLocalRoute(report({},remote),known).allowed,false);
 known.peerVerified=true;
 assert.equal(selectedLocalRoute(report({},remote),known).allowed,true);
 for(const invalid of [{...remote,port:1234},{...remote,protocol:'tcp'},{...remote,networkType:'vpn'},{...remote,address:'8.8.8.8'},{...remote,candidateType:'relay'},{...remote,candidateType:'host'}])assert.equal(selectedLocalRoute(report({},invalid),known).allowed,false);
 assert.equal(selectedLocalRoute(report({address:''},remote),known).allowed,false,'the local side must still be independently verified');
 assert.equal(selectedLocalRoute(report({},remote),{peerVerified:true}).allowed,false,'unannounced candidates cannot use peer proof');
});

test('Safari fallback ignores an old nominated pair that is no longer writable',()=>{
 const stats=report();stats.delete('transport');
 const current={...stats.get('pair'),writable:true};
 stats.set('stale-remote',{candidateType:'prflx',protocol:'udp',address:'',port:9000});
 const stale={...current,writable:false,remoteCandidateId:'stale-remote'};
 const reordered=new Map([['stale-pair',stale],...stats]);reordered.set('pair',current);
 assert.equal(selectedLocalRoute(reordered).allowed,true);
 // An explicit selected route always wins, even if an unused route looks safe.
 reordered.set('transport',{type:'transport',selectedCandidatePairId:'stale-pair'});
 assert.equal(selectedLocalRoute(reordered).allowed,false);
});

test('redacted candidate matching tolerates numeric fields encoded as strings but never a different port',()=>{
 const known={localCandidates:[candidateInfo(candidate('local-123.local'))]};
 assert.equal(selectedLocalRoute(report({address:'',foundation:123,port:'5000'}),known).allowed,true);
 assert.equal(selectedLocalRoute(report({address:'',foundation:123,port:'5002'}),known).allowed,false);
});
