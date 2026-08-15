/**
 * Format date to string
 */
export const formatDate = (date: string | Date, format: 'short' | 'long' = 'short'): string => {
    const d = new Date(date);

    if (format === 'short') {
        return d.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        });
    }

    return d.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

/**
 * Format XP number with K/M suffixes
 */
export const formatXP = (xp: number): string => {
    if (xp >= 1000000) return `${(xp / 1000000).toFixed(1)}M`;
    if (xp >= 1000) return `${(xp / 1000).toFixed(1)}K`;
    return xp.toString();
};

/**
 * Format level with ordinal suffix (1st, 2nd, 3rd, etc.)
 */
export const formatLevel = (level: number): string => {
    const suffixes = ['th', 'st', 'nd', 'rd'];
    const value = level % 100;
    return `${level}${suffixes[(value - 20) % 10] || suffixes[value] || suffixes[0]}`;
};

/**
 * Get progress percentage
 */
export const getProgressPercentage = (completed: number, total: number): number => {
    if (total === 0) return 0;
    return Math.min(Math.round((completed / total) * 100), 100);
};

/**
 * Format duration (seconds to human readable)
 */
export const formatDuration = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes === 0) return `${remainingSeconds}s`;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
};