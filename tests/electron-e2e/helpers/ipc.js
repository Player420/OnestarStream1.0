/**
 * ipc.js
 * 
 * Utilities to send/receive Electron IPC events during E2E tests
 * Uses Chrome DevTools Protocol to execute code in the renderer process
 */

/**
 * Send an IPC event from renderer to main process
 * 
 * @param {Object} cdpClient - Chrome DevTools Protocol client
 * @param {string} channel - IPC channel name
 * @param {any} data - Data to send
 * @returns {Promise<any>}
 */
export async function ipcInvoke(cdpClient, channel, data = null) {
  const { Runtime } = cdpClient;

  const dataJson = JSON.stringify(data);

  const { result, exceptionDetails } = await Runtime.evaluate({
    expression: `
      (async () => {
        const data = ${dataJson};
        return await window.onestar?._ipcInvoke?.('${channel}', data);
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });

  if (exceptionDetails) {
    throw new Error(`IPC invoke error: ${exceptionDetails.exception.description}`);
  }

  return result.value;
}

/**
 * Emit a test IPC event (TEST_MODE only)
 * 
 * @param {Object} cdpClient - Chrome DevTools Protocol client
 * @param {string} channel - IPC channel name
 * @param {any} data - Event data
 * @returns {Promise<void>}
 */
export async function emitTestIpcEvent(cdpClient, channel, data) {
  const { Runtime } = cdpClient;

  const dataJson = JSON.stringify(data);

  const { exceptionDetails } = await Runtime.evaluate({
    expression: `
      (async () => {
        if (!window.onestar?.__test) {
          throw new Error('TEST_MODE not enabled');
        }
        await window.onestar.__test.emitIpcEvent('${channel}', ${dataJson});
        return true;
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });

  if (exceptionDetails) {
    throw new Error(`Test IPC emit error: ${exceptionDetails.exception.description}`);
  }
}

/**
 * Force sync status update (TEST_MODE only)
 * 
 * @param {Object} cdpClient - Chrome DevTools Protocol client
 * @param {Object} healthReport - Sync health report object
 * @returns {Promise<void>}
 */
export async function forceSyncStatus(cdpClient, healthReport) {
  await emitTestIpcEvent(cdpClient, 'sync:status-change', healthReport);
}

/**
 * Force vault locked state (TEST_MODE only)
 * 
 * @param {Object} cdpClient - Chrome DevTools Protocol client
 * @param {boolean} locked - Whether vault is locked
 * @returns {Promise<void>}
 */
export async function forceVaultLocked(cdpClient, locked) {
  const { Runtime } = cdpClient;

  const { exceptionDetails } = await Runtime.evaluate({
    expression: `
      (async () => {
        if (!window.onestar?.__test) {
          throw new Error('TEST_MODE not enabled');
        }
        await window.onestar.__test.setVaultLocked(${locked});
        return true;
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });

  if (exceptionDetails) {
    throw new Error(`Force vault locked error: ${exceptionDetails.exception.description}`);
  }
}

/**
 * Trigger key rotation event (TEST_MODE only)
 * 
 * @param {Object} cdpClient - Chrome DevTools Protocol client
 * @returns {Promise<void>}
 */
export async function triggerRotation(cdpClient) {
  const { Runtime } = cdpClient;

  const { exceptionDetails } = await Runtime.evaluate({
    expression: `
      (async () => {
        if (!window.onestar?.__test) {
          throw new Error('TEST_MODE not enabled');
        }
        await window.onestar.__test.triggerRotation();
        return true;
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });

  if (exceptionDetails) {
    throw new Error(`Trigger rotation error: ${exceptionDetails.exception.description}`);
  }
}

/**
 * Get React context state from BackgroundSyncProvider
 * 
 * @param {Object} cdpClient - Chrome DevTools Protocol client
 * @returns {Promise<Object>}
 */
export async function getSyncContextState(cdpClient) {
  const { Runtime } = cdpClient;

  const { result, exceptionDetails } = await Runtime.evaluate({
    expression: `
      (() => {
        // Access React DevTools global hook to get context state
        // Fallback: check window.__REACT_CONTEXT_STATE__ if we inject it
        return window.__SYNC_CONTEXT_STATE__ || null;
      })()
    `,
    returnByValue: true,
  });

  if (exceptionDetails) {
    throw new Error(`Get context state error: ${exceptionDetails.exception.description}`);
  }

  return result.value;
}

/**
 * Wait for IPC event to be received
 * 
 * @param {Object} cdpClient - Chrome DevTools Protocol client
 * @param {string} eventName - Event name to wait for
 * @param {Object} options
 * @param {number} options.timeout - Timeout in ms (default: 5000)
 * @returns {Promise<any>}
 */
export async function waitForIpcEvent(cdpClient, eventName, options = {}) {
  const { timeout = 5000 } = options;
  const { Runtime } = cdpClient;

  // Set up event listener
  await Runtime.evaluate({
    expression: `
      (() => {
        if (!window.__TEST_IPC_EVENTS__) {
          window.__TEST_IPC_EVENTS__ = {};
        }
        window.__TEST_IPC_EVENTS__['${eventName}'] = null;
        
        const handler = (data) => {
          window.__TEST_IPC_EVENTS__['${eventName}'] = data;
        };
        
        window.onestar?.events?.once('${eventName}', handler);
      })()
    `,
  });

  // Poll for event data
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const { result } = await Runtime.evaluate({
      expression: `window.__TEST_IPC_EVENTS__?.['${eventName}'] || null`,
      returnByValue: true,
    });

    if (result.value !== null) {
      return result.value;
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw new Error(`Timeout waiting for IPC event: ${eventName}`);
}
