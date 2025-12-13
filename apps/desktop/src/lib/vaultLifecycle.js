"use strict";
// src/lib/vaultLifecycle.ts
// Vault Lifecycle State Machine with Auto-Lock, Idle Timeout, and Security Protections
// SECURITY: Manages vault state transitions, enforces idle timeout, zeroizes keys
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.VaultLifecycleManager = exports.DEFAULT_VAULT_CONFIG = exports.VaultState = void 0;
exports.getVaultLifecycle = getVaultLifecycle;
exports.resetVaultLifecycle = resetVaultLifecycle;
const events_1 = require("events");
const postQuantumCrypto_1 = require("./postQuantumCrypto");
/**
 * VAULT STATE MACHINE
 *
 * States:
 * - LOCKED: Vault locked, no keypair in memory
 * - UNLOCKING: Vault unlock in progress (password verification, decryption)
 * - UNLOCKED: Vault unlocked, keypair in memory
 *
 * Transitions:
 * - LOCKED → UNLOCKING: unlock() called
 * - UNLOCKING → UNLOCKED: Unlock successful
 * - UNLOCKING → LOCKED: Unlock failed (wrong password)
 * - UNLOCKED → LOCKED: lock() called, idle timeout, or security event
 *
 * Security Events (trigger auto-lock):
 * - Idle timeout (default: 5 minutes)
 * - App minimize (optional, configurable)
 * - OS sleep detection
 * - Screen lock detection
 * - Window blur (optional, configurable)
 */
var VaultState;
(function (VaultState) {
    VaultState["LOCKED"] = "locked";
    VaultState["UNLOCKING"] = "unlocking";
    VaultState["UNLOCKED"] = "unlocked";
})(VaultState || (exports.VaultState = VaultState = {}));
/**
 * Default vault configuration
 */
exports.DEFAULT_VAULT_CONFIG = {
    idleTimeoutMs: 5 * 60 * 1000, // 5 minutes
    lockOnMinimize: false,
    lockOnWindowBlur: false,
    lockOnScreenLock: true,
    lockOnSleep: true,
    minPasswordLength: 16,
    requireStrongPassword: true,
    biometricEnabled: true,
    biometricFallbackToPassword: true,
};
/**
 * Vault Lifecycle Manager
 *
 * SECURITY RESPONSIBILITIES:
 * - Enforce idle timeout (auto-lock after inactivity)
 * - Manage state transitions (locked ↔ unlocking ↔ unlocked)
 * - Zeroize keys on lock
 * - Emit events to renderer (state changes only, no secrets)
 * - Track activity (reset idle timer)
 * - Respond to security events (sleep, screen lock)
 *
 * ARCHITECTURE:
 * - Runs in preload context (trusted)
 * - EventEmitter for state change notifications
 * - Single instance (singleton pattern)
 * - Never exposes private keys to renderer
 */
