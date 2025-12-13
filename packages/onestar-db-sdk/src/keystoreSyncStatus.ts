/**
 * Keystore Sync Status Engine (Phase 21)
 * 
 * PURPOSE:
 * - Detect when devices are out of sync (missing rotations, stale keypairs)
 * - Validate sync alignment across devices
 * - Generate sync warnings and recommendations
 * - Provide "needs sync" indicators for UI
 * 
 * SECURITY:
 * - Read-only operations (never modifies keystore)
 * - No cryptographic operations (status checks only)
 * - Safe for frequent polling (< 10ms response time)
 */

import type { EncryptedKeystoreV4, SyncRecord, DeviceRecord as DeviceMetadata } from './keystoreV4';
import { loadKeystoreV4 } from './keystoreV4';

// Helper to extract public key from encrypted keypair
function extractPublicKeyFromEncrypted(encryptedKeypair: string): string {
  try {
    const parsed = JSON.parse(encryptedKeypair);
    return parsed.publicKey || '';
  } catch {
    return '';
  }
}

/**
 * Sync alignment result.
 */
export interface SyncAlignment {
  aligned: boolean;
  currentKeypairPublicKey: string;
  devicesInSync: string[];
  devicesOutOfSync: string[];
  missingRotations: number;
  staleDays: number;
}

/**
 * Sync warning.
 */
export interface SyncWarning {
  severity: 'critical' | 'warning' | 'info';
  message: string;
  deviceId?: string;
  deviceName?: string;
  daysSinceSync?: number;
  missingRotations?: number;
  recommendedAction?: string;
}

/**
 * Sync recommendation.
 */
export interface SyncRecommendation {
  action: 'export' | 'import' | 'no-action-needed';
  reason: string;
  sourceDevice?: string;
  targetDevice?: string;
  priority: 'high' | 'medium' | 'low';
  details?: string;
}

/**
 * Sync need detection result.
 */
export interface SyncNeedResult {
  needsSync: boolean;
  reason?: string;
  daysSinceLastSync?: number;
  rotationsMissing?: number;
  alignment?: SyncAlignment;
}

/**
 * Detect if keystore needs sync with other devices.
 * 
 * LOGIC:
 * 1. Load current keystore v4
 * 2. Extract device metadata (deviceId, lastSyncedAt)
 * 3. Check if never synced (lastSyncedAt === deviceCreatedAt)
 * 4. Check sync staleness (> 30 days since last sync)
 * 5. Check rotation count mismatch (other devices have more rotations)
 * 6. Return need result with reason
 * 
 * @returns Sync need detection result
 */
export async function detectSyncNeeded(): Promise<SyncNeedResult> {
  const keystore = await loadKeystoreV4() as EncryptedKeystoreV4 | null;
  
  if (!keystore) {
    return {
      needsSync: false,
      reason: 'No keystore found (vault locked or not initialized)',
    };
  }
  
  if (keystore.version !== 'v4') {
    return {
      needsSync: false,
      reason: 'Keystore not v4 (sync requires v4 schema)',
    };
  }
  
  const now = Date.now();
  const deviceCreatedAt = keystore.deviceCreatedAt || now;
  const lastSyncedAt = keystore.lastSyncedAt || deviceCreatedAt;
  const daysSinceLastSync = Math.floor((now - lastSyncedAt) / (1000 * 60 * 60 * 24));
  
  // Check 1: Never synced (lastSyncedAt === deviceCreatedAt)
  if (lastSyncedAt === deviceCreatedAt && keystore.syncHistory && keystore.syncHistory.length === 0) {
    return {
      needsSync: true,
      reason: 'Device has never synced with other devices',
      daysSinceLastSync: 0,
    };
  }
  
  // Check 2: Sync staleness (> 30 days)
  if (daysSinceLastSync > 30) {
    return {
      needsSync: true,
      reason: `Sync is stale (${daysSinceLastSync} days since last sync)`,
      daysSinceLastSync,
    };
  }
  
  // Check 3: Rotation count mismatch (check sync history for device rotation counts)
  const alignment = await validateSyncAlignment();
  if (!alignment.aligned) {
    return {
      needsSync: true,
      reason: `Devices out of sync (${alignment.devicesOutOfSync.length} devices missing ${alignment.missingRotations} rotations)`,
      daysSinceLastSync,
      rotationsMissing: alignment.missingRotations,
      alignment,
    };
  }
  
  // All checks passed
  return {
    needsSync: false,
    reason: 'All devices in sync',
    daysSinceLastSync,
  };
}

