/**
 * SyncNotifications.tsx
 * 
 * Toast notification system for sync status updates
 * 
 * Features:
 * - Auto-shows toast when needsSync=true
 * - Badge indicator on settings icon
 * - Multiple severity levels (info, warning, error, success)
 * - Auto-dismiss after timeout
 * - Click to dismiss
 * - Stack multiple toasts
 * 
 * Integration:
 * - Listens to BackgroundSyncContext
 * - Shows sync status notifications
 * - Provides manual toast API
 */

'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useBackgroundSync } from './BackgroundSyncProvider';

// ===========================
// TYPES
// ===========================

export type ToastSeverity = 'info' | 'warning' | 'error' | 'success';

export interface Toast {
  id: string;
  message: string;
  severity: ToastSeverity;
  duration?: number; // ms, 0 = no auto-dismiss
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastContextValue {
  /** Show a toast notification */
  showToast: (toast: Omit<Toast, 'id'>) => void;
  
  /** Dismiss a specific toast */
  dismissToast: (id: string) => void;
  
  /** Dismiss all toasts */
  dismissAll: () => void;
  
  /** Current toasts */
  toasts: Toast[];
}

// ===========================
// CONTEXT
// ===========================

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}

// ===========================
// TOAST PROVIDER
// ===========================

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const { syncStatus, healthReport } = useBackgroundSync();

  // Listen for sync status changes
  useEffect(() => {
    if (!healthReport) return;

    // Show toast when sync is needed
    if (healthReport.needsSync) {
      showToast({
        message: `Sync needed on device`,
        severity: 'warning',
        duration: 10000, // 10 seconds
        action: {
          label: 'Go to Sync Settings',
          onClick: () => {
            window.location.href = '/settings/sync';
          },
        },
      });
    }
  }, [healthReport?.needsSync]);

  const showToast = (toast: Omit<Toast, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const newToast: Toast = {
      id,
      duration: 5000, // Default 5 seconds
      ...toast,
    };

    setToasts((prev) => [...prev, newToast]);

    // Auto-dismiss after duration
    if (newToast.duration && newToast.duration > 0) {
      setTimeout(() => {
        dismissToast(id);
      }, newToast.duration);
    }
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const dismissAll = () => {
    setToasts([]);
  };

  const contextValue: ToastContextValue = {
    showToast,
    dismissToast,
    dismissAll,
    toasts,
  };

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <ToastContainer toasts={toasts} dismissToast={dismissToast} />
    </ToastContext.Provider>
  );
}

// ===========================
// TOAST CONTAINER
// ===========================

function ToastContainer({
  toasts,
  dismissToast,
}: {
  toasts: Toast[];
  dismissToast: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-md">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => dismissToast(toast.id)} />
      ))}
    </div>
  );
}

// ===========================
// TOAST ITEM
// ===========================

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const severityStyles = {
    info: 'bg-blue-600 text-white',
    warning: 'bg-yellow-500 text-black',
    error: 'bg-red-600 text-white',
    success: 'bg-green-600 text-white',
  };

  const severityIcons = {
    info: 'ℹ️',
    warning: '⚠️',
    error: '❌',
    success: '✅',
  };

  return (
    <div
      className={`${severityStyles[toast.severity]} rounded-lg shadow-lg p-4 flex items-start gap-3 animate-slide-in`}
    >
      <span className="text-xl">{severityIcons[toast.severity]}</span>
      
      <div className="flex-1">
        <p className="font-medium">{toast.message}</p>
        
        {toast.action && (
          <button
            onClick={() => {
              toast.action!.onClick();
              onDismiss();
            }}
            className="mt-2 underline hover:no-underline text-sm font-semibold"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      
      <button
        onClick={onDismiss}
        className="text-xl hover:opacity-70 transition-opacity"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

// ===========================
// SYNC BADGE INDICATOR
// ===========================

/**
 * Badge indicator for sync status
 * 
 * Usage:
 *   <Link href="/settings/sync">
 *     Settings
 *     <SyncBadge />
 *   </Link>
 */
export function SyncBadge() {
  const { healthReport } = useBackgroundSync();

  if (!healthReport || !healthReport.needsSync) return null;

  return (
    <span className="inline-flex items-center justify-center w-2 h-2 ml-2 bg-red-500 rounded-full animate-pulse" />
  );
}
