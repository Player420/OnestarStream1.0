#!/usr/bin/env node

/**
 * test-runner.js
 * 
 * Electron E2E test runner
 * 
 * Usage:
 *   node test-runner.js [test-pattern]
 *   npm run test:e2e
 */

import { readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildAll } from './helpers/buildApp.js';
import { launchElectron } from './helpers/launchElectron.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Test configuration
const TEST_DIR = __dirname;
const BUILD_SKIP = process.env.SKIP_BUILD === 'true';
const HEADLESS = process.env.HEADLESS !== 'false';

/**
 * Discover test files
 * 
 * @param {string} pattern - Glob pattern (optional)
 * @returns {Promise<string[]>}
 */
async function discoverTests(pattern = '*.test.mjs') {
  const files = await readdir(TEST_DIR);
  const testFiles = files.filter(file => {
    if (!file.endsWith('.test.mjs')) return false;
    if (pattern === '*.test.mjs') return true;
    return file.includes(pattern);
  });
  
  return testFiles.map(file => join(TEST_DIR, file));
}

/**
 * Run a single test file
 * 
 * @param {string} testFile - Path to test file
 * @param {Object} electronContext - Electron context (electronProcess, cdpClient, close)
 * @returns {Promise<{passed: boolean, error?: Error}>}
 */
async function runTest(testFile, electronContext) {
  const testName = testFile.split('/').pop();
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Running: ${testName}`);
  console.log('='.repeat(60));
  
  try {
    // Dynamic import test module
    const testModule = await import(testFile);
    
    // Execute test function
    if (typeof testModule.default === 'function') {
      await testModule.default(electronContext);
    } else if (typeof testModule.test === 'function') {
      await testModule.test(electronContext);
    } else {
      throw new Error('Test file must export default function or named export "test"');
    }
    
    console.log(`✅ PASSED: ${testName}`);
    return { passed: true };
  } catch (error) {
    console.error(`❌ FAILED: ${testName}`);
    console.error(error.stack || error.message);
    return { passed: false, error };
  }
}

/**
 * Main test runner
 */
async function main() {
  const args = process.argv.slice(2);
  const pattern = args[0] || '*.test.mjs';

  console.log('🚀 Electron E2E Test Runner');
  console.log('─'.repeat(60));

  // Step 1: Build application
  if (!BUILD_SKIP) {
    console.log('\n📦 Building application...');
    try {
      await buildAll();
    } catch (error) {
      console.error('❌ Build failed:', error.message);
      process.exit(1);
    }
  } else {
    console.log('\n⏭️  Skipping build (SKIP_BUILD=true)');
  }

  // Step 2: Discover test files
  console.log(`\n🔍 Discovering tests (pattern: ${pattern})...`);
  const testFiles = await discoverTests(pattern);
  
  if (testFiles.length === 0) {
    console.log('❌ No test files found');
    process.exit(1);
  }
  
  console.log(`Found ${testFiles.length} test(s):`);
  testFiles.forEach((file, idx) => {
    console.log(`  ${idx + 1}. ${file.split('/').pop()}`);
  });

  // Step 3: Launch Electron
  console.log('\n🖥️  Launching Electron...');
  let electronContext;
  try {
    electronContext = await launchElectron({ headless: HEADLESS });
  } catch (error) {
    console.error('❌ Failed to launch Electron:', error.message);
    process.exit(1);
  }

  // Step 4: Run tests
  const results = [];
  for (const testFile of testFiles) {
    const result = await runTest(testFile, electronContext);
    results.push(result);
  }

  // Step 5: Close Electron
  console.log('\n🛑 Shutting down Electron...');
  await electronContext.close();

  // Step 6: Print summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Summary');
  console.log('='.repeat(60));
  console.log(`Total:  ${results.length}`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ❌`);
  
  if (failed > 0) {
    console.log('\n❌ Some tests failed');
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
    process.exit(0);
  }
}

// Run tests
main().catch((error) => {
  console.error('❌ Test runner error:', error);
  process.exit(1);
});
