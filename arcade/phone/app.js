// Normal app startup; independent of the removed design lab.
const app = window.PhoneApp;
function storageWarning() {
  if (document.getElementById('phoneStorageWarning')) return;
  const note = document.createElement('div');
  note.id = 'phoneStorageWarning'; note.className = 'phone-storage-warning';
  note.setAttribute('role','status');
  note.textContent = 'Storage is unavailable. You can play, but new profile changes and activity may not survive a reload.';
  document.body.append(note);
}
window.addEventListener('storage-unavailable',storageWarning);
if (!app.storageOK) storageWarning();
if (!new URLSearchParams(location.search).has('connect')) {
  const page = app.preferences.page;
  if (page === 'controller') window.openController();
  else if (page === 'profile') window.openProfile();
  else if (page === 'setup') window.openBasics();
  else if (page === 'statistics') window.openStatistics();
  else if (page?.startsWith('metric:')) window.openMetric(page.slice(7));
  else if (page === 'stats' || app.preferences.guideSeen) window.openActivity();
}
