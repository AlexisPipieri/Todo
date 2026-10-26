'use strict';

// Sparkle, the standard macOS updater, checks once a day by default (minimum one hour).
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Decides whether a background check should go out. Called at natural moments (launch, window
// opened, wake from sleep), so the interval only throttles: no timer runs in the background.
function shouldCheck({ now, lastCheck, ready, interval = CHECK_INTERVAL_MS }) {
  if (ready) return false;                    // an update is already downloaded, nothing to look for
  if (lastCheck == null) return true;
  if (now < lastCheck) return true;           // clock moved backwards: don't wait for it to catch up
  return now - lastCheck >= interval;
}

module.exports = { shouldCheck, CHECK_INTERVAL_MS };
