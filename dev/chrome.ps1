# Starts the test Chrome: its own profile (Microsoft and Lucid sign-ins persist
# there, outside OneDrive), DevTools on :9222 for dev/cdp.js and dev/serve.js,
# and no throttling of a covered window, so screenshots and timers keep working.
# Opens Claude's test doc. Word on the web forgets uploaded add-ins once the
# pane is closed: re-upload manifest.xml (Add-ins > More Add-ins > My Add-ins >
# Manage My Add-ins > Upload My Add-in; dev/cdp.js `file` fills the picker).
$profile = Join-Path $env:LOCALAPPDATA "word-lucid-test-chrome"
Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList @(
  "--remote-debugging-port=9222", "--user-data-dir=`"$profile`"", "--no-first-run", "--no-default-browser-check",
  "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling",
  "https://word.cloud.microsoft/open/onedrive/?docId=DB0E68BED0AD0E44%21s00467b2e68c74cfb82e257fb8f17cc51&driveId=DB0E68BED0AD0E44")
