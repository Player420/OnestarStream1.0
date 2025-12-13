# Electron E2E Test Suite

**Phase 23: Background Sync Scheduler - Production Integration Tests**

## Overview

This directory contains production-grade end-to-end tests for the Electron-based background sync scheduler. Tests use **real Electron processes**, **Chrome DevTools Protocol (CDP)** for UI automation, and **zero mocks**.

## Architecture

```
tests/electron-e2e/
├── helpers/
│   ├── launchElectron.js    # Electron process management + CDP
│   ├── waitForSelector.js   # DOM polling and interaction
│   ├── ipc.js                # IPC event manipulation (TEST_MODE)
│   └── buildApp.js           # Pre-test build orchestration
├── scheduler-startup.test.mjs           # Test app boot + scheduler init
├── scheduler-status-event.test.mjs      # Test IPC event flow
├── scheduler-sync-needed.test.mjs       # Test needs-sync UI state
├── scheduler-run-now.test.mjs           # Test manual check button
├── scheduler-vault-locked.test.mjs      # Test vault lock suppression
├── rotation-integration.test.mjs        # Test rotation lifecycle
├── full-cycle.test.mjs                  # End-to-end workflow
├── test-runner.js                        # Main orchestrator
└── README.md                             # This file
```

## Test Scenarios

### 1. scheduler-startup.test.mjs
**Validates:**
- NavBar sync badge appears on app startup
- Badge transitions through states (idle → checking → up-to-date)
- Scheduler initializes with future `nextRun` timestamp
- Initial sync check completes within 10s

**Key Assertions:**
- Badge text is one of: `·`, `↻`, `✓`
- `nextRun` is future timestamp within ~6h window
- Badge color matches state (green/yellow, not red/gray)

---

### 2. scheduler-status-event.test.mjs
**Validates:**
- IPC event flow: main → preload → renderer
- `forceSyncStatus()` emits `sync:status-change` event
- BackgroundSyncProvider receives event
- UI updates (status card, badge color)

**Key Assertions:**
- Emitting `needsSync: true` → status card shows "Needs Sync"
- Badge text changes to `!` (red alert)
- Emitting `needsSync: false` → status card shows "Up to Date"
- Badge text changes to `✓` (green checkmark)

---

### 3. scheduler-sync-needed.test.mjs
**Validates:**
- Health report with warnings displays correctly
- Critical warnings highlighted
- Recommendations shown
- Warning count badge

**Key Assertions:**
- Critical warning message displayed in UI
- Warning-level message displayed
- Recommendation text visible
- Badge shows alert indicator (`!`)
- Clearing warnings returns to up-to-date state

---

### 4. scheduler-run-now.test.mjs
**Validates:**
- Manual "Run Check Now" button triggers immediate sync check
- Button disables during check
- `sync:status-change` event fires
- UI reflects check result
- Button re-enables after completion

**Key Assertions:**
- Button exists and is enabled initially
- Button disables on click
- Status-change event received within 15s
- UI updates to match event data (needs-sync or up-to-date)
- `nextRun` timestamp updated
- `lastRun` timestamp displays as "just now"

---

### 5. scheduler-vault-locked.test.mjs
**Validates:**
- Scheduler skips checks when vault locked
- No status-change events emitted while locked
- UI shows vault-locked indicator
- Scheduler resumes after unlock

**Key Assertions:**
- `forceVaultLocked(true)` → no events fire on manual check
- `getNextRun()` returns `null` while locked
- Badge does not show error state (`✕`)
- `forceVaultLocked(false)` → scheduler resumes
- Status-change event fires after unlock

---

### 6. rotation-integration.test.mjs
**Validates:**
- Key rotation completion triggers scheduler update
- `nextRun` timestamp resets
- Status-change event fires
- UI reflects rotation completion

**Key Assertions:**
- `triggerRotation()` → status-change event fires within 15s
- `nextRun` updated to future timestamp
- Event data contains valid health report
- `lastCheck` is recent (< 5s ago)
- Scheduler remains active after rotation

---

### 7. full-cycle.test.mjs
**Validates:**
Complete sync lifecycle:
1. App startup + scheduler init
2. Force needs-sync state
3. User navigates to settings
4. User triggers manual check
5. Simulate import completion
6. Verify return to up-to-date

**Key Assertions:**
- **Phase 1 (Startup):** Badge visible, scheduler initialized
- **Phase 2 (Needs-Sync):** Badge turns red, warning displayed
- **Phase 3 (Navigation):** Settings page loads, Scheduler tab active
- **Phase 4 (Manual Check):** Button triggers check, event fires
- **Phase 5 (Import):** Up-to-date event clears warnings
- **Phase 6 (Resolution):** Badge turns green, warnings cleared
- **Phase 7 (Scheduler State):** `nextRun` is future value
- **Phase 8 (Edge Cases):** Vault lock suspends scheduler

