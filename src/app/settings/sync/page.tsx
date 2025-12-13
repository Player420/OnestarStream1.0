'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ExportFlow from './ExportFlow';
import ImportFlow from './ImportFlow';
import DevicesPanel from './DevicesPanel';
import { useBackgroundSync } from '@/lib/BackgroundSyncProvider';
import { formatRelativeTime, formatAbsoluteTime } from '@/lib/timeUtils';

// Phase 21 sync API types
interface SyncStatus {
  lastSyncedAt: number;
  totalSyncOperations: number;
  deviceId: string;
  deviceName: string;
  currentKeypairRotatedAt?: number;
  previousKeypairsCount: number;
  needsSync: boolean;
}

interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  platform: string;
  deviceCreatedAt: number;
  lastSyncedAt: number;
  currentKeypairRotatedAt?: number;
  previousKeypairsCount: number;
  biometricProfile?: {
    enabled: boolean;
    biometricType?: string;
  };
  vaultSettings?: {
    autoLockEnabled: boolean;
    requirePasswordForExport: boolean;
  };
}

interface DeviceRecord {
  deviceId: string;
  deviceName: string;
  platform: string;
  firstSeen: number;
  lastActivity: number;
  rotationCount: number;
  syncCount: number;
}

type LoadState = 'idle' | 'loading' | 'success' | 'error';

type ActiveFlow = 'none' | 'export' | 'import';
type ActiveTab = 'overview' | 'devices' | 'scheduler';

