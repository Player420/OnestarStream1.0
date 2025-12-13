// src/lib/rotationScheduler.ts
// Phase 19: Automated Key Rotation Scheduler
// SECURITY: Time-based rotation triggers (default 180 days)

import { EventEmitter } from 'events';
import {
  loadKeystoreV3,
  needsRotation,
  getRotationStatus,
  type EncryptedKeystoreV3,
} from './keypairRotation';

/**
 * Rotation scheduler configuration
 */
export interface RotationSchedulerConfig {
  /**
   * Check interval in milliseconds
   * Default: 60 minutes (3,600,000 ms)
   */
  checkIntervalMs: number;
  
  /**
   * Enable automatic rotation
   * Default: false (only emit events, don't auto-rotate)
   */
  autoRotate: boolean;
  
  /**
   * Grace period before showing notification (days)
   * Default: 7 days
   */
  notificationGraceDays: number;
}

/**
 * Rotation scheduler events
 * 
 * Events emitted:
 * - 'rotation-due': Rotation is overdue, action required
 * - 'rotation-warning': Rotation due soon (within grace period)
 * - 'check-complete': Scheduled check completed
 * - 'error': Scheduler error occurred
 */
export interface RotationSchedulerEvents {
  'rotation-due': (status: {
    currentKeyId: string;
    currentKeyAge: number;
    daysOverdue: number;
    nextRotationDue?: string;
  }) => void;
  
  'rotation-warning': (status: {
    currentKeyId: string;
    currentKeyAge: number;
    daysUntilDue: number;
    nextRotationDue?: string;
  }) => void;
  
  'check-complete': (status: {
    needsRotation: boolean;
    nextCheckAt: Date;
  }) => void;
  
  'error': (error: Error) => void;
}

/**
 * Key rotation scheduler
 * 
 * WORKFLOW:
 * 1. Check every N minutes (default 60 min)
 * 2. Load keystore v3
 * 3. Check if rotation is due
 * 4. Emit events for UI notifications
 * 5. Optionally trigger auto-rotation
 * 
 * INTEGRATION:
 * - Runs in main process (Electron)
 * - Emits events to renderer via IPC
 * - Coordinates with VaultLifecycleManager
 * - Respects user's rotation policy
 * 
 * SECURITY:
 * - Never stores passwords
 * - Never decrypts keypairs
 * - Only checks metadata (nextRotationDue)
 * - User must confirm rotation
 */
export class RotationScheduler extends EventEmitter {
  private config: RotationSchedulerConfig;
  private intervalHandle: NodeJS.Timeout | null = null;
  private running = false;
  private lastCheckAt?: Date;
  
  constructor(config?: Partial<RotationSchedulerConfig>) {
    super();
    
    this.config = {
      checkIntervalMs: config?.checkIntervalMs ?? 60 * 60 * 1000, // 60 minutes
      autoRotate: config?.autoRotate ?? false,
      notificationGraceDays: config?.notificationGraceDays ?? 7,
    };
    
    console.log('[RotationScheduler] Initialized with config:', this.config);
  }
  
  /**
   * Start the scheduler
   */
  start(): void {
    if (this.running) {
      console.warn('[RotationScheduler] Already running');
      return;
    }
    
    console.log('[RotationScheduler] Starting...');
    this.running = true;
    
    // Check immediately on start
    this.checkRotationStatus().catch(error => {
      console.error('[RotationScheduler] Initial check failed:', error);
      this.emit('error', error);
    });
    
    // Schedule periodic checks
    this.intervalHandle = setInterval(() => {
      this.checkRotationStatus().catch(error => {
        console.error('[RotationScheduler] Periodic check failed:', error);
        this.emit('error', error);
      });
    }, this.config.checkIntervalMs);
    
    console.log(`[RotationScheduler] Checking every ${this.config.checkIntervalMs / 1000 / 60} minutes`);
  }
  
  /**
   * Stop the scheduler
   */
  stop(): void {
    if (!this.running) {
      console.warn('[RotationScheduler] Not running');
      return;
    }
    
    console.log('[RotationScheduler] Stopping...');
    this.running = false;
    
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }
  