---

## Helper Utilities

### launchElectron.js
**Purpose:** Electron process management with Chrome DevTools Protocol.

**Key Features:**
- Spawns Electron with `TEST_MODE=true`, remote debugging on port 9222
- CDP connection with 30 retry attempts (100ms intervals)
- Enables `Page`, `Runtime`, `Network` domains
- Waits for "Window loaded" or 3s fallback
- Graceful shutdown: SIGTERM → 5s grace → SIGKILL

**Usage:**
```javascript
import { launchElectron } from './helpers/launchElectron.js';

const { electronProcess, cdpClient, close } = await launchElectron({ headless: true });
// ... run tests ...
await close();
```

---

### waitForSelector.js
**Purpose:** DOM polling and interaction utilities via CDP.

**Key Functions:**
- `waitForSelector(cdpClient, selector, options)` - Poll for element with visibility check
- `waitForText(cdpClient, selector, expectedText)` - Poll for text match (string or RegExp)
- `clickElement(cdpClient, selector)` - Wait + click via `Runtime.evaluate`
- `getElementText(cdpClient, selector)` - Query `textContent` or `innerText`
- `getElementAttribute(cdpClient, selector, attribute)` - Query `getAttribute()`
- `navigate(cdpClient, url)` - Page navigation

**Usage:**
```javascript
import { waitForSelector, clickElement, waitForText } from './helpers/waitForSelector.js';

await waitForSelector(cdpClient, 'nav a[href="/settings/sync"]', { visible: true, timeout: 10000 });
await clickElement(cdpClient, 'button:has-text("Run Check Now")');
await waitForText(cdpClient, 'main', /up.to.date/i);
```

---

### ipc.js
**Purpose:** IPC event manipulation for TEST_MODE.

**Key Functions:**
- `ipcInvoke(cdpClient, channel, data)` - Send IPC from renderer to main
- `emitTestIpcEvent(cdpClient, channel, data)` - Emit test events (requires `__test` API)
- `forceSyncStatus(cdpClient, healthReport)` - Inject `sync:status-change` event
- `forceVaultLocked(cdpClient, locked)` - Control vault state
- `triggerRotation(cdpClient)` - Simulate key rotation
- `waitForIpcEvent(cdpClient, eventName, options)` - Poll for IPC event with timeout

**Usage:**
```javascript
import { forceSyncStatus, waitForIpcEvent, forceVaultLocked } from './helpers/ipc.js';

await forceSyncStatus(cdpClient, { needsSync: true, warnings: [...] });
await waitForIpcEvent(cdpClient, 'sync:status-change', { timeout: 15000 });
await forceVaultLocked(cdpClient, true);
```

---

### buildApp.js
**Purpose:** Pre-test build orchestration.

**Key Functions:**
- `buildNextJs()` - Run `npm run build` in project root
- `buildElectron()` - Run `npx tsc` in `electron/`
- `buildAll(options)` - Sequential build with `skipNextJs`, `skipElectron` options

**Usage:**
```javascript
import { buildAll } from './helpers/buildApp.js';

await buildAll(); // Build Next.js + Electron
await buildAll({ skipNextJs: true }); // Only build Electron
```

---

## TEST_MODE Integration

### electron/main.ts
**Modifications:**
```typescript
const isTestMode = process.env.TEST_MODE === 'true';

if (isTestMode) {
  // Test-only: Emit fake IPC events to renderer
  ipcMain.handle('test:emit-sync-status', async (event, data) => {
    browserWindow.webContents.send('sync:status-change', data);
  });

  // Test-only: Mock vault lock state
  ipcMain.handle('test:set-vault-locked', async (event, locked: boolean) => {
    if (locked) await syncScheduler.stop();
    else await syncScheduler.start();
  });

  // Test-only: Trigger rotation completion
  ipcMain.handle('test:trigger-rotation', async () => {
    await syncScheduler.onRotationComplete();
  });
}
```

---

### electron/preload.ts
**Modifications:**
```typescript
if (process.env.TEST_MODE === 'true') {
  (api as any).__test = {
    async emitIpcEvent(channel: string, data: any) {
      await ipcRenderer.invoke('test:emit-sync-status', data);
    },
    async setVaultLocked(locked: boolean) {
      await ipcRenderer.invoke('test:set-vault-locked', locked);
    },
    async triggerRotation() {
      await ipcRenderer.invoke('test:trigger-rotation');
    },
  };
}
```

---

## Running Tests

### Prerequisites
1. Install dependencies:
   ```bash
   npm install
   ```

2. Build application:
   ```bash
   npm run build
   npx tsc -p electron/tsconfig.json
   ```

