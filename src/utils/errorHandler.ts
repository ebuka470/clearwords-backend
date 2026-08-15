import { Alert } from 'react-native';

type ErrorWithMessage = {
    message: string;
    response?: {
        data?: {
            error?: string;
            message?: string;
        };
        status?: number;
    };
};

/**
 * Get error message from various error types
 */
export const getErrorMessage = (error: unknown): string => {
    if (typeof error === 'string') return error;

    if (error && typeof error === 'object') {
        const err = error as ErrorWithMessage;

        // API error with response
        if (err.response?.data?.error) {
            return err.response.data.error;
        }
        if (err.response?.data?.message) {
            return err.response.data.message;
        }

        // Standard error
        if (err.message) {
            return err.message;
        }
    }

    return 'Something went wrong. Please try again.';
};

/**
 * Show error alert
 */
export const showErrorAlert = (error: unknown, title: string = 'Error'): void => {
    const message = getErrorMessage(error);
    Alert.alert(title, message);
};

/**
 * Network error check
 */
export const isNetworkError = (error: unknown): boolean => {
    const err = error as any;
    return err?.message === 'Network Error' || err?.code === 'ECONNABORTED';
};

/**
 * Unauthorized error check (token expired)
 */
export const isUnauthorizedError = (error: unknown): boolean => {
    const err = error as any;
    return err?.response?.status === 401;
};