/**
 * Validate if all devices have the same current keypair.
 * 
 * LOGIC:
 * 1. Load current keystore v4
 * 2. Extract current keypair public key
 * 3. Scan rotation history for device IDs
 * 4. For each device: check if their last rotation matches current keypair
 * 5. Count devices in sync vs out of sync
 * 6. Calculate staleness (days since oldest device's last sync)
 * 
 * @returns Sync alignment result
 */
export async function validateSyncAlignment(): Promise<SyncAlignment> {
  const keystore = await loadKeystoreV4() as EncryptedKeystoreV4 | null;
  
  if (!keystore || keystore.version !== 'v4') {
    return {
      aligned: false,
      currentKeypairPublicKey: '',
      devicesInSync: [],
      devicesOutOfSync: [],
      missingRotations: 0,
      staleDays: 0,
    };
  }
  
  // Extract current keypair public key
  const currentPublicKey = keystore.encryptedCurrentKeypair
    ? extractPublicKeyFromEncrypted(keystore.encryptedCurrentKeypair)
    : '';
  
  if (!currentPublicKey) {
    return {
      aligned: false,
      currentKeypairPublicKey: '',
      devicesInSync: [],
      devicesOutOfSync: [],
      missingRotations: 0,
      staleDays: 0,
    };
  }
  
  // Build device map from rotation + sync history
  const deviceMap = new Map<string, DeviceMetadata>();
  const now = Date.now();
  
  // Add current device
  deviceMap.set(keystore.deviceId, {
    deviceId: keystore.deviceId,
    deviceName: keystore.deviceName || 'Unknown Device',
    platform: keystore.platform || process.platform,
    firstSeen: keystore.deviceCreatedAt || now,
    lastActivity: keystore.lastSyncedAt || keystore.deviceCreatedAt || now,
    rotationCount: 0,
    syncCount: 0,
  });
  
  // Scan rotation history
  if (keystore.rotationHistory) {
    for (const entry of keystore.rotationHistory) {
      if (entry.deviceId && entry.deviceName) {
        if (!deviceMap.has(entry.deviceId)) {
          deviceMap.set(entry.deviceId, {
            deviceId: entry.deviceId,
            deviceName: entry.deviceName,
            platform: entry.platform || 'unknown',
            firstSeen: entry.timestamp || now,
            lastActivity: entry.timestamp || now,
            rotationCount: 0,
            syncCount: 0,
          });
        }
        const device = deviceMap.get(entry.deviceId)!;
        device.rotationCount++;
        device.lastActivity = Math.max(device.lastActivity, entry.timestamp || now);
      }
    }
  }
  
  // Scan sync history
  if (keystore.syncHistory) {
    for (const sync of keystore.syncHistory) {
      if (sync.sourceDeviceId && sync.sourceDeviceName) {
        if (!deviceMap.has(sync.sourceDeviceId)) {
          deviceMap.set(sync.sourceDeviceId, {
            deviceId: sync.sourceDeviceId,
            deviceName: sync.sourceDeviceName,
            platform: sync.sourcePlatform || 'unknown',
            firstSeen: sync.syncedAt || sync.timestamp || now,
            lastActivity: sync.syncedAt || sync.timestamp || now,
            rotationCount: 0,
            syncCount: 0,
          });
        }
        const device = deviceMap.get(sync.sourceDeviceId)!;
        device.syncCount++;
        device.lastActivity = Math.max(device.lastActivity, sync.syncedAt || sync.timestamp || now);
      }
    }
  }
  
  // Check alignment: all devices should have rotation count equal to current device
  const currentDevice = deviceMap.get(keystore.deviceId)!;
  const currentRotationCount = (keystore.rotationHistory || []).length;
  
  const devicesInSync: string[] = [];
  const devicesOutOfSync: string[] = [];
  let maxMissingRotations = 0;
  let oldestDeviceActivity = now;
  
  for (const [deviceId, device] of deviceMap.entries()) {
    if (deviceId === keystore.deviceId) {
      devicesInSync.push(`${device.deviceName} (this device)`);
      continue;
    }
    
    // Check if device has same rotation count
    if (device.rotationCount >= currentRotationCount) {
      devicesInSync.push(device.deviceName);
    } else {
      devicesOutOfSync.push(device.deviceName);
      const missing = currentRotationCount - device.rotationCount;
      maxMissingRotations = Math.max(maxMissingRotations, missing);
    }
    
    oldestDeviceActivity = Math.min(oldestDeviceActivity, device.lastActivity);
  }
  
  const staleDays = Math.floor((now - oldestDeviceActivity) / (1000 * 60 * 60 * 24));
  
  return {
    aligned: devicesOutOfSync.length === 0,
    currentKeypairPublicKey: currentPublicKey,
    devicesInSync,
    devicesOutOfSync,
    missingRotations: maxMissingRotations,
    staleDays,
  };
}

