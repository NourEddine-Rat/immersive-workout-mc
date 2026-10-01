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
export function localSDP(sdp){
  if(typeof sdp!=='string'||sdp.length>65536)throw Error('Invalid connection offer');
  return sdp.split(/\r?\n/).filter(line=>!line.startsWith('a=candidate:')||localCandidate(line)).join('\r\n');
}
export function candidateInfo(candidate){
  if(!localCandidate(candidate))return null;
  const line=typeof candidate==='string'?candidate:candidate.candidate;
  const parts=line.replace(/^a=/,'').trim().split(/\s+/);
  return {foundation:parts[0].slice(10),protocol:parts[2].toLowerCase(),address:parts[4],port:Number(parts[5])};
}
export function selectedLocalRoute(report,{localCandidates=[],remoteCandidates=[]}={}){
  const stats=[...report.values()];
  const transport=stats.find(s=>s.type==='transport'&&s.selectedCandidatePairId);
  const pair=transport?report.get(transport.selectedCandidatePairId):stats.find(s=>s.type==='candidate-pair'&&s.state==='succeeded'&&s.nominated);
  if(!pair||pair.state!=='succeeded')return null;
  const local=report.get(pair.localCandidateId),remote=report.get(pair.remoteCandidateId);
  const valid=(c,known)=>{
    if(!c||c.networkType==='vpn'||!['host','prflx'].includes(c.candidateType)||c.protocol?.toLowerCase()!=='udp')return false;
    const address=c.address||c.ip;
    if(address)return localAddress(address);
    // Chrome/Safari may redact IPs in stats. Match the exact selected host candidate
    // to the mDNS/private candidate exchanged for this negotiation, never just its type.
    return c.candidateType==='host'&&known.some(candidate=>candidate.foundation===c.foundation&&candidate.port===c.port&&candidate.protocol==='udp'&&localAddress(candidate.address));
  };
  if(!valid(local,localCandidates)||!valid(remote,remoteCandidates))return {allowed:false};
  return {allowed:true,protocol:'udp',localType:local.candidateType,remoteType:remote.candidateType,rttMs:Number.isFinite(pair.currentRoundTripTime)?Math.round(pair.currentRoundTripTime*1000):null};
}
