// Applies the saved light/dark choice before the page paints (see src/shared/theme.ts).
// Loaded as a plain blocking script from index.html, so it runs before React.
;(function () {
  var pref = 'system'
  try {
    pref = localStorage.getItem('kinvo.theme') || 'system'
  } catch (e) {}
  var dark = pref === 'dark' || (pref !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#000000' : '#ffffff')
})()
