// Runs before the app paints: sets the page language and direction from the saved setting, so an Arabic
// reader never sees a left-to-right flash while the app loads. (A separate file because the page's
// security policy does not allow scripts written into the page itself.)
try {
  var saved = JSON.parse(localStorage.getItem('maai.settings') || '{}');
  var root = document.documentElement;
  var arabic = saved && saved.lang === 'ar';
  root.lang = arabic ? 'ar' : 'en';
  root.dir = arabic ? 'rtl' : 'ltr';
} catch (e) {
  /* storage unavailable: the app sets it once it starts */
}
