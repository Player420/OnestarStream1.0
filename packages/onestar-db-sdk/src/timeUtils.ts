/**
 * timeUtils.ts
 * 
 * Phase 23: Time formatting utilities
 * 
 * Provides human-readable relative time formatting for sync scheduler UI
 */

/**
 * Format UNIX timestamp as relative time string
 * 
 * Examples:
 * - "in 5 minutes"
 * - "in 2 hours"
 * - "in 3 days"
 * - "just now" (if in past or very soon)
 * 
 * @param timestamp - UNIX timestamp (milliseconds)
 * @returns Human-readable relative time string
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = timestamp - now;
  
  // If in the past or within 1 minute
  if (diff < 60 * 1000) {
    return 'just now';
  }
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return `in ${days} day${days === 1 ? '' : 's'}`;
  }
  
  if (hours > 0) {
    return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  }
  
  return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * Format UNIX timestamp as absolute time string
 * 
 * @param timestamp - UNIX timestamp (milliseconds)
 * @returns Formatted date string (e.g., "Dec 12, 2025, 10:30 AM")
 */
export function formatAbsoluteTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Format duration in milliseconds as human-readable string
 * 
 * @param ms - Duration in milliseconds
 * @returns Human-readable duration (e.g., "5 minutes", "2 hours")
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  
  if (hours > 0) {
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  
  if (minutes > 0) {
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}
