// Normal app startup; independent of the removed design lab.
const app = window.PhoneApp;
function storageWarning() {
  if (document.getElementById('phoneStorageWarning')) return;
  const note = document.createElement('div');
  note.id = 'phoneStorageWarning'; note.className = 'phone-storage-warning';
  note.setAttribute('role','status');
  const copy = document.createElement('span');
  copy.textContent = 'Storage is unavailable. You can play, but your setup and activity won’t be saved after a reload.';
  const dismiss = document.createElement('button');
  dismiss.type = 'button'; dismiss.textContent = 'Dismiss'; dismiss.onclick = () => note.remove();
  note.append(copy, dismiss);
  document.body.append(note);
  placeStorageWarning();
}
function placeStorageWarning() {
  const note = document.getElementById('phoneStorageWarning');
  if (!note) return;
  const footer = document.querySelector('.basics-screen:not([hidden]) .basics-footer');
  note.classList.toggle('is-inline', !!footer);
  if (footer) footer.prepend(note);
  else document.body.append(note);
}
window.addEventListener('storage-unavailable',storageWarning);
window.addEventListener('phone-page',placeStorageWarning);
if (!app.storageOK) storageWarning();
if (app.onboarded) window.openController();
else app.show('welcome', document.getElementById('opener'));