### Run All Tests
```bash
npm run test:e2e
```

### Run Specific Test
```bash
node tests/electron-e2e/test-runner.js scheduler-startup.test.mjs
```

### Skip Build (Development)
```bash
SKIP_BUILD=true npm run test:e2e
```

### Run in Headed Mode (Show UI)
```bash
HEADLESS=false npm run test:e2e
```

---

## Test Output

**Successful Run:**
```
🚀 Electron E2E Test Runner
────────────────────────────────────────────────────────────

📦 Building application...
[Build] Building Next.js application...
[Build] Next.js build complete
[Build] Building Electron application...
[Build] Electron build complete

🔍 Discovering tests (pattern: *.test.mjs)...
Found 7 test(s):
  1. scheduler-startup.test.mjs
  2. scheduler-status-event.test.mjs
  3. scheduler-sync-needed.test.mjs
  4. scheduler-run-now.test.mjs
  5. scheduler-vault-locked.test.mjs
  6. rotation-integration.test.mjs
  7. full-cycle.test.mjs

🖥️  Launching Electron...
[Electron] Starting Electron with TEST_MODE...
[Electron] Window loaded

============================================================
Running: scheduler-startup.test.mjs
============================================================
[Test] Waiting for app to load...
[Test] NavBar rendered
[Test] Sync badge found
[Test] Initial badge state: "·"
[Test] Waiting for initial sync check to complete...
[Test] Received sync:status-change event
[Test] Final badge state: "✓"
[Test] Checking scheduler state via IPC...
[Test] ✅ Scheduler initialized: nextRun in 21600s
[Test] ✅ Badge color is valid
[Test] ✅ All startup checks passed
✅ PASSED: scheduler-startup.test.mjs

... (5 more tests) ...

🛑 Shutting down Electron...

============================================================
📊 Test Summary
============================================================
Total:  7
Passed: 7 ✅
Failed: 0 ❌

✅ All tests passed!
```

---

## Debugging Tests

### Enable Electron Logs
```bash
ELECTRON_ENABLE_LOGGING=1 npm run test:e2e
```

### Increase Timeouts
Edit `helpers/waitForSelector.js`:
```javascript
const DEFAULT_TIMEOUT = 30000; // 30s instead of 10s
```

### Inspect CDP Connection
Add logging to `helpers/launchElectron.js`:
```javascript
cdpClient.on('event', (message) => {
  console.log('[CDP Event]', message.method, message.params);
});
```

### View Electron Window
```bash
HEADLESS=false npm run test:e2e
```

---

## Troubleshooting

### Test fails with "CDP connection timeout"
**Cause:** Electron not starting or CDP port blocked.

**Solution:**
1. Check Electron logs: `ELECTRON_ENABLE_LOGGING=1 npm run test:e2e`
2. Verify port 9222 is not in use: `lsof -i :9222`
3. Increase timeout in `launchElectron.js`: `timeout: 60000`

---

### Test fails with "Element not found"
**Cause:** Selector doesn't match actual DOM structure.

**Solution:**
1. Run in headed mode: `HEADLESS=false npm run test:e2e`
2. Inspect DOM with browser DevTools
3. Update selectors in test file

---

### Test fails with "TEST_MODE not enabled"
**Cause:** `window.onestar.__test` not exposed.

**Solution:**
1. Verify `process.env.TEST_MODE === 'true'` in `preload.ts`
2. Check Electron launch args in `launchElectron.js`
3. Rebuild Electron: `npx tsc -p electron/tsconfig.json`

---

## DOM Selectors Reference

**NavBar Badge:**
```javascript
'nav a[href="/settings/sync"] span'
```

**Scheduler Tab Button:**
```javascript
'button:has-text("Scheduler")'
```

**Status Card:**
```javascript
'.status-card, [data-testid="status-card"]'
```

**Run Check Now Button:**
```javascript
'button:has-text("Run Check Now"), button:has-text("Check Now")'
```

---

## Contributing

### Adding New Tests
1. Create `test-name.test.mjs` in `tests/electron-e2e/`
2. Export default function: `export default async function test({ cdpClient }) { ... }`
3. Use helpers from `helpers/` directory
4. Add assertions with descriptive console logs
5. Run test: `node test-runner.js test-name.test.mjs`

### Test Structure
```javascript
export default async function test({ cdpClient }) {
  console.log('[Test] Step 1: Setup...');
  // ... setup code ...
  
  console.log('[Test] Step 2: Action...');
  // ... perform action ...
  
  console.log('[Test] Step 3: Verify...');
  // ... assertions ...
  
  console.log('[Test] ✅ All checks passed');
}
```

---

## License

Internal use only - Phase 23 Background Sync Scheduler E2E Tests.