/**
 * Generate sync warnings for UI display.
 * 
 * LOGIC:
 * 1. Check if never synced → INFO warning
 * 2. Check if sync stale (> 30 days) → WARNING
 * 3. Check if devices out of sync → WARNING/CRITICAL
 * 4. Check if device has no backups → INFO
 * 5. Return array of warnings
 * 
 * @returns Array of sync warnings
 */
export async function generateSyncWarnings(): Promise<SyncWarning[]> {
  const warnings: SyncWarning[] = [];
  const keystore = await loadKeystoreV4() as EncryptedKeystoreV4 | null;
  
  if (!keystore || keystore.version !== 'v4') {
    return warnings;
  }
  
  const now = Date.now();
  const deviceCreatedAt = keystore.deviceCreatedAt || now;
  const lastSyncedAt = keystore.lastSyncedAt || deviceCreatedAt;
  const daysSinceLastSync = Math.floor((now - lastSyncedAt) / (1000 * 60 * 60 * 24));
  const syncHistory = keystore.syncHistory || [];
  
  // Warning 1: Never synced
  if (syncHistory.length === 0 && lastSyncedAt === deviceCreatedAt) {
    warnings.push({
      severity: 'info',
      message: 'This device has never synced with other devices. Consider exporting your keystore to back up your identity.',
      deviceId: keystore.deviceId,
      deviceName: keystore.deviceName || 'This Device',
      daysSinceSync: 0,
      recommendedAction: 'Export keystore to another device',
    });
  }
  
  // Warning 2: Sync stale (> 30 days)
  if (daysSinceLastSync > 30 && syncHistory.length > 0) {
    warnings.push({
      severity: 'warning',
      message: `Keystore sync is stale (${daysSinceLastSync} days since last sync). Sync with other devices to ensure backup.`,
      deviceId: keystore.deviceId,
      deviceName: keystore.deviceName || 'This Device',
      daysSinceSync: daysSinceLastSync,
      recommendedAction: 'Export and sync with another device',
    });
  }
  
  // Warning 3: Devices out of sync
  const alignment = await validateSyncAlignment();
  if (!alignment.aligned && alignment.devicesOutOfSync.length > 0) {
    const severity = alignment.missingRotations >= 3 ? 'critical' : 'warning';
    warnings.push({
      severity,
      message: `${alignment.devicesOutOfSync.length} device(s) are out of sync (missing ${alignment.missingRotations} rotations): ${alignment.devicesOutOfSync.join(', ')}`,
      missingRotations: alignment.missingRotations,
      recommendedAction: 'Import keystore from newest device',
    });
  }
  
  // Warning 4: Rotation count high, no recent sync
  const rotationCount = (keystore.rotationHistory || []).length;
  if (rotationCount >= 5 && daysSinceLastSync > 90) {
    warnings.push({
      severity: 'warning',
      message: `You have ${rotationCount} keypair rotations but haven't synced in ${daysSinceLastSync} days. Other devices may be missing recent keys.`,
      deviceId: keystore.deviceId,
      deviceName: keystore.deviceName || 'This Device',
      daysSinceSync: daysSinceLastSync,
      recommendedAction: 'Export keystore to update other devices',
    });
  }
  
  // Warning 5: Only one device (no backups)
  if (syncHistory.length === 0 && rotationCount >= 1) {
    warnings.push({
      severity: 'info',
      message: 'Your keystore is only on this device. Sync with another device to create a backup.',
      deviceId: keystore.deviceId,
      deviceName: keystore.deviceName || 'This Device',
      recommendedAction: 'Export keystore to a second device',
    });
  }
  
  return warnings;
}

/**
 * Get sync recommendation (which device should export/import).
 * 
 * LOGIC:
 * 1. Check if devices aligned → no action needed
 * 2. Check rotation counts: device with most rotations should export
 * 3. Check sync staleness: stale devices should import
 * 4. Return recommendation with priority
 * 
 * @returns Sync recommendation
 */
