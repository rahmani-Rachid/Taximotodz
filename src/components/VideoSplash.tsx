import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';

interface VideoSplashProps {
  onFinish: () => void;
  timeoutMs?: number; // مدة احتياطية: لو الفيديو ما انتهاش (خطأ تحميل مثلاً)، نكمل بعدها تلقائياً
}

export default function VideoSplash({ onFinish, timeoutMs = 5000 }: VideoSplashProps) {
  const player = useVideoPlayer(require('../../assets/videos/splash.mp4'), (player) => {
    player.loop = false;
    player.play();
  });

  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const finishedRef = useRef(false);

  const finishOnce = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinish();
  };

  useEffect(() => {
    const subscription = player.addListener('playToEnd', finishOnce);
    const timer = setTimeout(finishOnce, timeoutMs); // شبكة أمان لو الفيديو اتعلّق أو فشل تحميله
    return () => {
      subscription.remove();
      clearTimeout(timer);
    };
  }, [player]);

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      <VideoView
        style={styles.video}
        player={player}
        contentFit="cover"
        nativeControls={false}
      />
      {status !== 'readyToPlay' && (
        <ActivityIndicator style={styles.loader} color="#fff" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  video: { flex: 1 },
  loader: { position: 'absolute', alignSelf: 'center', top: '50%' },
});

