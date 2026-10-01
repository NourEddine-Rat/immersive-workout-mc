// Presentation only: automatic WebRTC retries must not restart the user's notice.
// A failure stays helpful until the link recovers or the user chooses a new screen.
export class ConnectionNotice {
  constructor(){this.reset();}
  reset(){this.connectedBefore=false;this.since=null;this.help=false;}
  update({connected=false,pending=false,failed=false},now=Date.now()){
    if(connected){this.connectedBefore=true;this.since=null;this.help=false;return {state:'connected',visible:false,retry:false};}
    if(!pending&&!this.connectedBefore)return {state:'waiting',visible:false,retry:false};
    this.since??=now;
    this.help ||= failed||now-this.since>=10000;
    return {
      state:this.connectedBefore?'reconnecting':this.help?'help':'connecting',
      visible:now-this.since>=1500,
      retry:this.help||this.connectedBefore
    };
  }
}