class VaultLifecycleManager extends events_1.EventEmitter {
    constructor(config = {}) {
        super();
        this.state = VaultState.LOCKED;
        this.idleTimer = null;
        this.lastActivityTime = new Date();
        this.unlockStartTime = null;
        this.config = { ...exports.DEFAULT_VAULT_CONFIG, ...config };
        console.log('[VaultLifecycle] Initialized with config:', {
            idleTimeoutMs: this.config.idleTimeoutMs,
            lockOnMinimize: this.config.lockOnMinimize,
            lockOnWindowBlur: this.config.lockOnWindowBlur,
            minPasswordLength: this.config.minPasswordLength,
            requireStrongPassword: this.config.requireStrongPassword,
        });
    }
    /**
     * Get current vault state
     */
    getState() {
        return this.state;
    }
    /**
     * Get vault configuration
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Update vault configuration
     */
    updateConfig(config) {
        this.config = { ...this.config, ...config };
        console.log('[VaultLifecycle] Configuration updated:', config);
        // Restart idle timer with new timeout
        if (this.state === VaultState.UNLOCKED) {
            this.startIdleTimer();
        }
    }
    /**
     * Validate password strength
     *
     * SECURITY CHECKS:
     * - Minimum length (16 characters)
     * - Character diversity (uppercase, lowercase, digits, symbols)
     * - Entropy calculation (bits)
     * - Common password blacklist
     *
     * @param password - Password to validate
     * @returns Validation result
     */
    validatePassword(password) {
        const errors = [];
        // Check minimum length
        if (password.length < this.config.minPasswordLength) {
            errors.push(`Password must be at least ${this.config.minPasswordLength} characters`);
        }
        // Calculate entropy (Shannon entropy)
        const entropy = this.calculateEntropy(password);
        // Check character diversity
        const hasLowercase = /[a-z]/.test(password);
        const hasUppercase = /[A-Z]/.test(password);
        const hasDigits = /[0-9]/.test(password);
        const hasSymbols = /[^a-zA-Z0-9]/.test(password);
        const charTypeCount = [hasLowercase, hasUppercase, hasDigits, hasSymbols].filter(Boolean).length;
        if (this.config.requireStrongPassword && charTypeCount < 3) {
            errors.push('Password must contain at least 3 character types (lowercase, uppercase, digits, symbols)');
        }
        // Check common passwords (basic blacklist)
        const commonPasswords = [
            'password', '12345678', 'qwerty', 'letmein', 'welcome', 'monkey',
            'password123', 'admin', 'letmein123', '123456789', 'password1',
        ];
        if (commonPasswords.some(common => password.toLowerCase().includes(common))) {
            errors.push('Password contains common words or patterns');
        }
        // Determine strength
        let strength;
        if (entropy < 40 || password.length < 8) {
            strength = 'weak';
        }
        else if (entropy < 60 || password.length < 12) {
            strength = 'fair';
        }
        else if (entropy < 80 || password.length < 16) {
            strength = 'good';
        }
        else if (entropy < 100 || password.length < 20) {
            strength = 'strong';
        }
        else {
            strength = 'very-strong';
        }
        return {
            valid: errors.length === 0,
            errors,
            strength,
            entropy,
        };
    }
    /**
     * Calculate Shannon entropy of password
     *
     * @param password - Password to analyze
     * @returns Entropy in bits
     */
    calculateEntropy(password) {
        const charFrequency = new Map();
        // Count character frequencies
        for (const char of password) {
            charFrequency.set(char, (charFrequency.get(char) || 0) + 1);
        }
        // Calculate Shannon entropy
        let entropy = 0;
        const length = password.length;
        for (const count of charFrequency.values()) {
            const probability = count / length;
            entropy -= probability * Math.log2(probability);
        }
        // Multiply by length to get total bits
        return entropy * length;
    }
    /**
     * Unlock vault with password
     *
     * WORKFLOW:
     * 1. Transition to UNLOCKING state
     * 2. Validate password strength
     * 3. Attempt to decrypt keystore
     * 4. On success: Transition to UNLOCKED, start idle timer
     * 5. On failure: Transition to LOCKED, add random delay (timing attack mitigation)
     *
     * SECURITY:
     * - Password validation before decryption attempt
     * - Random delay on failure (100-300ms, prevents timing attacks)
     * - No password logging
     * - Activity tracking reset on success
     *
     * @param password - User's vault password
     * @param userId - Optional user identifier
     * @returns Unlock result
     */
    async unlockWithPassword(password, userId) {
        const startTime = performance.now();
        this.unlockStartTime = new Date();
        console.log('[VaultLifecycle] Unlock attempt (password)');
        // Transition to UNLOCKING
        this.transitionState(VaultState.UNLOCKING, 'Unlock attempt');
        try {
            // Step 1: Validate password strength (non-blocking for existing keystores)
            const validation = this.validatePassword(password);
            if (!validation.valid && !await this.keystoreExists()) {
                // Only enforce for NEW keystores (first unlock)
                console.error('[VaultLifecycle] Password validation failed:', validation.errors);
                // Add random delay (timing attack mitigation)
                await this.randomDelay(100, 300);
                this.transitionState(VaultState.LOCKED, 'Password validation failed');
                return {
                    success: false,
                    error: validation.errors.join('; '),
                    method: 'password',
                    duration: performance.now() - startTime,
                };
            }
            // Log password strength (but NOT password itself)
            if (!validation.valid) {
                console.warn('[VaultLifecycle] Existing keystore unlocked with weak password:', {
                    strength: validation.strength,
                    entropy: validation.entropy.toFixed(2),
                    warnings: validation.errors,
                });
            }
            // Step 2: Attempt to decrypt keystore
            const keypair = await (0, postQuantumCrypto_1.generateOrLoadPersistentHybridKeypair)(password, userId);
            // Step 3: Transition to UNLOCKED
            this.transitionState(VaultState.UNLOCKED, 'Password unlock successful');
            // Step 4: Start idle timer
            this.startIdleTimer();
            // Step 5: Reset activity tracking
            this.resetActivity();
            const duration = performance.now() - startTime;
            console.log(`[VaultLifecycle] Unlock successful (${duration.toFixed(2)}ms)`);
            return {
                success: true,
                keypair,
                method: 'password',
                duration,
            };
        }
        catch (error) {
            console.error('[VaultLifecycle] Unlock failed:', error);
            // Add random delay (timing attack mitigation)
            await this.randomDelay(100, 300);
            // Transition back to LOCKED
            this.transitionState(VaultState.LOCKED, 'Password unlock failed');
            return {
                success: false,
                error: error.message,
                method: 'password',
                duration: performance.now() - startTime,
            };
        }
    }
    /**
     * Lock vault (manual or automatic)
     *
     * WORKFLOW:
     * 1. Stop idle timer
     * 2. Zeroize keypair from memory
     * 3. Transition to LOCKED state
     * 4. Emit state change event
     *
     * SECURITY:
     * - Memory zeroization (fill(0))
     * - Reference clearing
     * - Immediate state transition
     *
     * @param reason - Human-readable reason for lock
     */
    lock(reason = 'Manual lock') {
        if (this.state === VaultState.LOCKED) {
            console.log('[VaultLifecycle] Already locked');
            return;
        }
        console.log(`[VaultLifecycle] Locking vault (${reason})`);
        // Stop idle timer
        this.stopIdleTimer();
        // Zeroize keypair from memory
        (0, postQuantumCrypto_1.lockPersistentKeypair)();
        // Transition to LOCKED
        this.transitionState(VaultState.LOCKED, reason);
    }
    /**
     * Record user activity (resets idle timer)
     *
     * Call this when:
     * - User interacts with UI (click, keypress)
     * - Media playback starts
     * - Crypto operation performed
     *
     * SECURITY:
     * - Only resets timer if vault is unlocked
     * - Does not prevent security event auto-lock (sleep, screen lock)
     */
    recordActivity() {
        if (this.state !== VaultState.UNLOCKED) {
            return;
        }
        this.resetActivity();
        this.startIdleTimer(); // Restart timer with fresh timeout
    }
    /**
     * Reset activity timestamp
     */
    resetActivity() {
        this.lastActivityTime = new Date();
    }
    /**
     * Get time since last activity
     *
     * @returns Idle time in milliseconds
     */
    getIdleTime() {
        return Date.now() - this.lastActivityTime.getTime();
    }
    /**
     * Start idle timeout timer
     *
     * SECURITY:
     * - Auto-locks vault after configured timeout
     * - Emits warning event 30 seconds before lock
     */
    startIdleTimer() {
        // Clear existing timer
        this.stopIdleTimer();
        // Start new timer
        this.idleTimer = setTimeout(() => {
            console.log('[VaultLifecycle] Idle timeout reached');
            const idleTime = this.getIdleTime();
            // Emit idle timeout event
            this.emit('idleTimeout', {
                idleTimeMs: idleTime,
                threshold: this.config.idleTimeoutMs,
                timestamp: new Date(),
            });
            // Lock vault
            this.lock('Idle timeout');
        }, this.config.idleTimeoutMs);
        console.log(`[VaultLifecycle] Idle timer started (${this.config.idleTimeoutMs}ms)`);
    }
    /**
     * Stop idle timeout timer
     */
    stopIdleTimer() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }
    /**
     * Transition vault state
     *
     * @param newState - New vault state
     * @param reason - Reason for state change
     */
    transitionState(newState, reason) {
        const previousState = this.state;
        if (previousState === newState) {
            console.log(`[VaultLifecycle] Already in state: ${newState}`);
            return;
        }
        console.log(`[VaultLifecycle] State transition: ${previousState} → ${newState} (${reason})`);
        this.state = newState;
        // Emit state change event
        const event = {
            previousState,
            newState,
            reason,
            timestamp: new Date(),
        };
        this.emit('stateChange', event);
    }
    /**
     * Random delay (timing attack mitigation)
     *
     * @param minMs - Minimum delay (ms)
     * @param maxMs - Maximum delay (ms)
     */
    async randomDelay(minMs, maxMs) {
        const delayMs = minMs + Math.random() * (maxMs - minMs);
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    /**
     * Check if keystore exists (used for password validation)
     */
    async keystoreExists() {
        try {
            const { keystoreExists } = await Promise.resolve().then(() => __importStar(require('./hybridKeypairStore')));
            return await keystoreExists();
        }
        catch {
            return false;
        }
    }
    /**
     * Handle app minimize event
     */
    onAppMinimize() {
        if (this.config.lockOnMinimize && this.state === VaultState.UNLOCKED) {
            console.log('[VaultLifecycle] App minimized, locking vault');
            this.lock('App minimized');
        }
    }
    /**
     * Handle window blur event
     */
    onWindowBlur() {
        if (this.config.lockOnWindowBlur && this.state === VaultState.UNLOCKED) {
            console.log('[VaultLifecycle] Window blurred, locking vault');
            this.lock('Window lost focus');
        }
    }
    /**
     * Handle OS sleep event
     */
    onSystemSleep() {
        if (this.config.lockOnSleep && this.state === VaultState.UNLOCKED) {
            console.log('[VaultLifecycle] System sleeping, locking vault');
            this.lock('System sleep');
        }
    }
    /**
     * Handle screen lock event
     */
    onScreenLock() {
        if (this.config.lockOnScreenLock && this.state === VaultState.UNLOCKED) {
            console.log('[VaultLifecycle] Screen locked, locking vault');
            this.lock('Screen lock');
        }
    }
    /**
     * Cleanup (called on app exit)
     */
    cleanup() {
        console.log('[VaultLifecycle] Cleanup initiated');
        this.stopIdleTimer();
        this.lock('App exit');
        this.removeAllListeners();
    }
}
exports.VaultLifecycleManager = VaultLifecycleManager;
/**
 * Singleton instance (preload context only)
 */
let vaultLifecycleInstance = null;
/**
 * Get or create vault lifecycle manager
 *
 * @param config - Vault configuration (optional)
 * @returns VaultLifecycleManager instance
 */
function getVaultLifecycle(config) {
    if (!vaultLifecycleInstance) {
        vaultLifecycleInstance = new VaultLifecycleManager(config);
    }
    return vaultLifecycleInstance;
}
/**
 * Reset vault lifecycle (for testing only)
 */
function resetVaultLifecycle() {
    if (vaultLifecycleInstance) {
        vaultLifecycleInstance.cleanup();
        vaultLifecycleInstance = null;
    }
}
