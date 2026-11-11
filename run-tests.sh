#!/bin/sh
# Runs every test for the trainer and Heart Defense. Usage:  sh run-tests.sh   (needs Node.js)
# Browser tests also need Playwright (npm i -D playwright && npx playwright install chromium); skipped if missing.
# Exit code is 0 only if every test passed.
cd "$(dirname "$0")" || exit 1
status=0
run() {
  title="$1"; shift
  echo "== $title =="
  if out=$("$@" 2>&1); then :; else status=1; echo "  ** FAILED **"; fi
  echo "$out" | tail -3
}
echo "---- Shared music engine and Heart Defense rules ----"
run "music engine" node tests/engine.test.js
run "Heart Defense rules" node tests/game.test.js
run "microphone listener (shared)" node tests/mic-listener.test.js
echo "---- Note Trainer ----"
for t in theory accidentals range pitch filters; do run "$t" node "tests/$t.test.js"; done
if node -e "require('playwright')" 2>/dev/null; then
  echo "---- In a real browser ----"
  run "Heart Defense play-through" node tests/play.test.js
  run "Heart Defense with the microphone" node tests/play-mic.test.js
  run "trainer layout (phone / Chromebook)" node tests/layout-check.js
  run "trainer + fake microphone" node tests/browser-mic.test.js
  run "trainer quiet guitar + calibration" node tests/browser-calibration.test.js
else
  echo "(browser tests skipped: Playwright is not installed)"
fi
[ $status -eq 0 ] && echo "ALL TESTS PASSED" || echo "SOME TESTS FAILED"
exit $status
