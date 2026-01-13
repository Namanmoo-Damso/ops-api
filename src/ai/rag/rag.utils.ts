/**
 * Utility functions for RAG system
 */

const KST_OFFSET_HOURS = 9; // UTC+9 for Korea Standard Time

/**
 * Convert UTC Date to KST (Korea Standard Time, UTC+9)
 */
export function toKST(utcDate: Date): Date {
  const kstDate = new Date(utcDate);
  kstDate.setHours(kstDate.getHours() + KST_OFFSET_HOURS);
  return kstDate;
}

/**
 * Format KST date as "YYYY-MM-DD HH:mm KST"
 */
export function formatKST(kstDate: Date): string {
  const year = kstDate.getFullYear();
  const month = String(kstDate.getMonth() + 1).padStart(2, '0');
  const day = String(kstDate.getDate()).padStart(2, '0');
  const hours = String(kstDate.getHours()).padStart(2, '0');
  const minutes = String(kstDate.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes} KST`;
}
