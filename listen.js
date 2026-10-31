// Loaded before office.js, so this listener runs before office.js's own:
// Lucid's embed posts to this window, and office.js talks to Word over the same
// window messages. Keeping Lucid's messages away from it is a guess at why Word
// calls hung in Word on the web ("r is not a function"). onLucidMessage is in
// taskpane.js, loaded by the time any message arrives.
window.addEventListener("message", e => {
  if (e.origin !== "https://lucid.app") return;
  e.stopImmediatePropagation();
  onLucidMessage(e);
});
