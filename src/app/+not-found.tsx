import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

export default function NotFoundScreen() {
  const router = useRouter();

  useEffect(() => {
    // إعادة توجيه فورية للجذر بدل عرض رسالة خطأ — يمنع الومضة المزعجة أثناء تدفق Google Sign-In
    const timer = setTimeout(() => {
      router.replace('/');
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={s.container}>
      <ActivityIndicator size="large" color="#E8B84B" />
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1F2A40',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

