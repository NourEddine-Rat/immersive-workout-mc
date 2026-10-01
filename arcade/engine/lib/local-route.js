// No public, server-reflexive or relay candidates. mDNS names resolve on the LAN.
export function localAddress(value){
  if(typeof value!=='string')return false;
  const address=value.toLowerCase().replace(/^\[|\]$/g,'');
  if(/^[a-z0-9-]+\.local\.?$/.test(address))return true;
  if(/^::ffff:/.test(address))return localAddress(address.slice(7));
  const octets=address.split('.');
  if(octets.length===4&&octets.every(p=>/^\d{1,3}$/.test(p)&&Number(p)<=255)){
    const [a,b]=octets.map(Number);
    return a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===169&&b===254)||a===127;
  }
  if(!/^[0-9a-f:]+(?:%[a-z0-9]+)?$/.test(address))return false;
  return address==='::1'||/^(fc|fd)[0-9a-f]{2}:/.test(address)||/^fe[89ab][0-9a-f]:/.test(address);
}
export function localCandidate(candidate){
  const line=typeof candidate==='string'?candidate:candidate?.candidate;
  if(typeof line!=='string'||line.length>2048)return false;
  const parts=line.replace(/^a=/,'').trim().split(/\s+/),typ=parts.indexOf('typ');
  return parts[0]?.startsWith('candidate:')&&parts[2]?.toLowerCase()==='udp'&&typ>=0&&parts[typ+1]==='host'&&localAddress(parts[4]);
}
export function lanIPv4(address){
  return typeof address==='string'&&/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)&&address.split('.').every(part=>String(Number(part))===part)&&localAddress(address)&&!address.startsWith('127.');
}
export function hintedCandidate(candidate,address){
  if(!lanIPv4(address)||!localCandidate(candidate))return null;
  const line=typeof candidate==='string'?candidate:candidate.candidate;
  const parts=line.replace(/^a=/,'').trim().split(/\s+/);
  if(parts[4]===address)return null;
  // Supplement this socket's address, preserving its port and ICE credentials.
  // The original candidate remains available if the supplied address is stale.
  parts[4]=address;return parts.join(' ');
}
export function localSDP(sdp,addressHint=''){
  if(typeof sdp!=='string'||sdp.length>65536)throw Error('Invalid connection offer');
  return sdp.split(/\r?\n/).filter(line=>!line.startsWith('a=candidate:')||localCandidate(line)).flatMap(line=>{
    const hint=hintedCandidate(line,addressHint);return hint?['a='+hint,line]:[line];
  }).join('\r\n');
}
export function candidateInfo(candidate){
  if(!localCandidate(candidate))return null;
  const line=typeof candidate==='string'?candidate:candidate.candidate;
  const parts=line.replace(/^a=/,'').trim().split(/\s+/);
  return {foundation:parts[0].slice(10),protocol:parts[2].toLowerCase(),address:parts[4],port:Number(parts[5])};
}
export function selectedLocalRoute(report,{localCandidates=[],remoteCandidates=[],peerVerified=false}={}){
  const stats=[...report.values()];
  const transport=stats.find(s=>s.type==='transport'&&s.selectedCandidatePairId);
  // Safari may omit selectedCandidatePairId and retain stale nominated pairs.
  // A succeeded pair marked unwritable is not the route carrying the channel.
  const candidates=stats.filter(s=>s.type==='candidate-pair'&&s.state==='succeeded'&&s.nominated&&s.writable!==false);
  const selected=candidates.filter(s=>s.selected===true||s.writable===true);
  const pair=transport?report.get(transport.selectedCandidatePairId):selected.length===1?selected[0]:candidates.length===1?candidates[0]:null;
  if(!pair||pair.state!=='succeeded')return null;
  const local=report.get(pair.localCandidateId),remote=report.get(pair.remoteCandidateId);
  const reason=(c,known)=>{
    if(!c)return 'candidate-pending';
    if(c.networkType==='vpn')return 'vpn-route';
    if(!['host','prflx'].includes(c.candidateType))return 'nonlocal-type';
    if(c.protocol?.toLowerCase()!=='udp')return 'non-udp-route';
    const address=c.address||c.ip;
    if(address)return localAddress(address)?null:'nonlocal-address';
    // Chrome/Safari may redact IPs in stats. Match the exact selected host candidate
    // to the mDNS/private candidate exchanged for this negotiation, never just its type.
    return c.candidateType==='host'&&known.some(candidate=>String(candidate.foundation)===String(c.foundation)&&candidate.port===Number(c.port)&&candidate.protocol==='udp'&&localAddress(candidate.address))?null:'candidate-hidden';
  };
  const localReason=reason(local,localCandidates),remoteReason=reason(remote,remoteCandidates);
  // When only one side can resolve mDNS, the reverse path is peer-reflexive.
  // Chrome hides that address and gives it a new foundation. The other endpoint
  // must first verify BOTH ends of the selected route and send its proof over
  // this negotiation's encrypted control channel. Match the announced UDP port
  // as well; never accept a missing local proof, unknown port, public or relay path.
  const peerConfirmed=!localReason&&remoteReason==='candidate-hidden'&&remote?.candidateType==='prflx'&&peerVerified&&remoteCandidates.some(c=>c.port===Number(remote.port)&&c.protocol==='udp'&&localAddress(c.address));
  if(peerConfirmed)return {allowed:true,protocol:'udp',localType:local.candidateType,remoteType:remote.candidateType,remoteVerifiedByPeer:true,rttMs:Number.isFinite(pair.currentRoundTripTime)?Math.round(pair.currentRoundTripTime*1000):null};
  if(localReason||remoteReason)return {allowed:false,reason:(localReason?'local-':'remote-')+(localReason||remoteReason),pending:[localReason,remoteReason].filter(Boolean).every(r=>['candidate-pending','candidate-hidden'].includes(r))};
  return {allowed:true,protocol:'udp',localType:local.candidateType,remoteType:remote.candidateType,rttMs:Number.isFinite(pair.currentRoundTripTime)?Math.round(pair.currentRoundTripTime*1000):null};
}