  /**
   * Check rotation status
   * 
   * @private
   */
  private async checkRotationStatus(): Promise<void> {
    this.lastCheckAt = new Date();
    console.log(`[RotationScheduler] Checking rotation status at ${this.lastCheckAt.toISOString()}`);
    
    try {
      // Load keystore
      const keystore = await loadKeystoreV3();
      
      if (!keystore) {
        console.log('[RotationScheduler] No keystore found, skipping check');
        return;
      }
      
      // Get rotation status
      const status = getRotationStatus(keystore);
      
      console.log('[RotationScheduler] Status:', {
        currentKeyAge: status.currentKeyAge.toFixed(2),
        needsRotation: status.needsRotation,
        daysUntilDue: status.daysUntilDue,
      });
      
      // Check if rotation is overdue
      if (status.needsRotation) {
        const daysOverdue = status.daysUntilDue !== undefined ? Math.abs(status.daysUntilDue) : 0;
        
        console.warn(`[RotationScheduler] ⚠️ Rotation overdue by ${daysOverdue.toFixed(1)} days`);
        
        this.emit('rotation-due', {
          currentKeyId: status.currentKeyId,
          currentKeyAge: status.currentKeyAge,
          daysOverdue,
          nextRotationDue: status.nextRotationDue,
        });
        
        // TODO: Auto-rotate if enabled (requires vault password)
        if (this.config.autoRotate) {
          console.log('[RotationScheduler] Auto-rotation not yet implemented');
          // Would need to integrate with VaultLifecycleManager to get decrypted keypair
        }
      }
      // Check if rotation due soon (within grace period)
      else if (
        status.daysUntilDue !== undefined &&
        status.daysUntilDue <= this.config.notificationGraceDays &&
        status.daysUntilDue > 0
      ) {
        console.log(`[RotationScheduler] ⏰ Rotation due in ${status.daysUntilDue.toFixed(1)} days`);
        
        this.emit('rotation-warning', {
          currentKeyId: status.currentKeyId,
          currentKeyAge: status.currentKeyAge,
          daysUntilDue: status.daysUntilDue,
          nextRotationDue: status.nextRotationDue,
        });
      }
      
      // Emit check complete event
      const nextCheckAt = new Date(Date.now() + this.config.checkIntervalMs);
      this.emit('check-complete', {
        needsRotation: status.needsRotation,
        nextCheckAt,
      });
    } catch (error) {
      console.error('[RotationScheduler] Check failed:', error);
      throw error;
    }
  }
  
  /**
   * Manually trigger a rotation check (outside scheduled interval)
   */
  async checkNow(): Promise<void> {
    console.log('[RotationScheduler] Manual check triggered');
    await this.checkRotationStatus();
  }
  
  /**
   * Get scheduler status
   */
  getStatus(): {
    running: boolean;
    lastCheckAt?: Date;
    nextCheckAt?: Date;
    config: RotationSchedulerConfig;
  } {
    const nextCheckAt = this.running && this.lastCheckAt
      ? new Date(this.lastCheckAt.getTime() + this.config.checkIntervalMs)
      : undefined;
    
    return {
      running: this.running,
      lastCheckAt: this.lastCheckAt,
      nextCheckAt,
      config: this.config,
    };
  }
  
  /**
   * Update scheduler configuration
   * 
   * @param newConfig - Partial configuration to update
   */
  updateConfig(newConfig: Partial<RotationSchedulerConfig>): void {
    console.log('[RotationScheduler] Updating config:', newConfig);
    
    const wasRunning = this.running;
    
    if (wasRunning) {
      this.stop();
    }
    
    this.config = {
      ...this.config,
      ...newConfig,
    };
    
    if (wasRunning) {
      this.start();
    }
    
    console.log('[RotationScheduler] Config updated:', this.config);
  }
}

/**
 * Global scheduler instance
 * 
 * Usage in main process:
 * ```typescript
 * import { getRotationScheduler } from './rotationScheduler';
 * 
 * const scheduler = getRotationScheduler();
 * scheduler.start();
 * 
 * scheduler.on('rotation-due', (status) => {
 *   // Send notification to renderer
 *   mainWindow.webContents.send('rotation-due', status);
 * });
 * ```
 */
let globalScheduler: RotationScheduler | null = null;

export function getRotationScheduler(config?: Partial<RotationSchedulerConfig>): RotationScheduler {
  if (!globalScheduler) {
    globalScheduler = new RotationScheduler(config);
  }
  return globalScheduler;
}

/**
 * Reset global scheduler (for testing)
 */
export function resetRotationScheduler(): void {
  if (globalScheduler) {
    globalScheduler.stop();
    globalScheduler = null;
  }
}