export default function SyncSettingsPage() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [activeFlow, setActiveFlow] = useState<ActiveFlow>('none');
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');

  // Phase 23: Background sync scheduler context
  const {
    syncStatus: schedulerStatus,
    nextRun,
    lastRun,
    lastResult,
    errorMessage: schedulerError,
    healthReport,
    startScheduler,
    stopScheduler,
    refreshStatus,
  } = useBackgroundSync();

  // Load sync data on mount
  useEffect(() => {
    loadSyncData();
  }, []);

  async function loadSyncData() {
    setLoadState('loading');
    setError(null);

    try {
      // Type assertion for Phase 21 sync APIs
      const syncAPI = (window as any).onestar?.sync;
      if (!syncAPI) {
        throw new Error('Sync API not available');
      }

      const [status, info, deviceList] = await Promise.all([
        syncAPI.getSyncStatus(),
        syncAPI.getDeviceInfo(),
        syncAPI.listSyncedDevices(),
      ]);

      setSyncStatus(status);
      setDeviceInfo(info);
      setDevices(deviceList);
      setLoadState('success');
    } catch (err) {
      console.error('Failed to load sync data:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoadState('error');
    }
  }

  async function handleRunSyncNow() {
    try {
      await startScheduler();
      await refreshStatus();
    } catch (err) {
      console.error('Failed to start scheduler:', err);
    }
  }

  function formatTimestamp(ts: number): string {
    return new Date(ts).toLocaleString();
  }

  function formatPlatform(platform: string): string {
    const platformMap: Record<string, string> = {
      darwin: 'macOS',
      win32: 'Windows',
      linux: 'Linux',
    };
    return platformMap[platform] || platform;
  }

  function getDaysSince(timestamp: number): number {
    return Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
  }

  // Loading state
  if (loadState === 'loading') {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Sync Settings</h1>
        <div className="bg-blue-50 border border-blue-200 rounded p-4">
          <p className="text-blue-800">Loading sync data...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (loadState === 'error') {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Sync Settings</h1>
        <div className="bg-red-50 border border-red-200 rounded p-4 mb-4">
          <p className="text-red-800 font-semibold">Error loading sync data</p>
          <p className="text-red-600 text-sm mt-2">{error}</p>
        </div>
        <button
          onClick={loadSyncData}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  const daysSinceSync = syncStatus ? getDaysSince(syncStatus.lastSyncedAt) : 0;

  // Show export flow
  if (activeFlow === 'export') {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <ExportFlow
          onSuccess={() => {
            setActiveFlow('none');
            loadSyncData(); // Refresh after export
          }}
          onCancel={() => setActiveFlow('none')}
        />
      </div>
    );
  }

  // Show import flow
  if (activeFlow === 'import') {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <ImportFlow
          onSuccess={() => {
            setActiveFlow('none');
            loadSyncData(); // Refresh after import
          }}
          onCancel={() => setActiveFlow('none')}
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Cross-Device Sync</h1>
        <Link
          href="/app"
          className="text-blue-600 hover:text-blue-800 text-sm"
        >
          ← Back to App
        </Link>
      </div>

      {/* Sync Status Alert */}
      {syncStatus?.needsSync && (
        <div className="bg-yellow-50 border border-yellow-300 rounded p-4 mb-6">
          <div className="flex items-start">
            <span className="text-yellow-600 text-2xl mr-3">⚠️</span>
            <div>
              <p className="font-semibold text-yellow-800">Sync Needed</p>
              <p className="text-yellow-700 text-sm mt-1">
                Your devices are out of sync. Last sync was {daysSinceSync} days ago.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-2 mb-6 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2 font-medium ${
            activeTab === 'overview'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('devices')}
          className={`px-4 py-2 font-medium ${
            activeTab === 'devices'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          Devices ({devices.length})
        </button>
        <button
          onClick={() => setActiveTab('scheduler')}
          className={`px-4 py-2 font-medium ${
            activeTab === 'scheduler'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          Scheduler
        </button>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <>
      {/* Device Info Card */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">This Device</h2>
        
        {deviceInfo && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-gray-500">Device Name</p>
                <p className="font-medium">{deviceInfo.deviceName}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Platform</p>
                <p className="font-medium">{formatPlatform(deviceInfo.platform)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Device ID</p>
                <p className="font-mono text-xs">{deviceInfo.deviceId.slice(0, 12)}...</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 pt-3 border-t">
              <div>
                <p className="text-sm text-gray-500">Last Sync</p>
                <p className="font-medium text-sm">
                  {daysSinceSync === 0 ? 'Today' : `${daysSinceSync}d ago`}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Total Syncs</p>
                <p className="font-medium">{syncStatus?.totalSyncOperations || 0}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Keypairs Stored</p>
                <p className="font-medium">{deviceInfo.previousKeypairsCount + 1}</p>
              </div>
            </div>

            {deviceInfo.biometricProfile?.enabled && (
              <div className="pt-3 border-t">
                <p className="text-sm text-gray-500">Security</p>
                <p className="font-medium text-sm">
                  🔐 {deviceInfo.biometricProfile.biometricType || 'Biometric'} Enabled
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Sync Actions</h2>
        
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => setActiveFlow('export')}
            className="px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            📤 Export Keystore
          </button>
          
          <button
            onClick={() => setActiveFlow('import')}
            className="px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
          >
            📥 Import Keystore
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 mt-4">
          <button
            onClick={() => setShowDebug(!showDebug)}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 text-sm"
          >
            {showDebug ? '🔽' : '▶️'} Debug Info
          </button>
          
          <button
            onClick={loadSyncData}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 text-sm"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Device Roster */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Synced Devices ({devices.length})</h2>
        
        {devices.length === 0 ? (
          <p className="text-gray-500 text-sm">
            No synced devices yet. Export your keystore to another device to get started.
          </p>
        ) : (
          <div className="space-y-3">
            {devices.map((device) => {
              const isCurrentDevice = device.deviceId === deviceInfo?.deviceId;
              const daysSinceActivity = getDaysSince(device.lastActivity);
              
              return (
                <div
                  key={device.deviceId}
                  className={`border rounded p-4 ${
                    isCurrentDevice ? 'bg-blue-50 border-blue-200' : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">
                          {device.deviceName}
                          {isCurrentDevice && (
                            <span className="ml-2 text-xs bg-blue-600 text-white px-2 py-0.5 rounded">
                              This Device
                            </span>
                          )}
                        </p>
                      </div>
                      <p className="text-sm text-gray-500 mt-1">
                        {formatPlatform(device.platform)} • 
                        Last active {daysSinceActivity === 0 ? 'today' : `${daysSinceActivity}d ago`}
                      </p>
                    </div>
                    <div className="text-right text-sm">
                      <p className="text-gray-600">
                        <span className="font-medium">{device.rotationCount}</span> rotations
                      </p>
                      <p className="text-gray-600">
                        <span className="font-medium">{device.syncCount}</span> syncs
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Debug Panel */}
      {showDebug && (
        <div className="bg-gray-50 border border-gray-300 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Debug Information</h2>
          
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Sync Status</p>
              <pre className="bg-white p-3 rounded border text-xs overflow-x-auto">
                {JSON.stringify(syncStatus, null, 2)}
              </pre>
            </div>
            
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Device Info</p>
              <pre className="bg-white p-3 rounded border text-xs overflow-x-auto">
                {JSON.stringify(deviceInfo, null, 2)}
              </pre>
            </div>
            
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Device Roster</p>
              <pre className="bg-white p-3 rounded border text-xs overflow-x-auto">
                {JSON.stringify(devices, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
        </>
      )}

      {/* Devices Tab */}
      {activeTab === 'devices' && deviceInfo && (
        <DevicesPanel devices={devices} currentDeviceId={deviceInfo.deviceId} />
      )}

      {/* Scheduler Tab (Phase 23) */}
      {activeTab === 'scheduler' && (
        <>
          {/* Scheduler Status Card */}
          <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4">Background Scheduler Status</h2>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Status</p>
                  <p className="font-medium text-lg capitalize flex items-center gap-2">
                    {schedulerStatus === 'up-to-date' && <span className="text-green-600">✓ Up to Date</span>}
                    {schedulerStatus === 'needs-sync' && <span className="text-red-600">! Needs Sync</span>}
                    {schedulerStatus === 'syncing' && <span className="text-yellow-600">↻ Checking...</span>}
                    {schedulerStatus === 'error' && <span className="text-red-600">✕ Error</span>}
                    {schedulerStatus === 'idle' && <span className="text-gray-600">· Idle</span>}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Next Check</p>
                  <p className="font-medium">
                    {nextRun ? formatRelativeTime(nextRun) : 'Not scheduled'}
                  </p>
                  {nextRun && (
                    <p className="text-xs text-gray-500">
                      {formatAbsoluteTime(nextRun)}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-3 border-t">
                <div>
                  <p className="text-sm text-gray-500">Last Check</p>
                  <p className="font-medium">
                    {lastRun ? formatRelativeTime(lastRun) : 'Never'}
                  </p>
                  {lastRun && (
                    <p className="text-xs text-gray-500">
                      {formatAbsoluteTime(lastRun)}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-sm text-gray-500">Last Result</p>
                  <p className="font-medium capitalize">
                    {lastResult || 'N/A'}
                  </p>
                </div>
              </div>

              {schedulerError && (
                <div className="bg-red-50 border border-red-200 rounded p-3">
                  <p className="text-sm text-red-800 font-semibold">Error</p>
                  <p className="text-sm text-red-600 mt-1">{schedulerError}</p>
                </div>
              )}
            </div>
          </div>

          {/* Scheduler Health Report */}
          {healthReport && (
            <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
              <h2 className="text-lg font-semibold mb-4">Sync Health Report</h2>
              
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Needs Sync</p>
                    <p className="font-medium text-lg">
                      {healthReport.needsSync ? (
                        <span className="text-red-600">Yes</span>
                      ) : (
                        <span className="text-green-600">No</span>
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Days Since Sync</p>
                    <p className="font-medium text-lg">{healthReport.daysSinceLastSync}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Device Count</p>
                    <p className="font-medium text-lg">{healthReport.deviceCount}</p>
                  </div>
                </div>

                {healthReport.alignment && (
                  <div className="pt-3 border-t">
                    <p className="text-sm font-semibold text-gray-700 mb-2">Device Alignment</p>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-gray-500">In Sync ({healthReport.alignment.devicesInSync.length})</p>
                        <p className="text-sm text-green-600 font-medium">
                          {healthReport.alignment.devicesInSync.join(', ') || 'None'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Out of Sync ({healthReport.alignment.devicesOutOfSync.length})</p>
                        <p className="text-sm text-red-600 font-medium">
                          {healthReport.alignment.devicesOutOfSync.join(', ') || 'None'}
                        </p>
                      </div>
                    </div>
                    {healthReport.alignment.missingRotations > 0 && (
                      <p className="text-sm text-yellow-600 mt-2">
                        ⚠️ {healthReport.alignment.missingRotations} rotation(s) missing
                      </p>
                    )}
                  </div>
                )}

                {healthReport.warnings && healthReport.warnings.length > 0 && (
                  <div className="pt-3 border-t">
                    <p className="text-sm font-semibold text-gray-700 mb-2">
                      Warnings ({healthReport.warnings.length})
                    </p>
                    <div className="space-y-2">
                      {healthReport.warnings.map((warning, idx) => (
                        <div
                          key={idx}
                          className={`border rounded p-3 ${
                            warning.severity === 'critical'
                              ? 'bg-red-50 border-red-200'
                              : warning.severity === 'warning'
                              ? 'bg-yellow-50 border-yellow-200'
                              : 'bg-blue-50 border-blue-200'
                          }`}
                        >
                          <p className="text-sm font-medium">
                            {warning.severity === 'critical' && '🔴 '}
                            {warning.severity === 'warning' && '⚠️ '}
                            {warning.severity === 'info' && 'ℹ️ '}
                            {warning.message}
                          </p>
                          {warning.recommendedAction && (
                            <p className="text-xs text-gray-600 mt-1">
                              → {warning.recommendedAction}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {healthReport.recommendation && (
                  <div className="pt-3 border-t">
                    <p className="text-sm font-semibold text-gray-700 mb-2">Recommendation</p>
                    <div className="bg-blue-50 border border-blue-200 rounded p-3">
                      <p className="text-sm font-medium text-blue-800 capitalize">
                        {healthReport.recommendation.action.replace('-', ' ')}
                      </p>
                      <p className="text-sm text-blue-600 mt-1">
                        {healthReport.recommendation.reason}
                      </p>
                      {healthReport.recommendation.details && (
                        <p className="text-xs text-blue-500 mt-2">
                          {healthReport.recommendation.details}
                        </p>
                      )}
                      <p className="text-xs text-gray-500 mt-2">
                        Priority: <span className="font-medium">{healthReport.recommendation.priority}</span>
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Scheduler Actions */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Scheduler Actions</h2>
            
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={handleRunSyncNow}
                className="px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                disabled={schedulerStatus === 'syncing'}
              >
                {schedulerStatus === 'syncing' ? '↻ Checking...' : '▶️ Run Check Now'}
              </button>
              
              <button
                onClick={refreshStatus}
                className="px-4 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium"
              >
                🔄 Refresh Status
              </button>
            </div>

            <p className="text-sm text-gray-500 mt-4">
              The scheduler automatically checks sync status every 6 hours. 
              You can manually trigger a check using the button above.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
