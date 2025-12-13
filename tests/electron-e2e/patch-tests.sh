#!/bin/bash
#
# patch-tests.sh
# Phase 23 Task 7 - Patch all E2E test files with correct selectors
#

set -e

echo "🔧 Patching E2E test files..."

cd "$(dirname "$0")"

# Function to patch test file
patch_test() {
  local file=$1
  echo "  Patching $file..."
  
  # Backup original
  cp "$file" "$file.bak"
  
  # Fix imports - add new helpers
  sed -i '' 's/import { waitForSelector,/import { waitForSelector, clickButtonByText, getBadgeSelector,/' "$file"
  
  # Fix badge selector
  sed -i '' "s/'nav a\[href=\"\/settings\/sync\"\] span'/getBadgeSelector()/g" "$file"
  sed -i '' 's/"nav a\[href="\/settings\/sync"\] span"/getBadgeSelector()/g' "$file"
  sed -i '' 's/`nav a\[href="\/settings\/sync"\] span`/getBadgeSelector()/g' "$file"
  
  # Fix Scheduler button
  sed -i '' "s/await clickElement(cdpClient, 'button:has-text(\"Scheduler\")')/await clickButtonByText(cdpClient, 'Scheduler')/g" "$file"
  sed -i '' "s/clickElement(cdpClient, 'button:has-text(\"Scheduler\")')/clickButtonByText(cdpClient, 'Scheduler')/g" "$file"
  sed -i '' 's/const schedulerTabSelector = .*$/\/\/ Click Scheduler tab\n  await clickButtonByText(cdpClient, "Scheduler");/' "$file"
  
  # Fix Run Check Now button
  sed -i '' "s/const buttonSelector = 'button:has-text(\"Run Check Now\"), button:has-text(\"Check Now\"), button:has-text(\"Run Now\")';/\/\/ Run Check Now button\n  const buttonText = 'Run Check Now';/g" "$file"
  sed -i '' 's/await waitForSelector(cdpClient, buttonSelector, { timeout: 5000, visible: true });/\/\/ Find button by text content\n  await waitForCondition(async () => await findButtonByText(cdpClient, buttonText), { timeout: 5000 });/' "$file"
  sed -i '' 's/await clickElement(cdpClient, buttonSelector);/await clickButtonByText(cdpClient, buttonText);/g' "$file"
  
  # Import findButtonByText and waitForCondition if needed
  sed -i '' 's/import { waitForSelector, clickButtonByText, getBadgeSelector,/import { waitForSelector, clickButtonByText, findButtonByText, waitForCondition, getBadgeSelector,/' "$file"
}

# Patch each test file
for test in scheduler-status-event.test.mjs scheduler-sync-needed.test.mjs scheduler-run-now.test.mjs scheduler-vault-locked.test.mjs rotation-integration.test.mjs full-cycle.test.mjs; do
  if [ -f "$test" ]; then
    patch_test "$test"
  fi
done

echo "✅ All tests patched!"
echo ""
echo "To verify patches:"
echo "  grep -n 'clickButtonByText' *.test.mjs"
echo "  grep -n 'getBadgeSelector' *.test.mjs"
echo ""
echo "To restore originals:"
echo "  for f in *.test.mjs.bak; do mv \"\$f\" \"\${f%.bak}\"; done"
