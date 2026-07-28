import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { StatusBar } from 'react-native';
import AppHeader from '../AppHeader'; // عدّل المسار إن لزم
import VideoSplash from '../components/VideoSplash'; // عدّل المسار للمكوّن الذي أنشأته
import { LanguageProvider } from '../contexts/LanguageContext'; // عدّل المسار إن لزم
import { NotificationProvider, useNotifications } from '../contexts/NotificationContext'; // عدّل المسار إن لزم

// Header وسيط يقرأ بيانات الاشعارات من الـ context (لذلك لا نستخدمه قبل التهيئة)
function HeaderWithBell() {
  const { unreadCount } = useNotifications();
  const router = useRouter();

  return (
    <AppHeader
      unreadCount={unreadCount}
      onPressBell={() => router.push('/notifications')}
    />
  );
}

export default function RootLayout() {
  // تحكم بظهور الـ splash
  const [showSplash, setShowSplash] = useState(true);

  // إذا كان الـ splash مفعل، نعرض مكوّن الفيديو فقط حتى يتم استدعاء onFinish
  if (showSplash) {
    return (
      <VideoSplash
        onFinish={() => setShowSplash(false)}
        timeoutMs={5000} // مدة احتياطية (بالملي ثانية) لإخفاء الـ splash إن لم ينتهي الفيديو لسبب ما
      />
    );
  }

  // بعد انتهاء الـ splash نهيئ الـ providers ونُظهر التطبيق كالمعتاد
  return (
    <LanguageProvider>
      <NotificationProvider>
        <StatusBar barStyle="dark-content" backgroundColor="#fff" />
        <HeaderWithBell />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login-customer" />
          <Stack.Screen name="login-driver" />
          <Stack.Screen name="register-customer" />
          <Stack.Screen name="register-driver" />
          <Stack.Screen name="app-customer" />
          <Stack.Screen name="app-driver" />
          {/* أضف بقية الشاشات هنا */}
        </Stack>
      </NotificationProvider>
    </LanguageProvider>
  );
}


