import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { doc, updateDoc } from 'firebase/firestore';
import { Platform } from 'react-native';
import { auth, db } from '../utils/firebase';

// كيفية عرض الإشعار عندما يصل والتطبيق مفتوح (Foreground)
// ✅ فُعِّل الآن — كان معطّلاً سابقاً لأنه يسبب كراش على Expo Go (Native Module)،
// لكن مع Custom Dev Client هذا آمن تماماً ويعمل بشكل طبيعي.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * يطلب إذن الإشعارات، يجلب رمز Expo Push الخاص بهذا الجهاز، ويحفظه في مستند المستخدم
 * الحالي المسجَّل دخوله (users/{uid} أو drivers/{uid}) — بعدها Cloud Functions تقدر ترسل
 * إشعارات Push حقيقية لهذا الجهاز حتى لو كان نائماً أو التطبيق مغلقاً تماماً.
 *
 * ⚠️ اسم الحقل المستخدم "expoPushToken" — مطابق تماماً لما يقرأه functions/index.js.
 */
export async function registerForPushNotificationsAsync(
  collectionName: 'users' | 'drivers',
): Promise<string | null> {
  if (!Device.isDevice) return null; // الإشعارات لا تعمل على المحاكي، فقط جهاز حقيقي

  const user = auth.currentUser;
  if (!user) return null;

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

    await updateDoc(doc(db, collectionName, user.uid), { expoPushToken: token });

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

