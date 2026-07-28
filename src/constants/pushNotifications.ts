
// ⚠️ معطّل مؤقتاً - يسبب كراش على Expo Go لأنه Native module
// Notifications.setNotificationHandler({
//   handleNotification: async () => ({
//     shouldShowAlert: true,
//     shouldPlaySound: true,
//     shouldSetBadge: false,
//   }),
// });

export async function registerForPushNotificationsAsync(
  collectionName: 'users' | 'drivers',
): Promise<string | null> {
  console.log('[Push] معطّل مؤقتاً على Expo Go');
  return null;
}