export async function generateSyncRecommendation(): Promise<SyncRecommendation> {
  const keystore = await loadKeystoreV4() as EncryptedKeystoreV4 | null;
  
  if (!keystore || keystore.version !== 'v4') {
    return {
      action: 'no-action-needed',
      reason: 'No keystore found or not v4 schema',
      priority: 'low',
    };
  }
  
  const alignment = await validateSyncAlignment();
  const now = Date.now();
  const lastSyncedAt = keystore.lastSyncedAt || keystore.deviceCreatedAt || now;
  const daysSinceLastSync = Math.floor((now - lastSyncedAt) / (1000 * 60 * 60 * 24));
  const rotationCount = (keystore.rotationHistory || []).length;
  const syncHistory = keystore.syncHistory || [];
  
  // Case 1: All devices aligned and sync recent
  if (alignment.aligned && daysSinceLastSync <= 30) {
    return {
      action: 'no-action-needed',
      reason: 'All devices are in sync and sync is recent',
      priority: 'low',
    };
  }
  
  // Case 2: Never synced (first-time setup)
  if (syncHistory.length === 0) {
    return {
      action: 'export',
      reason: 'First-time sync: Export keystore to another device to create backup',
      sourceDevice: keystore.deviceName || 'This Device',
      priority: 'high',
      details: 'This device has never synced. Export your keystore to back up your identity.',
    };
  }
  
  // Case 3: Devices out of sync (this device has more rotations)
  if (!alignment.aligned && alignment.devicesOutOfSync.length > 0) {
    // This device is ahead → should export
    return {
      action: 'export',
      reason: `This device has ${alignment.missingRotations} more rotations than other devices`,
      sourceDevice: keystore.deviceName || 'This Device',
      targetDevice: alignment.devicesOutOfSync[0],
      priority: alignment.missingRotations >= 3 ? 'high' : 'medium',
      details: `Export keystore from this device and import on: ${alignment.devicesOutOfSync.join(', ')}`,
    };
  }
  
  // Case 4: Sync stale (> 30 days) but aligned
  if (daysSinceLastSync > 30) {
    return {
      action: 'export',
      reason: `Sync is stale (${daysSinceLastSync} days since last sync)`,
      sourceDevice: keystore.deviceName || 'This Device',
      priority: daysSinceLastSync > 90 ? 'high' : 'medium',
      details: 'Export keystore to update other devices with recent activity',
    };
  }
  
  // Case 5: High rotation count, no recent sync
  if (rotationCount >= 5 && daysSinceLastSync > 60) {
    return {
      action: 'export',
      reason: `${rotationCount} rotations but no sync in ${daysSinceLastSync} days`,
      sourceDevice: keystore.deviceName || 'This Device',
      priority: 'medium',
      details: 'Export keystore to ensure other devices have recent keys',
    };
  }
  
  // Default: No action needed
  return {
    action: 'no-action-needed',
    reason: 'Sync is healthy',
    priority: 'low',
  };
}

/**
 * Get comprehensive sync health report.
 * 
 * @returns Sync health report with all status checks
 */
export interface SyncHealthReport {
  needsSync: boolean;
  alignment: SyncAlignment;
  warnings: SyncWarning[];
  recommendation: SyncRecommendation;
  deviceCount: number;
  lastSyncedAt: number;
  daysSinceLastSync: number;
}

export async function getSyncHealthReport(): Promise<SyncHealthReport> {
  const [needResult, alignment, warnings, recommendation] = await Promise.all([
    detectSyncNeeded(),
    validateSyncAlignment(),
    generateSyncWarnings(),
    generateSyncRecommendation(),
  ]);
  
  const keystore = await loadKeystoreV4() as EncryptedKeystoreV4 | null;
  const now = Date.now();
  const lastSyncedAt = keystore?.lastSyncedAt || keystore?.deviceCreatedAt || now;
  const daysSinceLastSync = Math.floor((now - lastSyncedAt) / (1000 * 60 * 60 * 24));
  const deviceCount = alignment.devicesInSync.length + alignment.devicesOutOfSync.length;
  
  return {
    needsSync: needResult.needsSync,
    alignment,
    warnings,
    recommendation,
    deviceCount,
    lastSyncedAt,
    daysSinceLastSync,
  };
}
