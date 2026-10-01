// Opening the front door on a phone should lead to its controller.
const query = new URLSearchParams(location.search);
const mobile = /Android|iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
if (mobile && !query.has('desktop') && query.get('controller') !== '1' && window.top === window) {
  location.replace('/phone.html');
}
