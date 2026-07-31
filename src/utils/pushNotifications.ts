import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { doc, updateDoc } from 'firebase/firestore';
import { Platform } from 'react-native';
import { db } from './firebase';

// إعداد كيفية عرض الإشعار عندما يصل والتطبيق مفتوح (Foreground)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * يطلب إذن الإشعارات، يجلب رمز Expo Push الخاص بهذا الجهاز، ويحفظه في مستند المستخدم
 * (drivers/{uid} أو users/{uid}) — بعدها يستطيع الخادم الخلفي (Cloud Functions) إرسال
 * إشعارات Push حقيقية لهذا الجهاز حتى لو كان نائماً أو التطبيق مغلقاً تماماً.
 */
export async function registerForPushNotifications(
  collectionName: 'drivers' | 'users',
  userId: string,
): Promise<string | null> {
  if (!Device.isDevice) return null; // الإشعارات لا تعمل على المحاكي، فقط جهاز حقيقي

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return null;

    const projectId = '4e2d1366-5f9e-45ec-9398-110dd69a530d'; // نفس extra.eas.projectId في app.json
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenData.data;

    await updateDoc(doc(db, collectionName, userId), { pushToken: token });

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    return token;
  } catch {
    return null;
  }
}

