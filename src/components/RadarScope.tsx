import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export type RadarPoint = {
  id: string;
  angleDeg: number;      // 0-360 — الاتجاه الحقيقي من موقع السائق نحو الزبون (0 = شمال)
  distanceRatio: number; // 0 (قريب جداً) إلى 1 (على حافة أبعد حلقة)
  photoURL?: string;     // صورة الزبون الحقيقية (إن وُجدت) — إيموجي كبديل إذا غير موجودة
  thief?: boolean;
  flagged?: boolean;
};

type Props = {
  online: boolean;
  points: RadarPoint[];
  onPressPoint: (id: string) => void;
  size?: number;
};

const RADAR_GREEN = '#8BC900';

// شعاع واحد بسيط بشفافية منخفضة — الطبقات المتعددة المتراكبة كانت تُنتج حواف "مسننة" واضحة
// عند حافة الشعاع بسبب تراكب حواف صلبة متتالية؛ شعاع واحد شفاف يعطي نفس الإحساس الناعم بدون هذا العيب
const BEAM_OPACITY = 0.32;

// حد أدنى لمكان ظهور أي نقطة على الرادار — يمنع انطباق أي زبون فوق نقطة السائق بالمركز
// حتى لو كانت المسافة الحقيقية 0 (كما يحدث أثناء الاختبار على نفس الجهاز)
const MIN_DISTANCE_RATIO = 0.22;

function useRingAnim(delay: number, active: boolean) {
  const val = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) { val.setValue(0); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      Animated.loop(
        Animated.sequence([
          Animated.timing(val, { toValue: 1, duration: 2200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(val, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ).start();
    }, delay);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [active]);
  return val;
}

export default function RadarScope({ online, points, onPressPoint, size = 300 }: Props) {
  const beamAnim = useRef(new Animated.Value(0)).current;
  const rings = [useRingAnim(0, online), useRingAnim(700, online), useRingAnim(1400, online)];

  useEffect(() => {
    if (!online) return;
    const anim = Animated.loop(
      Animated.timing(beamAnim, { toValue: 1, duration: 3200, easing: Easing.linear, useNativeDriver: true }),
    );
    anim.start();
    return () => anim.stop();
  }, [online]);

  const spin = beamAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const radius = size / 2;
  const beamLength = radius; // يمتد بالضبط حتى حافة الدائرة الخارجية — لا يتجاوزها

  return (
    <View style={[st.wrap, { width: size, height: size }]}>
      {/* حلقات ثابتة تحدّد شكل الرادار حتى بدون حركة */}
      <View style={[st.staticRing, { width: size, height: size, borderRadius: radius }]} />
      <View style={[st.staticRing, { width: size * 0.66, height: size * 0.66, borderRadius: (size * 0.66) / 2 }]} />
      <View style={[st.staticRing, { width: size * 0.33, height: size * 0.33, borderRadius: (size * 0.33) / 2 }]} />

      {/* حلقات نابضة متحركة */}
      {rings.map((a, i) => {
        const scale   = a.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });
        const opacity = a.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });
        return (
          <Animated.View key={i}
            style={[st.pulseRing, {
              width: size, height: size, borderRadius: radius,
              transform: [{ scale: online ? scale : 1 }],
              opacity: online ? opacity : 0,
            }]} />
        );
      })}

      {/* الشعاع المتدرّج — مقصوص داخل حدود الرادار بالضبط، لا يتجاوزها */}
      {online && (
        <View style={[st.beamClip, { width: size, height: size, borderRadius: radius }]}>
          <Animated.View style={[st.beamPivot, { width: size, height: size, transform: [{ rotate: spin }] }]}>
            <View style={[st.beamWedge, { width: beamLength, height: beamLength, opacity: BEAM_OPACITY }]} />
          </Animated.View>
        </View>
      )}

      {/* نقاط الزبائن الحقيقية — صورة حقيقية إن وُجدت، وإلا إيموجي كبديل */}
      {points.map((p) => {
        const rad       = (p.angleDeg * Math.PI) / 180;
        const safeRatio = Math.max(p.distanceRatio, MIN_DISTANCE_RATIO);
        const dist      = Math.min(safeRatio, 1) * (radius - 30);
        const x = radius + dist * Math.sin(rad) - 26;
        const y = radius - dist * Math.cos(rad) - 26;
        const ringColor = p.thief ? '#ef4444' : p.flagged ? '#f97316' : RADAR_GREEN;
        return (
          <TouchableOpacity key={p.id}
            style={[st.point, { left: x, top: y, borderColor: ringColor }]}
            onPress={() => onPressPoint(p.id)}>
            {p.photoURL ? (
              <Image source={{ uri: p.photoURL }} style={st.pointImage} />
            ) : (
              <Text style={{ fontSize: 20 }}>{p.thief ? '🚨' : p.flagged ? '⚠️' : '🙂'}</Text>
            )}
          </TouchableOpacity>
        );
      })}

      {/* نقطة السائق البسيطة في المركز — دائماً في المنتصف تماماً، لا يمكن لأي زبون تغطيتها */}
      <View style={st.centerGlow}>
        <View style={st.centerDot} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap:        { alignItems: 'center', justifyContent: 'center' },
  staticRing:  { position: 'absolute', borderWidth: 1, borderColor: 'rgba(139,201,0,0.35)' },
  pulseRing:   { position: 'absolute', borderWidth: 1.5, borderColor: RADAR_GREEN, backgroundColor: 'rgba(139,201,0,0.06)' },
  beamClip:    { position: 'absolute', overflow: 'hidden' },
  beamPivot:   { position: 'absolute' },
  beamWedge:   {
    position: 'absolute', top: '50%', left: '50%',
    backgroundColor: RADAR_GREEN,
    borderTopLeftRadius: 0,
    borderBottomRightRadius: 999,
  },
  point:       { position: 'absolute', width: 52, height: 52, borderRadius: 26, backgroundColor: '#1C1C1E', borderWidth: 2.5, justifyContent: 'center', alignItems: 'center', overflow: 'hidden', elevation: 5, zIndex: 3 },
  pointImage:  { width: '100%', height: '100%', borderRadius: 26 },
  centerGlow:  { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.25)', justifyContent: 'center', alignItems: 'center', zIndex: 5 },
  centerDot:   { width: 13, height: 13, borderRadius: 7, backgroundColor: '#fff', elevation: 6, shadowColor: '#fff', shadowOpacity: 0.9, shadowRadius: 8 },
});

