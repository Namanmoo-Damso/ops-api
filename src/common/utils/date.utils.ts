/**
 * Date Utilities
 * Common date parsing and formatting functions
 */

/**
 * Parse birthdate from YYMMDD or YYYY-MM-DD format
 *
 * Century inference uses current year as reference point:
 * - If YY would result in a future date, use previous century
 * - Otherwise use current century
 *
 * Example (assuming current year is 2026):
 * - "250115" → "2025-01-15" (2025 is in the past, use 20xx)
 * - "270115" → "1927-01-15" (2027 is in the future, so assume 19xx for elderly)
 * - "001231" → "2000-12-31" (2000 is in the past)
 *
 * @param value - Date string in YYMMDD or YYYY-MM-DD format
 * @returns Parsed date in YYYY-MM-DD format, or undefined if invalid
 */
export function parseBirthDate(value: string | undefined): string | undefined {
    if (!value || typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;

    // Already in ISO format (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

    // YYMMDD format
    if (/^\d{6}$/.test(trimmed)) {
        const yy = parseInt(trimmed.substring(0, 2), 10);
        const mm = trimmed.substring(2, 4);
        const dd = trimmed.substring(4, 6);

        // Use current year as reference for century inference
        const currentYear = new Date().getFullYear();
        const currentCentury = Math.floor(currentYear / 100);
        const currentYY = currentYear % 100;

        // If the 2-digit year would be in the future, assume previous century
        // This is appropriate for elderly beneficiaries (typically born in 1900s)
        const fullYear =
            yy > currentYY ? (currentCentury - 1) * 100 + yy : currentCentury * 100 + yy;

        return `${fullYear}-${mm}-${dd}`;
    }

    return trimmed; // passthrough for validation
}

/**
 * Sanitize diseases array by removing empty strings and duplicates
 * @param diseases - Array of disease strings
 * @returns Cleaned array with unique non-empty values
 */
export function sanitizeDiseases(diseases: string[] | undefined): string[] {
    if (!diseases || !Array.isArray(diseases)) return [];
    return [...new Set(diseases.filter((d) => typeof d === 'string' && d.trim().length > 0).map((d) => d.trim()))];
}
