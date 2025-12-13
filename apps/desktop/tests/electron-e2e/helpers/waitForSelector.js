/**
 * waitForSelector.js
 * 
 * Promise-based DOM polling utilities for E2E testing
 * 
 * PATCHED VERSION - Phase 23 Task 7
 * - Fixed CSS selector issues (removed :has-text pseudo-selector)
 * - Added findButtonByText helper for DOM text matching
 * - Improved visibility checks
 * - Better error messages
 */

/**
 * Find button by text content (alternative to :has-text() pseudo-selector)
 * @param {Object} cdpClient - Chrome DevTools Protocol client
 * @param {string} text - Button text to search for
 * @param {Object} options - Options { timeout: 3000 }
 * @returns {Promise<boolean>} - True if button found
 */
export async function findButtonByText(cdpClient, text, options = {}) {
  const timeout = options.timeout || 3000;
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const { Runtime } = cdpClient;
    
    const { result } = await Runtime.evaluate({
      expression: `
        (() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          return buttons.some(btn => btn.textContent.trim().includes('${text}'));
        })()
      `,
      returnByValue: true,
    });
    
    if (result.value === true) {
      return true;
    }
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return false;
}

/**
 * Click button by text content
 * 
 * @param {Object} cdpClient - CDP client
 * @param {string} text - Button text
 */
export async function clickButtonByText(cdpClient, text) {
  const { Runtime } = cdpClient;
  await Runtime.evaluate({
    expression: `
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const button = buttons.find(btn => btn.textContent.trim().includes('${text.replace(/'/g, "\\'")}'));
        if (button) button.click();
      })()
    `,
    returnByValue: true,
  });
}

/**
 * Wait for a DOM selector to appear in the page
 * 
 * @param {Object} cdpClient - Chrome DevTools Protocol client
 * @param {string} selector - CSS selector to wait for
 * @param {Object} options
 * @param {number} options.timeout - Timeout in ms (default: 10000)
 * @param {number} options.pollInterval - Poll interval in ms (default: 100)
 * @param {boolean} options.visible - Wait for element to be visible (default: false)
 * @returns {Promise<void>}
 */
export async function waitForSelector(cdpClient, selector, options = {}) {
  const {
    timeout = 10000,
    pollInterval = 100,
    visible = false,
  } = options;

  const startTime = Date.now();
  const { Runtime } = cdpClient;

  while (Date.now() - startTime < timeout) {
    try {
      const { result } = await Runtime.evaluate({
        expression: `
          (() => {
            const element = document.querySelector('${selector.replace(/'/g, "\\'")}');
            if (!element) return false;
            ${visible ? `
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && 
                   style.visibility !== 'hidden' && 
                   rect.width > 0 && 
                   rect.height > 0;
            ` : 'return true;'}
          })()
        `,
        returnByValue: true,
      });

      if (result.value === true) {
        return;
      }
    } catch (err) {
      // Continue polling
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Timeout waiting for selector: ${selector} (timeout: ${timeout}ms, visible: ${visible})`);
}

/**
 * Wait for text content to appear in element
 * 
 * @param {Object} cdpClient - CDP client
 * @param {string} selector - CSS selector
 * @param {string|RegExp} expectedText - Text to match
 * @param {Object} options
 * @returns {Promise<void>}
 */
export async function waitForText(cdpClient, selector, expectedText, options = {}) {
  const {
    timeout = 10000,
    pollInterval = 100,
  } = options;

  const startTime = Date.now();
  const { Runtime } = cdpClient;
  const isRegex = expectedText instanceof RegExp;
  const textPattern = isRegex ? expectedText.source : expectedText;
  const flags = isRegex ? expectedText.flags : '';

  while (Date.now() - startTime < timeout) {
    try {
      const { result } = await Runtime.evaluate({
        expression: `
          (() => {
            const element = document.querySelector('${selector.replace(/'/g, "\\'")}');
            if (!element) return false;
            const text = element.textContent || element.innerText || '';
            ${isRegex 
              ? `return new RegExp('${textPattern}', '${flags}').test(text);`
              : `return text.includes('${textPattern.replace(/'/g, "\\'")}');`
            }
          })()
        `,
        returnByValue: true,
      });

      if (result.value === true) {
        return;
      }
    } catch (err) {
      // Continue polling
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Timeout waiting for text "${expectedText}" in selector: ${selector}`);
}

/**
 * Wait for a condition to be true
 * 
 * @param {Function} condition - Async function that returns boolean
 * @param {Object} options
 * @returns {Promise<void>}
 */
export async function waitForCondition(condition, options = {}) {
  const {
    timeout = 10000,
    pollInterval = 100,
  } = options;

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await condition();
    if (result) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Timeout waiting for condition (${timeout}ms)`);
}

/**
 * Click an element
 * 
 * @param {Object} cdpClient - CDP client
 * @param {string} selector - CSS selector
 */
export async function clickElement(cdpClient, selector) {
  await waitForSelector(cdpClient, selector, { visible: true });
  
  const { Runtime } = cdpClient;
  await Runtime.evaluate({
    expression: `
      (() => {
        const element = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (element) element.click();
      })()
    `,
  });
}

/**
 * Get element text content
 * 
 * @param {Object} cdpClient - CDP client
 * @param {string} selector - CSS selector
 * @returns {Promise<string>}
 */
export async function getElementText(cdpClient, selector) {
  const { Runtime } = cdpClient;
  const { result } = await Runtime.evaluate({
    expression: `
      (() => {
        const element = document.querySelector('${selector.replace(/'/g, "\\'")}');
        return element ? (element.textContent || element.innerText || '') : '';
      })()
    `,
    returnByValue: true,
  });
  return result.value || '';
}

/**
 * Get element attribute
 * 
 * @param {Object} cdpClient - CDP client
 * @param {string} selector - CSS selector
 * @param {string} attribute - Attribute name
 * @returns {Promise<string|null>}
 */
export async function getElementAttribute(cdpClient, selector, attribute) {
  const { Runtime } = cdpClient;
  const { result } = await Runtime.evaluate({
    expression: `
      (() => {
        const element = document.querySelector('${selector.replace(/'/g, "\\'")}');
        return element ? element.getAttribute('${attribute.replace(/'/g, "\\'")}') : null;
      })()
    `,
    returnByValue: true,
  });
  return result.value;
}

/**
 * Navigate to a URL
 * 
 * @param {Object} cdpClient - CDP client
 * @param {string} url - Target URL
 */
export async function navigate(cdpClient, url) {
  const { Page } = cdpClient;
  await Page.navigate({ url });
  await Page.loadEventFired();
}

/**
 * Get badge selector (more specific to avoid ambiguity)
 * 
 * @returns {string}
 */
/**
 * Get specific badge selector (avoids ambiguity with multiple spans)
 * @returns {string} - CSS selector for sync badge
 */
export function getBadgeSelector() {
  return 'nav a[href="/settings/sync"] > span:first-of-type';
}

/**
 * Wait for condition to be true with polling
 * @param {Function} conditionFn - Async function that returns boolean
 * @param {Object} options - { timeout: 5000, interval: 500 }
 * @returns {Promise<void>}
 */
export async function waitForCondition(conditionFn, options = {}) {
  const timeout = options.timeout || 5000;
  const interval = options.interval || 500;
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const result = await conditionFn();
    if (result) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  
  throw new Error(`Condition not met within ${timeout}ms`);
}
