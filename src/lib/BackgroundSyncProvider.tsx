/**
 * BackgroundSyncProvider.tsx
 * 
 * Phase 23: React Context Provider for Electron Background Sync Scheduler
 * 
 * Features:
 * - Starts electron main process scheduler on mount via IPC
 * - Listens for 'sync:status-change' events from electron
 * - Provides sync status to React components
 * - Manages scheduler lifecycle (start/stop/refresh)
 * - Auto-cleanup on unmount
 * 
 * Architecture:
 * - Renderer process context (React)
 * - Calls window.onestar.syncScheduler.{start, stop, getNextRun}
 * - Listens via window.onestar.events.on('sync:status-change', handler)
 * - No client-side timer logic (handled by electron main process)
 * 
 * Usage:
 *   Wrap app in layout.tsx:
 *   <BackgroundSyncProvider>
 *     {children}
 *   </BackgroundSyncProvider>
 */

'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

// ===========================
// TYPES
// ===========================

export type SyncStatusState = 'idle' | 'syncing' | 'error' | 'needs-sync' | 'up-to-date';

export interface SyncHealthReport {
  needsSync: boolean;
  lastSyncedAt: number;
  daysSinceLastSync: number;
  deviceCount: number;
  alignment: {
    aligned: boolean;
    currentKeypairPublicKey: string;
    devicesInSync: string[];
    devicesOutOfSync: string[];
    missingRotations: number;
    staleDays: number;
  };
  warnings: Array<{
    severity: 'critical' | 'warning' | 'info';
    message: string;
    deviceId?: string;
    deviceName?: string;
    daysSinceSync?: number;
    missingRotations?: number;
    recommendedAction?: string;
  }>;
  recommendation: {
    action: 'export' | 'import' | 'no-action-needed';
    reason: string;
    sourceDevice?: string;
    targetDevice?: string;
    priority: 'high' | 'medium' | 'low';
    details?: string;
  };
}

interface BackgroundSyncContextValue {
  /** Current sync status state */
  syncStatus: SyncStatusState;
  
  /** Next scheduled run time (UNIX timestamp) */
  nextRun: number | null;
  
  /** Last run time (UNIX timestamp) */
  lastRun: number | null;
  
  /** Last run result */
  lastResult: 'success' | 'failed' | null;
  
  /** Error message if lastResult === 'failed' */
  errorMessage?: string;
  
  /** Latest health report from scheduler */
  healthReport: SyncHealthReport | null;
  
  /** Start the scheduler (IPC call) */
  startScheduler: () => Promise<void>;
  
  /** Stop the scheduler (IPC call) */
  stopScheduler: () => Promise<void>;
  
  /** Refresh status (get next run time) */
  refreshStatus: () => Promise<void>;
}

// ===========================
// CONTEXT
// ===========================

const BackgroundSyncContext = createContext<BackgroundSyncContextValue | null>(null);

/**
 * Hook to access background sync context
 * 
 * @returns BackgroundSyncContextValue
 * @throws Error if used outside provider
 */
export function useBackgroundSync(): BackgroundSyncContextValue {
  const context = useContext(BackgroundSyncContext);
  if (!context) {
    throw new Error('useBackgroundSync must be used within BackgroundSyncProvider');
  }
  return context;
}

// ===========================
// PROVIDER COMPONENT
// ===========================

export function BackgroundSyncProvider({ children }: { children: React.ReactNode }) {
  // State
  const [syncStatus, setSyncStatus] = useState<SyncStatusState>('idle');
  const [nextRun, setNextRun] = useState<number | null>(null);
  const [lastRun, setLastRun] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<'success' | 'failed' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [healthReport, setHealthReport] = useState<SyncHealthReport | null>(null);

  // Refresh status from scheduler
  const refreshStatus = useCallback(async () => {
    try {
      const nextRunTime = await window.onestar?.syncScheduler?.getNextRun();
      setNextRun(nextRunTime ?? null);
    } catch (error) {
      console.error('[BackgroundSyncProvider] Failed to refresh status:', error);
    }
  }, []);

  // Start scheduler
  const startScheduler = useCallback(async () => {
    try {
      await window.onestar?.syncScheduler?.start();
      await refreshStatus();
      console.log('[BackgroundSyncProvider] Scheduler started');
    } catch (error) {
      console.error('[BackgroundSyncProvider] Failed to start scheduler:', error);
      setSyncStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to start scheduler');
    }
  }, [refreshStatus]);

  // Stop scheduler
  const stopScheduler = useCallback(async () => {
    try {
      await window.onestar?.syncScheduler?.stop();
      setNextRun(null);
      console.log('[BackgroundSyncProvider] Scheduler stopped');
    } catch (error) {
      console.error('[BackgroundSyncProvider] Failed to stop scheduler:', error);
    }
  }, []);

  // Initialize scheduler on mount
  useEffect(() => {
    console.log('[BackgroundSyncProvider] Initializing Phase 23 scheduler');

    // Check if APIs are available
    if (!window.onestar?.syncScheduler || !window.onestar?.events) {
      console.warn('[BackgroundSyncProvider] Scheduler APIs not available (not in Electron)');
      return;
    }

    // Get initial next run time
    refreshStatus();

    // Listen for sync status change events from electron
    const handleStatusChange = (data: SyncHealthReport) => {
      console.log('[BackgroundSyncProvider] Received status change event:', data);
      
      setHealthReport(data);
      setLastRun(Date.now());
      
      if (data.needsSync) {
        setSyncStatus('needs-sync');
        setLastResult('success'); // Check completed successfully, just needs sync
      } else {
        setSyncStatus('up-to-date');
        setLastResult('success');
      }
      
      setErrorMessage(undefined);
    };

    // Register event listener
    window.onestar.events.on('sync:status-change', handleStatusChange);

    // Cleanup on unmount
    return () => {
      console.log('[BackgroundSyncProvider] Cleaning up Phase 23 scheduler');
      window.onestar?.events?.off('sync:status-change', handleStatusChange);
    };
  }, [refreshStatus]);

  // Context value
  const contextValue: BackgroundSyncContextValue = {
    syncStatus,
    nextRun,
    lastRun,
    lastResult,
    errorMessage,
    healthReport,
    startScheduler,
    stopScheduler,
    refreshStatus,
  };

  return (
    <BackgroundSyncContext.Provider value={contextValue}>
      {children}
    </BackgroundSyncContext.Provider>
  );
}
