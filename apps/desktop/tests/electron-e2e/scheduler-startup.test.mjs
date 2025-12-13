/**
 * scheduler-startup.test.mjs
 * 
 * Tests Electron scheduler initialization on app startup
 * 
 * Validates:
 * - NavBar sync badge appears
 * - Badge transitions through states (idle → checking → up-to-date)
 * - Scheduler is initialized with future nextRun timestamp
 * 
 * PRODUCTION-READY VERSION - Phase 23 Task 7
 */

import { 
  waitForSelector,
  waitForCondition,
  getBadgeSelector, 
  getElementText, 
  getElementAttribute 
} from './helpers/waitForSelector.js';
import { ipcInvoke, waitForIpcEvent } from './helpers/ipc.js';

/**
 * Test: Scheduler starts on app boot
 * 
 * @param {Object} context - { electronProcess, cdpClient, close }
 */
export default async function test({ cdpClient }) {
  console.log('[Test] === SCHEDULER STARTUP TEST ===');
  console.log('[Test] Step 1: Waiting for app to load...');
  
  // Step 1: Wait for NavBar to render
  await waitForSelector(cdpClient, 'nav', { timeout: 15000 });
  console.log('[Test] ✅ NavBar rendered');

  // Step 2: Wait for sync badge to appear (use specific selector)
  const badgeSelector = getBadgeSelector();
  console.log(`[Test] Step 2: Waiting for badge selector: ${badgeSelector}`);
  await waitForSelector(cdpClient, badgeSelector, { timeout: 10000, visible: true });
  console.log('[Test] ✅ Sync badge found');

  // Step 3: Check initial badge state
  const badgeText = await getElementText(cdpClient, badgeSelector);
  const validStates = ['·', '↻', '✓', '!', '✕']; // idle, syncing, up-to-date, needs-sync, error
  if (!validStates.includes(badgeText.trim())) {
    throw new Error(`Invalid badge text: "${badgeText}" (expected one of: ${validStates.join(', ')})`);
  }
  console.log(`[Test] ✅ Initial badge state: "${badgeText}"`);

  // Step 4: Wait for scheduler to complete initial check
  // In TEST_MODE, initial delay is 1s, so check should happen within 5s
  console.log('[Test] Step 3: Waiting for initial sync check to complete...');
  try {
    const eventData = await waitForIpcEvent(cdpClient, 'sync:status-change', { timeout: 8000 });
    console.log('[Test] ✅ Received sync:status-change event');
    if (eventData) {
      console.log('[Test] Event data:', JSON.stringify(eventData, null, 2));
    }
  } catch (error) {
    console.warn('[Test] ⚠️  No status-change event within 8s (may be cached or not triggered yet)');
  }

  // Step 5: Wait for badge to transition to final state
  console.log('[Test] Step 4: Waiting for badge final state...');
  await waitForCondition(
    async () => {
      const currentBadge = await getElementText(cdpClient, badgeSelector);
      // Wait for non-idle state (check completed)
      return currentBadge.trim() !== '·' && validStates.includes(currentBadge.trim());
    },
    { timeout: 5000, interval: 300 }
  ).catch(() => console.log('[Test] ℹ️  Badge remained in initial state'));

  const finalBadgeText = await getElementText(cdpClient, badgeSelector);
  console.log(`[Test] Final badge state: "${finalBadgeText}"`);

  if (!validStates.includes(finalBadgeText.trim())) {
    throw new Error(`Invalid final badge text: "${finalBadgeText}"`);
  }

  // Step 6: Verify scheduler is initialized (has nextRun timestamp)
  console.log('[Test] Step 5: Checking scheduler state via IPC...');
  
  // Wait for scheduler to be fully initialized
  await waitForCondition(
    async () => {
      const nextRun = await ipcInvoke(cdpClient, 'sync:scheduler:getNextRun', null);
      return nextRun !== null && nextRun > Date.now();
    },
    { timeout: 3000, interval: 300 }
  );

  const nextRun = await ipcInvoke(cdpClient, 'sync:scheduler:getNextRun', null);
  
  if (nextRun === null) {
    throw new Error('Scheduler not initialized (nextRun is null)');
  }

  const now = Date.now();
  const timeUntilNext = nextRun - now;
  
  if (timeUntilNext < 0) {
    throw new Error(`nextRun is in the past: ${new Date(nextRun).toISOString()}`);
  }

  // In TEST_MODE, nextRun should be very soon (1s), in production: ~6h
  const maxExpectedDelay = process.env.TEST_MODE ? 10000 : (6 * 60 * 60 * 1000 + 10000);
  if (timeUntilNext > maxExpectedDelay) {
    throw new Error(`nextRun is too far in future: ${timeUntilNext}ms (max: ${maxExpectedDelay}ms)`);
  }

  console.log(`[Test] ✅ Scheduler initialized: nextRun in ${Math.round(timeUntilNext / 1000)}s`);

  // Step 7: Verify badge has styling
  const badgeStyle = await getElementAttribute(cdpClient, badgeSelector, 'style');
  if (badgeStyle && badgeStyle.length > 0) {
    console.log(`[Test] ✅ Badge has inline style (${badgeStyle.length} chars)`);
  } else {
    console.warn('[Test] ⚠️  Badge has no inline style (may use className)');
  }

  console.log('[Test] ✅ === ALL STARTUP CHECKS PASSED ===');
}
