import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Camera from 'expo-camera';
import * as Notifications from 'expo-notifications';

/**
 * Request camera permission
 */
export const requestCameraPermission = async (): Promise<boolean> => {
    if (Platform.OS === 'web') return true;

    const { status } = await Camera.requestCameraPermissionsAsync();
    return status === 'granted';
};

/**
 * Request photo library permission
 */
export const requestPhotoLibraryPermission = async (): Promise<boolean> => {
    if (Platform.OS === 'web') return true;

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    return status === 'granted';
};

/**
 * Request notification permission
 */
export const requestNotificationPermission = async (): Promise<boolean> => {
    if (Platform.OS === 'web') return true;

    const { status } = await Notifications.getPermissionsAsync();
    if (status === 'granted') return true;

    const { status: newStatus } = await Notifications.requestPermissionsAsync();
    return newStatus === 'granted';
};

/**
 * Check if camera permission is granted
 */
export const hasCameraPermission = async (): Promise<boolean> => {
    if (Platform.OS === 'web') return true;

    const { status } = await Camera.getCameraPermissionsAsync();
    return status === 'granted';
};

/**
 * Check if photo library permission is granted
 */
export const hasPhotoLibraryPermission = async (): Promise<boolean> => {
    if (Platform.OS === 'web') return true;

    const { status } = await ImagePicker.getMediaLibraryPermissionsAsync();
    return status === 'granted';
};