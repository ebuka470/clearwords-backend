/**
 * Validate email format
 */
export const isValidEmail = (email: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

/**
 * Validate password strength (min 6 chars)
 */
export const isValidPassword = (password: string): boolean => {
    return password.length >= 6;
};

/**
 * Validate username format (letters, numbers, underscore, 3-20 chars)
 */
export const isValidUsername = (username: string): boolean => {
    return /^[a-zA-Z0-9_]{3,20}$/.test(username);
};

/**
 * Validate phone number (international format)
 */
export const isValidPhone = (phone: string): boolean => {
    return /^[\+]?[0-9]{10,15}$/.test(phone);
};

/**
 * Validate language code
 */
export const isValidLanguage = (language: string): boolean => {
    const validLanguages = ['yoruba', 'hausa', 'igbo', 'urhobo', 'itsekiri', 'pidgin'];
    return validLanguages.includes(language);
};

/**
 * Validate segment
 */
export const isValidSegment = (segment: string): boolean => {
    const validSegments = ['parent', 'young', 'pro', 'marriage', 'nigeria'];
    return validSegments.includes(segment);
};