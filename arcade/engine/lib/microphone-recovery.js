const COPY = {
  idle: ['Allow microphone briefly to help this PC discover your phone. Nothing is recorded or sent, and access stops immediately.', 'Allow microphone to help connect'],
  requesting: ['Choose Allow in the browser’s microphone prompt. Access will stop immediately after the browser grants it.', 'Waiting for microphone permission…'],
  granted: ['Microphone access has stopped. Trying the local connection again.', 'Try local connection again'],
  denied: ['Microphone access was not allowed. Check this site’s microphone permission and your system settings, then try again.', 'Try microphone access again'],
  unavailable: ['Microphone access is unavailable in this browser.', 'Microphone unavailable'],
  error: ['The microphone could not start. Check its permissions and try again.', 'Try microphone access again'],
};

function failure(error) {
  switch (error?.name) {
    case 'NotAllowedError': case 'PermissionDeniedError':
      return {state: 'denied', reason: 'denied', errorName: error.name};
    case 'NotFoundError': case 'DevicesNotFoundError':
      return {state: 'unavailable', reason: 'no-device', errorName: error.name,
        message: 'No microphone was found on this PC. Connect or enable a microphone, then try again.', buttonLabel: 'Check microphone again'};
    case 'NotReadableError': case 'TrackStartError':
      return {state: 'error', reason: 'not-readable', errorName: error.name,
        message: 'The microphone could not start. Check system microphone access or close another app using it, then try again.'};
    case 'AbortError': case 'InvalidStateError':
      return {state: 'error', reason: 'interrupted', errorName: error.name,
        message: 'The microphone request was interrupted. Return to this tab and try again.'};
    case 'SecurityError': case 'NotSupportedError':
      return {state: 'unavailable', reason: 'blocked', errorName: error.name,
        message: 'This browser has blocked microphone access. Check its site permissions, then try again.', buttonLabel: 'Check microphone again'};
    default:
      // Browser error messages can contain device information. Never log them.
      return {state: 'error', reason: 'unknown', errorName: 'Error'};
  }
}

/**
 * An explicit, PC-side discovery recovery action. It never adds media to a
 * peer connection. Merely constructing this controller does not request access.
 * Dependencies are injectable so lifecycle/privacy checks need no real device.
 */
export function createMicrophoneRecovery({
  onChange = () => {},
  onRetry = () => {},
  navigator: browserNavigator = globalThis.navigator,
  eventTarget = globalThis.window,
  secure = globalThis.isSecureContext,
  diagnostics = globalThis.ConnectionDiagnostics,
} = {}) {
  let state = 'idle', message = COPY.idle[0], buttonLabel = COPY.idle[1];
  let available = true, granted = false, operation = null, destroyed = false;

  const record = (event, data) => {
    try { diagnostics?.record(event, data); } catch {}
  };
  const snapshot = () => Object.freeze({state, message, buttonLabel, pending: !!operation, available, granted});
  const publish = (nextState, nextMessage, nextLabel) => {
    state = nextState;
    message = nextMessage || COPY[state][0];
    buttonLabel = nextLabel || COPY[state][1];
    if (!destroyed) onChange(snapshot());
  };
  const unsupported = () => {
    if (secure !== true) return 'Microphone recovery needs a secure HTTPS page. Open the secure site on this PC and try again.';
    if (typeof browserNavigator?.mediaDevices?.getUserMedia !== 'function') return 'This browser does not support microphone recovery. Try a current browser on this PC.';
    return '';
  };
  const initialError = unsupported();
  if (initialError) {
    state = 'unavailable'; message = initialError; buttonLabel = COPY.unavailable[1]; available = false;
  }

  function cancel() {
    if (destroyed || !operation || operation.cancelled) return;
    operation.cancelled = true;
    record('microphone-cancelled', {stage: 'permission'});
    // getUserMedia has no AbortSignal. Keep the button disabled until its
    // browser prompt settles, then release any stream that arrives late.
    publish('idle', 'Microphone recovery was cancelled. Close the browser prompt if it is still open.');
  }

  function request() {
    if (destroyed) return Promise.resolve(snapshot());
    if (operation) return operation.promise;
    const unavailableMessage = unsupported();
    if (unavailableMessage) {
      available = false;
      publish('unavailable', unavailableMessage);
      record('microphone-failed', {reason: secure !== true ? 'insecure' : 'unsupported', secure: secure === true});
      return Promise.resolve(snapshot());
    }
    available = true;
    granted = false;
    const current = {cancelled: false, promise: null};
    operation = current;
    publish('requesting');
    record('microphone-request', {stage: 'permission'});

    // Call getUserMedia synchronously from the user's click; do not await a
    // permission query first or let normal connection retries call this API.
    let mediaPromise;
    try { mediaPromise = browserNavigator.mediaDevices.getUserMedia({audio: true, video: false}); }
    catch (error) { mediaPromise = Promise.reject(error); }

    current.promise = (async () => {
      let stream, error, stopped = true;
      try { stream = await mediaPromise; }
      catch (caught) { error = caught; }
      finally {
        if (stream) {
          // Release every track before publishing success or retrying ICE,
          // including streams returned after navigation or cancellation.
          try {
            for (const track of stream.getTracks()) {
              try { track.stop(); } catch { stopped = false; }
            }
          } catch { stopped = false; }
        }
      }
      if (operation === current) operation = null;
      if (destroyed) return snapshot();
      if (current.cancelled) { publish('idle'); return snapshot(); }
      if (!stopped) {
        publish('error', 'Microphone access could not be closed cleanly. Reload this page before trying again.');
        record('microphone-failed', {reason: 'stop-failed'});
        return snapshot();
      }
      if (error || !stream) {
        const result = failure(error);
        publish(result.state, result.message, result.buttonLabel);
        record('microphone-failed', {reason: result.reason, errorName: result.errorName});
        return snapshot();
      }
      granted = true;
      publish('granted');
      record('microphone-granted', {granted: true, clean: true});
      if (!destroyed && !current.cancelled) onRetry();
      return snapshot();
    })();
    return current.promise;
  }

  const onPageHide = () => cancel();
  eventTarget?.addEventListener('pagehide', onPageHide);
  return {
    get snapshot() { return snapshot(); },
    request,
    cancel,
    destroy() {
      if (destroyed) return;
      cancel();
      destroyed = true;
      eventTarget?.removeEventListener('pagehide', onPageHide);
    },
  };
}
