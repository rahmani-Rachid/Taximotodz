import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp } from 'firebase/app';
import { getReactNativePersistence, initializeAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';

export const firebaseConfig = {
  apiKey: "AIzaSyBjNnlpsKuoA95I-18bUuPzJqP0NJJ2Cnw",
  authDomain: "taximotodz-16.firebaseapp.com",
  projectId: "taximotodz-16",
  storageBucket: "taximotodz-16.firebasestorage.app",
  messagingSenderId: "1026634729182",
  appId: "1:1026634729182:android:d1616e14f57cc6cc81244f",
};

const app = initializeApp(firebaseConfig);
export const auth = initializeAuth(app, {
  // @ts-ignore — خطأ معروف وموثَّق في تعريفات Firebase TypeScript (لا يزال مفتوحاً في مستودعهم الرسمي)، لا يؤثر على التشغيل الفعلي إطلاقاً
  persistence: getReactNativePersistence(AsyncStorage)
});
export const db = getFirestore(app);
export const storage = getStorage(app);
// ── جديد: للاتصال بدوال Cloud Functions من التطبيق (requestOtp / verifyOtp) ──
// europe-west1 لأنها نفس المنطقة المستخدمة لبقية الدوال في هذا المشروع
export const functions = getFunctions(app, 'europe-west1');
export default app;

