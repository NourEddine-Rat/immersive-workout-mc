export function connectionExplanation(state={}){
  if(state.direct)return 'Connected directly over local Wi-Fi.';
  if((state.localStatus||state.status)==='signaling')return 'The pairing server is reconnecting. Check internet access on both devices.';
  if((state.localStatus||state.status)==='unsupported')return state.message;
  switch(state.stage){
    case 'pairing':return 'Waiting for the PC to accept this phone. Keep the PC game page open.';
    case 'waiting-offer':return 'Phone paired. Waiting for the PC to start the local connection.';
    case 'waiting-answer':return 'PC offer sent. Waiting for the phone to answer. Keep Play open on the phone.';
    case 'local-discovery':return 'Both devices exchanged connection details, but local Wi-Fi is not connected yet. Allow Local Network access on both devices. Try the PC Wi-Fi address in Connection help if discovery fails.';
    case 'route-verification':return 'The devices reached each other. Checking that their selected connection stays local.';
    case 'peer-verification':return 'Local route checked. Waiting for the other device to confirm its route.';
    case 'opening-channels':return 'Local route confirmed. Opening the motion and controls channels.';
    default:return state.message||'Preparing the local connection.';
  }
}
