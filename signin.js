// The pane's sign-in window starts and ends on signin.html: Office's dialog has
// to open on the add-in's own site, and the page is the redirect URI registered
// with Lucid.
// Opened as signin.html?state=...&challenge=... (by the pane): goes on to Lucid's
// sign-in for this add-in. The URL is built here, from this add-in's client ID,
// redirect URI and scopes, so the page can't be used to start another app's
// sign-in (consent phishing from a trusted address) or to send anyone elsewhere.
// Back from Lucid as signin.html?code=...&state=... (or ?error=...): hands that to the pane.

// Same as taskpane.js.
const CLIENT_ID = "sXwaqbgWYWaJ_I-bb9LBuqbSB1YMVMVS7NDE0Wut";
const SIGNIN_PAGE = "https://tigerbitten.github.io/word_lucidcharts/signin.html";
// offline_access: stay signed in across restarts (taskpane.js ends a sign-in
// after 12 hours); embed: Lucid's editor in the pane, for diagrams picked in its
// picker; content:readonly: export and read any of the user's documents.
const SCOPES = ["offline_access", "lucidchart.document.app.picker.share.embed", "lucidchart.document.content:readonly"];

const q = new URLSearchParams(location.search);
// Lucid's one-time code leaves the address bar and history as soon as it's read.
// Through the prototype: office.js sets history.replaceState to null.
History.prototype.replaceState.call(history, null, "", location.pathname);
const say = text => { document.getElementById("msg").textContent = text; };

if (q.has("challenge")) {
  const state = q.get("state"), challenge = q.get("challenge");
  // What the pane makes: a random UUID, and a base64url SHA-256.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
    say("This isn't a sign-in started by the add-in. Close this window and click Sign in to Lucid in the add-in.");
    throw new Error("bad sign-in request: " + JSON.stringify([state, challenge]));
  }
  location.replace("https://lucid.app/oauth2/authorize?" + new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: SIGNIN_PAGE,
    scope: SCOPES.join(" "), response_type: "code", state, code_challenge: challenge, code_challenge_method: "S256" }));
} else {
  say(q.has("error") ? "Sign-in didn't finish: " + q.get("error") : "Signed in. Back to Word...");
  // A pane in a plain browser listens here (same site, same storage). In Word
  // the pane and this window don't share storage, so it's Office's dialog
  // messaging. The code is useless without the pane's PKCE verifier.
  new BroadcastChannel("lucid-sign-in").postMessage(q.toString());
  Office.onReady(info => {
    if (info.host) Office.context.ui.messageParent(q.toString()); // Word closes the window
    else window.close();
  });
}
