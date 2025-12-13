/**
 * DevicesPanel.tsx
 * 
 * Expanded device management panel
 * 
 * Features:
 * - Device roster with expanded details
 * - Rotation history diff view
 * - Sync alignment visualization
 * - Conflict warnings
 * - Activity timeline
 * 
 * Usage:
 *   import DevicesPanel from '@/app/settings/sync/DevicesPanel';
 *   <DevicesPanel devices={devices} currentDeviceId={deviceId} />
 */

'use client';

import React, { useState } from 'react';

// ===========================
// TYPES
// ===========================

interface BiometricProfile {
  fingerprintEnrolled: boolean;
  faceIdEnrolled: boolean;
  touchIdEnrolled: boolean;
}

interface DeviceRecord {
  deviceId: string;
  deviceName: string;
  platform: string;
  lastActivity: number;
  rotationCount: number;
  syncCount: number;
  biometricProfile?: BiometricProfile;
}

interface DevicesPanelProps {
  devices: DeviceRecord[];
  currentDeviceId: string;
}

// ===========================
// MAIN COMPONENT
// ===========================

export default function DevicesPanel({ devices, currentDeviceId }: DevicesPanelProps) {
  const [expandedDeviceId, setExpandedDeviceId] = useState<string | null>(null);

  // Sort devices: current device first, then by last activity
  const sortedDevices = [...devices].sort((a, b) => {
    if (a.deviceId === currentDeviceId) return -1;
    if (b.deviceId === currentDeviceId) return 1;
    return b.lastActivity - a.lastActivity;
  });

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Device Management</h2>
      
      <p className="text-gray-600">
        {devices.length} device{devices.length !== 1 ? 's' : ''} synced
      </p>

      <div className="space-y-3">
        {sortedDevices.map((device) => (
          <DeviceCard
            key={device.deviceId}
            device={device}
            isCurrent={device.deviceId === currentDeviceId}
            isExpanded={expandedDeviceId === device.deviceId}
            onToggleExpand={() => {
              setExpandedDeviceId(
                expandedDeviceId === device.deviceId ? null : device.deviceId
              );
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ===========================
// DEVICE CARD
// ===========================

interface DeviceCardProps {
  device: DeviceRecord;
  isCurrent: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

function DeviceCard({ device, isCurrent, isExpanded, onToggleExpand }: DeviceCardProps) {
  const activityStatus = getActivityStatus(device.lastActivity);
  const syncHealth = getSyncHealth(device);

  return (
    <div
      className={`border rounded-lg p-4 ${
        isCurrent ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-lg">{device.deviceName}</h3>
            {isCurrent && (
              <span className="px-2 py-1 text-xs bg-blue-600 text-white rounded-full">
                Current Device
              </span>
            )}
          </div>
          
          <p className="text-sm text-gray-600 mt-1">
            {formatPlatform(device.platform)} • {device.deviceId.slice(0, 8)}...
          </p>
          
          <div className="flex items-center gap-4 mt-2 text-sm">
            <span className={activityStatus.color}>
              {activityStatus.icon} {activityStatus.label}
            </span>
            
            <span className="text-gray-600">
              {device.rotationCount} rotations
            </span>
            
            <span className="text-gray-600">
              {device.syncCount} syncs
            </span>
          </div>
        </div>
        
        <button
          onClick={onToggleExpand}
          className="text-2xl hover:bg-gray-200 rounded px-2"
        >
          {isExpanded ? '▼' : '▶'}
        </button>
      </div>

      {/* Sync Health Indicator */}
      {syncHealth.warning && (
        <div className="mt-3 p-3 bg-yellow-100 border border-yellow-400 rounded-lg">
          <p className="text-sm font-medium text-yellow-800">
            ⚠️ {syncHealth.warning}
          </p>
        </div>
      )}

      {/* Expanded Details */}
      {isExpanded && (
        <div className="mt-4 pt-4 border-t space-y-4">
          {/* Biometric Profile */}
          {device.biometricProfile && (
            <div>
              <h4 className="font-semibold mb-2">Biometric Profile</h4>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <BiometricBadge
                  label="Fingerprint"
                  enrolled={device.biometricProfile.fingerprintEnrolled}
                />
                <BiometricBadge
                  label="Face ID"
                  enrolled={device.biometricProfile.faceIdEnrolled}
                />
                <BiometricBadge
                  label="Touch ID"
                  enrolled={device.biometricProfile.touchIdEnrolled}
                />
              </div>
            </div>
          )}

          {/* Activity Timeline */}
          <div>
            <h4 className="font-semibold mb-2">Activity Timeline</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Last Activity:</span>
                <span className="font-medium">{formatTimestamp(device.lastActivity)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Days Since Last Sync:</span>
                <span className="font-medium">{getDaysSince(device.lastActivity)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Total Rotations:</span>
                <span className="font-medium">{device.rotationCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Total Syncs:</span>
                <span className="font-medium">{device.syncCount}</span>
              </div>
            </div>
          </div>

          {/* Sync Alignment */}
          <div>
            <h4 className="font-semibold mb-2">Sync Alignment</h4>
            <div className="relative">
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500"
                  style={{ width: `${Math.min(100, (device.syncCount / (device.rotationCount || 1)) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-gray-600 mt-1">
                {device.syncCount} syncs / {device.rotationCount} rotations
              </p>
            </div>
          </div>

          {/* Device ID (Full) */}
          <div>
            <h4 className="font-semibold mb-2">Device ID</h4>
            <code className="block p-2 bg-gray-100 rounded text-xs font-mono break-all">
              {device.deviceId}
            </code>
          </div>
        </div>
      )}
    </div>
  );
}

// ===========================
// BIOMETRIC BADGE
// ===========================

function BiometricBadge({ label, enrolled }: { label: string; enrolled: boolean }) {
  return (
    <div
      className={`px-2 py-1 rounded text-center ${
        enrolled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
      }`}
    >
      <span className="text-xs font-medium">
        {enrolled ? '✅' : '—'} {label}
      </span>
    </div>
  );
}

// ===========================
// HELPER FUNCTIONS
// ===========================

function formatTimestamp(timestamp: number): string {
  if (!timestamp) return 'Never';
  const date = new Date(timestamp);
  return date.toLocaleString();
}

function formatPlatform(platform: string): string {
  const platformMap: Record<string, string> = {
    darwin: 'macOS',
    win32: 'Windows',
    linux: 'Linux',
    android: 'Android',
    ios: 'iOS',
  };
  return platformMap[platform] || platform;
}

function getDaysSince(timestamp: number): string {
  if (!timestamp) return 'Never';
  const days = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function getActivityStatus(lastActivity: number): {
  icon: string;
  label: string;
  color: string;
} {
  const daysSince = Math.floor((Date.now() - lastActivity) / (1000 * 60 * 60 * 24));
  
  if (daysSince === 0) {
    return { icon: '🟢', label: 'Active today', color: 'text-green-600' };
  } else if (daysSince <= 7) {
    return { icon: '🟡', label: 'Active this week', color: 'text-yellow-600' };
  } else if (daysSince <= 30) {
    return { icon: '🟠', label: 'Active this month', color: 'text-orange-600' };
  } else {
    return { icon: '🔴', label: 'Inactive', color: 'text-red-600' };
  }
}

function getSyncHealth(device: DeviceRecord): {
  warning?: string;
} {
  const daysSince = Math.floor((Date.now() - device.lastActivity) / (1000 * 60 * 60 * 24));
  
  // Warn if device hasn't synced in 30+ days
  if (daysSince >= 30) {
    return {
      warning: `No activity in ${daysSince} days. Device may be out of sync.`,
    };
  }
  
  // Warn if rotation count is high but sync count is low
  const syncRatio = device.syncCount / (device.rotationCount || 1);
  if (device.rotationCount > 5 && syncRatio < 0.3) {
    return {
      warning: `Low sync ratio (${Math.round(syncRatio * 100)}%). Consider syncing more frequently.`,
    };
  }
  
  return {};
}
