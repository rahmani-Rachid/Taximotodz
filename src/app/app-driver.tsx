import { useAudioPlayer } from 'expo-audio';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import {
  collection, doc, getDoc, getDocs, increment, onSnapshot, orderBy,
  query, serverTimestamp, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Dimensions, Image, Linking,
  Modal, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import RadarScope, { RadarPoint } from '../components/RadarScope';
import RatingModal, { RatingReason, RatingStatus } from '../components/RatingModal';
import { registerForPushNotificationsAsync } from '../constants/pushNotifications';
import { auth, db } from '../utils/firebase';

const CUSTOMER_BAD_REASONS: RatingReason[] = [
  { code: 'no_pay_fled',        label: 'لم يدفع الأجرة وهرب' },
  { code: 'partial_pay',        label: 'لم يعطني الأجرة كاملة' },
  { code: 'changed_destination',label: 'طلب مكاناً ثم غيّر الوجهة بدون زيادة الأجرة' },
  { code: 'rude',               label: 'بذيء اللسان' },
];

const RADAR_RANGE_KM = 5;
const RADAR_SIZE = Math.min(Dimensions.get('window').width - 24, 420); // يملأ عرض الهاتف تقريباً

type LatLng = { latitude: number; longitude: number };

type RouteInfo = {
 coords:      LatLng[];
 distanceKm:  number;
 durationMin: number;
};

type RideRequest = {
 id:             string;
 customerId?:    string; // ← يُستخدم لاكتشاف وإلغاء الطلبات المكررة من نفس الزبون
 customerName:   string;
 phone:          string;
 customerRating: number;
 customerTrips:  number;
 pickupLat:      number;
 pickupLng:      number;
 pickupAddress:  string;
 destination:    string;
 destinationLat: number;
 destinationLng: number;
 price:          number;
 suggestedPrice: number;
 priceLabel:     string;
 tripRoute?:     RouteInfo;
 driverRoute?:   RouteInfo;
};

type CustomerStatus = 'good' | 'average' | 'bad' | 'thief';

type CustomerRecord = {
 id:           string;
 name:         string;
 phone:        string;
 status:       CustomerStatus;
 note:         string;
 trips:        number;
 lastDate:     string;
 complaints:   number;
 reporters:    string[];
 reporterIds:  string[];
 reasons:      string[];
 ratingSum:    number; // ← مجموع النجوم التي أعطاها كل السائقين لهذا الزبون
 ratingCount:  number; // ← عدد مرات التقييم — المتوسط = ratingSum / ratingCount
};

// يحوّل حالة التقييم النصية (جيد/متوسط/سيء) إلى عدد نجوم رقمي لحساب المتوسط الحقيقي
function statusToStars(status: CustomerStatus): number {
  if (status === 'good') return 5;
  if (status === 'average') return 3;
  return 1; // bad / thief
}

const STATUS_CONFIG: Record<CustomerStatus, { label: string; color: string; bg: string; icon: string }> = {
 good:    { label: 'جيد',     color: '#27ae60', bg: '#f0fdf4', icon: '✅' },
 average: { label: 'متوسط',   color: '#f59e0b', bg: '#fffbeb', icon: '🟡' },
 bad:     { label: 'سيئ',     color: '#f97316', bg: '#fff7ed', icon: '⚠️' },
 thief:   { label: 'سارق 🚨', color: '#ef4444', bg: '#fef2f2', icon: '🚨' },
};

function reasonLabel(code: string): string {
  return CUSTOMER_BAD_REASONS.find(r => r.code === code)?.label ?? code;
}

async function fetchOSRM(
 fromLat: number, fromLng: number,
 toLat:   number, toLng:   number,
): Promise<RouteInfo> {
 const fallback: RouteInfo = {
   coords: [
     { latitude: fromLat, longitude: fromLng },
     { latitude: toLat,   longitude: toLng   },
   ],
   distanceKm:  parseFloat(haversineKm(fromLat, fromLng, toLat, toLng).toFixed(1)),
   durationMin: Math.round(haversineKm(fromLat, fromLng, toLat, toLng) / 0.5),
 };
 try {
   const url =
     `https://router.project-osrm.org/route/v1/driving/` +
     `${fromLng},${fromLat};${toLng},${toLat}` +
     `?overview=full&geometries=geojson`;
   const res  = await fetch(url);
   const json = await res.json();
   if (json.code !== 'Ok' || !json.routes?.length) return fallback;
   const route = json.routes[0];
   return {
     coords: route.geometry.coordinates.map(
       ([lng, lat]: [number, number]) => ({ latitude: lat, longitude: lng }),
     ),
     distanceKm:  parseFloat((route.distance / 1000).toFixed(1)),
     durationMin: Math.round(route.duration / 60),
   };
 } catch {
   return fallback;
 }
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
 const R = 6371;
 const dLat = ((lat2 - lat1) * Math.PI) / 180;
 const dLng = ((lng2 - lng1) * Math.PI) / 180;
 const a =
   Math.sin(dLat / 2) ** 2 +
   Math.cos((lat1 * Math.PI) / 180) *
     Math.cos((lat2 * Math.PI) / 180) *
     Math.sin(dLng / 2) ** 2;
 return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number) {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const λ1 = (lng1 * Math.PI) / 180;
  const λ2 = (lng2 * Math.PI) / 180;
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

function regionForPoints(points: LatLng[], paddingFactor = 1.5) {
 const lats = points.map((p) => p.latitude);
 const lngs = points.map((p) => p.longitude);
 const minLat = Math.min(...lats), maxLat = Math.max(...lats);
 const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
 return {
   latitude:       (minLat + maxLat) / 2,
   longitude:      (minLng + maxLng) / 2,
   latitudeDelta:  Math.max((maxLat - minLat) * paddingFactor, 0.01),
   longitudeDelta: Math.max((maxLng - minLng) * paddingFactor, 0.01),
 };
}

function OnlineToggle({ isOnline, onToggle }: { isOnline: boolean; onToggle: () => void }) {
 const anim = useRef(new Animated.Value(isOnline ? 1 : 0)).current;
 useEffect(() => {
   Animated.spring(anim, { toValue: isOnline ? 1 : 0, useNativeDriver: false, bounciness: 6 }).start();
 }, [isOnline]);
 const trackColor = anim.interpolate({ inputRange: [0, 1], outputRange: ['#c0392b', '#27ae60'] });
 const thumbLeft  = anim.interpolate({ inputRange: [0, 1], outputRange: [3, 62] });
 return (
   <TouchableOpacity onPress={onToggle} activeOpacity={0.85}>
     <Animated.View style={[tog.track, { backgroundColor: trackColor }]}>
       <Animated.View style={[tog.thumb, { left: thumbLeft }]} />
       <Text style={[tog.label, isOnline ? tog.labelRight : tog.labelLeft]}>
         {isOnline ? 'En ligne' : 'Hors ligne'}
       </Text>
     </Animated.View>
   </TouchableOpacity>
 );
}

function BikeMarker() {
 return (
   <View style={mk.wrap}>
     <View style={mk.circle}><Text style={mk.icon}>🏍️</Text></View>
     <View style={mk.shadow} />
   </View>
 );
}

function Toast({ msg, type, onClose }: { msg: string; type: 'warn' | 'info'; onClose: () => void }) {
 const anim = useRef(new Animated.Value(0)).current;
 useEffect(() => {
   Animated.sequence([
     Animated.timing(anim, { toValue: 1, duration: 300, useNativeDriver: true }),
     Animated.delay(3500),
     Animated.timing(anim, { toValue: 0, duration: 300, useNativeDriver: true }),
   ]).start(onClose);
 }, []);
 const bg = type === 'warn' ? '#b91c1c' : '#1e40af';
 return (
   <Animated.View style={[s.toast, { backgroundColor: bg, opacity: anim,
     transform: [{ translateY: anim.interpolate({ inputRange: [0,1], outputRange: [-60, 0] }) }] }]}>
     <Text style={s.toastText}>{msg}</Text>
   </Animated.View>
 );
}

function CustomerHistoryModal({
 visible, onClose, customers,
}: {
 visible: boolean;
 onClose: () => void;
 customers: CustomerRecord[];
}) {
 const [filter, setFilter]     = useState<'all' | CustomerStatus>('all');
 const [search, setSearch]     = useState('');
 const [editing, setEditing]   = useState<string | null>(null);

 const filtered = customers.filter(c => {
   const matchFilter = filter === 'all' || c.status === filter;
   const matchSearch = c.name.includes(search) || c.phone.includes(search);
   return matchFilter && matchSearch;
 });

 const thiefCount = customers.filter(c => c.status === 'thief').length;

 return (
   <Modal visible={visible} animationType="slide" transparent={false}>
     <View style={ch.container}>
       <View style={ch.header}>
         <TouchableOpacity onPress={onClose} style={ch.closeBtn}>
           <Text style={ch.closeTxt}>✕</Text>
         </TouchableOpacity>
         <Text style={ch.title}>👥 سجل الزبائن</Text>
         <View style={ch.badge}>
           <Text style={ch.badgeTxt}>{customers.length}</Text>
         </View>
       </View>

       {thiefCount > 0 && (
         <View style={ch.alertBanner}>
           <Text style={ch.alertIcon}>🚨</Text>
           <Text style={ch.alertTxt}>
             تحذير لكل السائقين: {thiefCount} زبون مُصنَّف سارق
           </Text>
         </View>
       )}

       <View style={ch.searchWrap}>
         <Text style={ch.searchIcon}>🔍</Text>
         <TextInput
           style={ch.searchInput}
           placeholder="ابحث بالاسم أو الجوال..."
           placeholderTextColor="#666"
           value={search}
           onChangeText={setSearch}
         />
       </View>

       <ScrollView horizontal showsHorizontalScrollIndicator={false}
         style={ch.filterScroll} contentContainerStyle={ch.filterRow}>
         {(['all', 'good', 'average', 'bad', 'thief'] as const).map(f => {
           const cnt = f === 'all' ? customers.length : customers.filter(c => c.status === f).length;
           const cfg = f === 'all' ? null : STATUS_CONFIG[f];
           return (
             <TouchableOpacity key={f} onPress={() => setFilter(f)}
               style={[ch.chip,
                 filter === f && { backgroundColor: cfg?.color ?? '#3b82f6', borderColor: cfg?.color ?? '#3b82f6' },
                 { borderColor: cfg?.color ?? '#3b82f6' },
               ]}>
               <Text style={[ch.chipTxt, filter === f && { color: '#fff' }]}>
                 {f === 'all' ? `الكل (${cnt})` : `${cfg!.icon} ${cfg!.label} (${cnt})`}
               </Text>
             </TouchableOpacity>
           );
         })}
       </ScrollView>

       <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
         {filtered.length === 0 && (
           <View style={ch.empty}>
             <Text style={ch.emptyIcon}>👤</Text>
             <Text style={ch.emptyTxt}>لا توجد نتائج</Text>
           </View>
         )}
         {filtered.map(c => {
           const cfg = STATUS_CONFIG[c.status];
           const isExpanded = editing === c.id;
           const hasComplaints = (c.complaints ?? 0) > 0;
           return (
             <View key={c.id} style={[ch.card, { borderColor: cfg.color + '44' }]}>
               <TouchableOpacity style={ch.cardHeader}
                 onPress={() => setEditing(isExpanded ? null : c.id)}>
                 <View style={[ch.avatarCircle, { backgroundColor: cfg.bg }]}>
                   <Text style={{ fontSize: 20 }}>{cfg.icon}</Text>
                 </View>
                 <View style={{ flex: 1 }}>
                   <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                     <Text style={ch.cardName}>{c.name}</Text>
                     {hasComplaints && (
                       <View style={ch.sharedBadge}>
                         <Text style={ch.sharedTxt}>مُبلَّغ عنه 🔔</Text>
                       </View>
                     )}
                   </View>
                   <Text style={ch.cardPhone}>{c.phone} • {c.trips} رحلات</Text>
                   {hasComplaints && (
                     <Text style={ch.reportedBy}>
                       {(c.complaints ?? 0) >= 2
                         ? `🚨 ${c.complaints} سائقين بلّغوا: ${(c.reporters ?? []).join(', ')}`
                         : `⚠️ بلّغ عنه: ${(c.reporters ?? [])[0] ?? ''}`}
                     </Text>
                   )}
                 </View>
                 <View style={[ch.statusPill, { backgroundColor: cfg.bg, borderColor: cfg.color + '66' }]}>
                   <Text style={[ch.statusPillTxt, { color: cfg.color }]}>{cfg.label}</Text>
                 </View>
                 <Text style={ch.chevron}>{isExpanded ? '▲' : '▼'}</Text>
               </TouchableOpacity>

               {isExpanded && (
                 <View style={ch.expandedBody}>
                   {(c.reasons ?? []).length > 0 && (
                     <>
                       <Text style={ch.noteLabel}>أسباب التبليغ:</Text>
                       {(c.reasons ?? []).map((code) => (
                         <Text key={code} style={ch.reasonItem}>• {reasonLabel(code)}</Text>
                       ))}
                     </>
                   )}
                   <Text style={ch.lastDate}>آخر رحلة: {c.lastDate}</Text>
                 </View>
               )}
             </View>
           );
         })}
       </ScrollView>
     </View>
   </Modal>
 );
}

export default function AppDriver() {
 const router = useRouter();
 const requestBeepPlayer = useAudioPlayer(require('../../assets/sounds/beep.wav'));
 const prevRequestCountRef = useRef(0);

 const [checking,        setChecking]        = useState(true);
 const [name,            setName]            = useState('');
 const [phone,           setPhone]           = useState('');
 const [menuOpen,        setMenuOpen]        = useState(false);
 const [isOnline,        setIsOnline]        = useState(true);
 const [viewMode,        setViewMode]        = useState<'radar' | 'map'>('radar');
 const [location,        setLocation]        = useState<{ lat: number; lng: number } | null>(null);
 const [locLoading,      setLocLoading]      = useState(true);
 const [requests,        setRequests]        = useState<RideRequest[]>([]);
 const [selectedRequest, setSelectedRequest] = useState<RideRequest | null>(null);
 const [detailRequest,   setDetailRequest]   = useState<RideRequest | null>(null);
 const [activeRide,      setActiveRide]      = useState<RideRequest | null>(null);
 const [proposedPrice,   setProposedPrice]   = useState(0);
 const [routeLoading,    setRouteLoading]    = useState(false);

 const [customers,       setCustomers]       = useState<CustomerRecord[]>([]);
 const [customerPhotos,  setCustomerPhotos]  = useState<Record<string, string>>({}); // customerId → photoURL
 const [historyOpen,     setHistoryOpen]     = useState(false);
 const [toasts,          setToasts]          = useState<{ id: number; msg: string; type: 'warn' | 'info' }[]>([]);
 const [todayEarnings,   setTodayEarnings]   = useState(0);
 const [todayRides,      setTodayRides]      = useState(0);

 const [ratingVisible,   setRatingVisible]   = useState(false);
 const [ratingTarget,    setRatingTarget]    = useState<{ phone: string; name: string } | null>(null);

 const slideAnim    = useRef(new Animated.Value(-300)).current;
 const detailMapRef = useRef<MapView>(null);
 const mainMapRef   = useRef<MapView>(null);
 const toastId      = useRef(0);

 function pushToast(msg: string, type: 'warn' | 'info' = 'info') {
   const id = ++toastId.current;
   setToasts(prev => [...prev, { id, msg, type }]);
 }

 useEffect(() => {
   const unsub = onAuthStateChanged(auth, (user) => {
     if (!user) { router.replace('/login-driver'); return; }

     // تحميل بيانات السائق مع إعادة محاولة تلقائية عند انقطاع الإنترنت
     let cancelled = false;
     const loadDriverData = async () => {
       try {
         const snap = await getDoc(doc(db, 'drivers', user.uid));
         if (cancelled) return;
         const data = snap.data();
         if (!data || data.kyc_status !== 'approved') { router.replace('/login-driver'); return; }
         setName(data.name || '');
         setPhone(data.phone || '');
         setChecking(false);
         registerForPushNotificationsAsync('drivers').catch(() => {});
       } catch {
         if (!cancelled) setTimeout(loadDriverData, 3000);
       }
     };
     loadDriverData();
     return () => { cancelled = true; };
   });
   return unsub;
 }, []);

 useEffect(() => {
   (async () => {
     try {
       const { status } = await Location.requestForegroundPermissionsAsync();
       if (status !== 'granted') {
         setLocation({ lat: 36.7538, lng: 3.0588 });
         setLocLoading(false);
         return;
       }
       const pos = await Location.getCurrentPositionAsync({});
       setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
     } catch {
       setLocation({ lat: 36.7538, lng: 3.0588 });
     }
     setLocLoading(false);
   })();
 }, []);

 useEffect(() => {
   if (!auth.currentUser) return;
   let sub: Location.LocationSubscription | null = null;
   (async () => {
     const { status } = await Location.getForegroundPermissionsAsync();
     if (status !== 'granted') return;
     sub = await Location.watchPositionAsync(
       { accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 15 },
       (pos) => {
         const lat = pos.coords.latitude;
         const lng = pos.coords.longitude;
         setLocation({ lat, lng });
         updateDoc(doc(db, 'drivers', auth.currentUser!.uid), {
           lat, lng, updatedAt: serverTimestamp(), isOnline,
         }).catch(() => {});
       },
     );
   })();
   return () => { sub?.remove(); };
 }, [isOnline]);

 useEffect(() => {
   if (!location || !isOnline) { setRequests([]); return; }
   const q = query(
     collection(db, 'rides'),
     where('status', '==', 'pending'),
     orderBy('createdAt', 'desc'),
   );
   const unsub = onSnapshot(q, (snap) => {
     const reqs: RideRequest[] = snap.docs.map((d) => {
       const r = d.data();
       return {
         id:             d.id,
         customerId:     r.customerId ?? undefined,
         customerName:   r.customerName ?? 'زبون',
         phone:          r.customerPhone ?? '',
         customerRating: r.customerRating ?? 4.5,
         customerTrips:  r.customerTrips ?? 0,
         pickupLat:      r.pickupLat,
         pickupLng:      r.pickupLng,
         pickupAddress:  r.pickupAddress ?? 'موقع الزبون',
         destination:    r.destination ?? '',
         destinationLat: r.destLat,
         destinationLng: r.destLng,
         price:          r.price ?? 250,
         suggestedPrice: r.suggestedPrice ?? (r.price ?? 250),
         priceLabel:     '',
       };
     });
     setRequests(reqs);
   });
   return unsub;
 }, [location, isOnline]);

 // ── صوت تنبيه (bip) عند وصول طلب جديد — يعلو مستوى الصوت كلما كان الزبون الجديد أقرب ──
 useEffect(() => {
   if (requests.length > prevRequestCountRef.current && location) {
     let nearestKm = Infinity;
     for (const req of requests) {
       const d = haversineKm(location.lat, location.lng, req.pickupLat, req.pickupLng);
       if (d < nearestKm) nearestKm = d;
     }
     const proximityRatio = Math.min(nearestKm / RADAR_RANGE_KM, 1); // 0 = قريب جداً، 1 = بعيد
     requestBeepPlayer.volume = Math.max(1 - proximityRatio * 0.85, 0.45); // فرق واضح: قريب جداً = 1.0، بعيد = 0.45 (بدل فرق ضئيل سابقاً)
     try {
       requestBeepPlayer.seekTo(0);
       requestBeepPlayer.play();
     } catch {}
   }
   prevRequestCountRef.current = requests.length;
 }, [requests]);

 useEffect(() => {
   if (!activeRide) return;
   const unsub = onSnapshot(doc(db, 'rides', activeRide.id), (snap) => {
     const data = snap.data();
     if (!data) return;
     if (data.status === 'cancelled') {
       Alert.alert('تنبيه', 'ألغى الزبون الرحلة');
       if (auth.currentUser) {
         updateDoc(doc(db, 'drivers', auth.currentUser.uid), {
           activeCustomerId: null,
         }).catch(() => {});
       }
       setActiveRide(null);
     }
     if (data.status === 'completed') {
       setActiveRide(null);
     }
   });
   return unsub;
 }, [activeRide?.id]);

 useEffect(() => {
   const unsub = onSnapshot(collection(db, 'customerReports'), (snap) => {
     const recs: CustomerRecord[] = snap.docs.map((d) => {
       const r = d.data();
       return {
         id:          d.id,
         name:        r.name ?? '',
         phone:       d.id,
         status:      (r.status ?? 'good') as CustomerStatus,
         note:        r.note ?? '',
         trips:       r.trips ?? 0,
         lastDate:    r.lastDate ?? '',
         complaints:  r.complaints ?? 0,
         reporters:   r.reporters ?? [],
         reporterIds: r.reporterIds ?? [],
         reasons:     r.reasons ?? [],
         ratingSum:   r.ratingSum ?? 0,
         ratingCount: r.ratingCount ?? 0,
       };
     });
     setCustomers(recs);
   });
   return unsub;
 }, []);

 // متوسط النجوم الحقيقي لزبون معيّن — 5.0 افتراضياً لزبون جديد لم يُقيَّم بعد
 function getCustomerAvgRating(phone: string): { avg: number; count: number } {
   const rec = customers.find(c => c.phone === phone);
   if (!rec || rec.ratingCount === 0) return { avg: 5.0, count: 0 };
   return { avg: rec.ratingSum / rec.ratingCount, count: rec.ratingCount };
 }

 // ── جلب صورة الزبون الحقيقية (المرفوعة من settings.tsx) لعرضها على الرادار وبطاقات الطلبات ──
 useEffect(() => {
   const missing = requests
     .map(r => r.customerId)
     .filter((id): id is string => !!id && !(id in customerPhotos));
   if (missing.length === 0) return;
   missing.forEach(async (id) => {
     try {
       const snap = await getDoc(doc(db, 'users', id));
       const url = snap.data()?.photoURL;
       if (url) setCustomerPhotos(prev => ({ ...prev, [id]: url }));
     } catch {}
   });
 }, [requests]);

 function getCustomerRecord(phone: string): CustomerRecord | undefined {
   return customers.find(c => c.phone === phone);
 }

 const shownToastRef = useRef<Set<string>>(new Set());
 const openDetail = async (req: RideRequest) => {
   setDetailRequest(req);
   setProposedPrice(Math.round(req.price * 1.05));

   if (!shownToastRef.current.has(req.phone)) {
     shownToastRef.current.add(req.phone);
     const record = getCustomerRecord(req.phone);
     const complaints = record?.complaints ?? 0;
     if (complaints >= 2 || record?.status === 'thief') {
       pushToast(`🚨 ${req.customerName} — سارق! بلّغ عنه ${complaints} سائقين`, 'warn');
     } else if (complaints === 1 || record?.status === 'bad') {
       pushToast(`⚠️ ${req.customerName} — مُبلَّغ عنه مرة بسلوك سيئ`, 'warn');
     }
   }

   if (req.tripRoute && req.driverRoute) return;
   setRouteLoading(true);
   try {
     const [tripRoute, driverRoute] = await Promise.all([
       fetchOSRM(req.pickupLat, req.pickupLng, req.destinationLat, req.destinationLng),
       fetchOSRM(location!.lat, location!.lng, req.pickupLat, req.pickupLng),
     ]);
     const updated: RideRequest = { ...req, tripRoute, driverRoute };
     setRequests(prev => prev.map(r => r.id === req.id ? updated : r));
     setDetailRequest(updated);
   } catch {}
   setRouteLoading(false);
 };

 const closeDetail = () => setDetailRequest(null);

 const proposePrice = async (req: RideRequest, price: number) => {
   if (!auth.currentUser || !location) return;
   try {
     // ── جلب تقييم السائق الحقيقي (من تقييمات الزبائن) وعدد رحلاته الدائم قبل إرسال العرض ──
     let realRating = 5.0;
     let realTrips  = 0;
     try {
       const [driverRepSnap, driverDocSnap] = await Promise.all([
         getDoc(doc(db, 'driverReports', auth.currentUser.uid)),
         getDoc(doc(db, 'drivers', auth.currentUser.uid)),
       ]);
       const repData = driverRepSnap.data();
       if (repData?.ratingCount > 0) {
         realRating = repData.ratingSum / repData.ratingCount;
       }
       realTrips = driverDocSnap.data()?.totalTrips ?? 0;
     } catch {}

     await setDoc(doc(db, 'rides', req.id, 'offers', auth.currentUser.uid), {
       driverId:    auth.currentUser.uid,
       driverName:  name,
       driverPhone: phone,
       price,
       rating:      realRating,
       trips:       realTrips,
       etaMin:      req.driverRoute?.durationMin ?? 5,
       distKm:      req.driverRoute?.distanceKm ?? 1,
       lat:         location.lat,
       lng:         location.lng,
       createdAt:   serverTimestamp(),
     });

     try {
       const custRef  = doc(db, 'customerReports', req.phone);
       const custSnap = await getDoc(custRef);
       const custData = custSnap.data();
       await setDoc(custRef, {
         name:        req.customerName,
         trips:       custData?.trips ?? 0,
         lastDate:    custData?.lastDate ?? '',
         status:      custData?.status ?? 'good',
         note:        custData?.note ?? '',
         complaints:  custData?.complaints ?? 0,
         reporters:   custData?.reporters ?? [],
         reporterIds: custData?.reporterIds ?? [],
         reasons:     custData?.reasons ?? [],
         updatedAt:   serverTimestamp(),
       }, { merge: true });
     } catch {}

     // ── إلغاء أي طلبات أخرى معلّقة (pending) من نفس الزبون — تختفي فوراً من قائمة كل السائقين ──
     if (req.customerId) {
       try {
         const dupQ = query(
           collection(db, 'rides'),
           where('customerId', '==', req.customerId),
           where('status', '==', 'pending'),
         );
         const dupSnap = await getDocs(dupQ);
         await Promise.all(
           dupSnap.docs
             .filter(d => d.id !== req.id)
             .map(d => updateDoc(doc(db, 'rides', d.id), { status: 'cancelled' }).catch(() => {}))
         );
       } catch {}
     }

     Alert.alert('📤 تم الإرسال', `اقترحت ${price} DZD للعميل، بانتظار موافقته`);
     setDetailRequest(null);
     setSelectedRequest(null);
   } catch {
     Alert.alert('خطأ', 'تعذر إرسال العرض');
   }
 };

 useEffect(() => {
   if (!auth.currentUser) return;
   const q = query(
     collection(db, 'rides'),
     where('driverId', '==', auth.currentUser.uid),
     where('status', '==', 'accepted'),
   );
   const unsub = onSnapshot(q, (snap) => {
     if (snap.empty || activeRide) return;
     const d = snap.docs[0];
     const r = d.data();
     const req: RideRequest = {
       id:             d.id,
       customerName:   r.customerName ?? 'زبون',
       phone:          r.customerPhone ?? '',
       customerRating: r.customerRating ?? 4.5,
       customerTrips:  r.customerTrips ?? 0,
       pickupLat:      r.pickupLat,
       pickupLng:      r.pickupLng,
       pickupAddress:  r.pickupAddress ?? 'موقع الزبون',
       destination:    r.destination ?? '',
       destinationLat: r.destLat,
       destinationLng: r.destLng,
       price:          r.price,
       suggestedPrice: r.suggestedPrice ?? r.price,
       priceLabel:     '',
     };
     setActiveRide(req);
     setViewMode('map');
     updateDoc(doc(db, 'drivers', auth.currentUser!.uid), {
       activeCustomerId: r.customerId ?? null,
     }).catch(() => {});
     pushToast(`✅ وافق ${req.customerName} على عرضك — ${req.price} DZD`, 'info');

     // تكبير فوري على مستوى الشارع يشمل موقعي وموقع الزبون معاً
     if (location && mainMapRef.current) {
       mainMapRef.current.animateToRegion(
         regionForPoints([
           { latitude: location.lat, longitude: location.lng },
           { latitude: req.pickupLat, longitude: req.pickupLng },
         ], 1.8),
         700,
       );
     }

     // جلب مسار الاتجاه الحقيقي فوراً — كان مفقوداً سابقاً لأن activeRide يُبنى من جديد بدون بيانات المسار المحسوبة مسبقاً
     if (location) {
       Promise.all([
         fetchOSRM(req.pickupLat, req.pickupLng, req.destinationLat, req.destinationLng),
         fetchOSRM(location.lat, location.lng, req.pickupLat, req.pickupLng),
       ]).then(([tripRoute, driverRoute]) => {
         setActiveRide(prev => prev && prev.id === req.id ? { ...prev, tripRoute, driverRoute } : prev);
       }).catch(() => {});
     }
   });
   return unsub;
 }, [activeRide]);

 const markArrived = () => {
   if (!activeRide) return;
   // arrivedPing يزيد مع كل ضغطة — بهذا تتكرر إشارة الجرس + الاهتزاز عند الزبون في كل مرة، وليس مرة واحدة فقط
   updateDoc(doc(db, 'rides', activeRide.id), { status: 'arrived', arrivedPing: increment(1) }).catch(() => {});
   pushToast('📍 تم إعلام الزبون بوصولك', 'info');

   // تكبير الخريطة عند السائق نفسه أيضاً لحظة الوصول — كانت مفعّلة فقط عند الزبون سابقاً
   if (location && mainMapRef.current) {
     mainMapRef.current.animateToRegion(
       regionForPoints([
         { latitude: location.lat, longitude: location.lng },
         { latitude: activeRide.pickupLat, longitude: activeRide.pickupLng },
       ], 2.2),
       700,
     );
   }
 };

 const finishRide = () => {
   Alert.alert('إنهاء الرحلة', 'هل تريد إنهاء الرحلة الحالية؟', [
     { text: 'إلغاء', style: 'cancel' },
     {
       text: 'إنهاء', style: 'destructive', onPress: () => {
         if (activeRide) {
           updateDoc(doc(db, 'rides', activeRide.id), {
             status: 'completed', completedAt: serverTimestamp(),
           }).catch(() => {});
           if (auth.currentUser) {
             updateDoc(doc(db, 'drivers', auth.currentUser.uid), {
               activeCustomerId: null,
               totalTrips: increment(1), // ← عدد دائم، يبقى محفوظاً عبر كل الجلسات
             }).catch(() => {});
           }
           setTodayEarnings(e => e + activeRide.price);
           setTodayRides(r => r + 1);

           setRatingTarget({ phone: activeRide.phone, name: activeRide.customerName });
           setRatingVisible(true);
         }
         setActiveRide(null);
         setViewMode('radar');
         pushToast('🏁 تمت الرحلة بنجاح', 'info');
       },
     },
   ]);
 };

 const updateCustomerStatus = async (phone: string, status: CustomerStatus, reasonCode?: string) => {
   if (!auth.currentUser) return;
   const driverUid = auth.currentUser.uid;
   try {
     const custRef  = doc(db, 'customerReports', phone);
     const custSnap = await getDoc(custRef);
     const existing = custSnap.data();

     const reporters   = new Set<string>(existing?.reporters ?? []);
     const reporterIds = new Set<string>(existing?.reporterIds ?? []);
     const reasons      = new Set<string>(existing?.reasons ?? []);
     let complaints = existing?.complaints ?? 0;

     const isNegative = status === 'bad' || status === 'thief';
     if (isNegative && !reporterIds.has(driverUid)) {
       reporterIds.add(driverUid);
       reporters.add(name || 'سائق');
       complaints += 1;
       if (reasonCode) reasons.add(reasonCode);
     }

     // ── كل تقييم (جيد/متوسط/سيء) يُضاف لمتوسط النجوم الحقيقي، بغض النظر عن التبليغ ──
     const ratingSum   = (existing?.ratingSum ?? 0) + statusToStars(status);
     const ratingCount = (existing?.ratingCount ?? 0) + 1;

     await setDoc(custRef, {
       name:        existing?.name ?? '',
       trips:       existing?.trips ?? 0,
       lastDate:    existing?.lastDate ?? '',
       status,
       note:        existing?.note ?? '',
       complaints,
       reporters:   Array.from(reporters),
       reporterIds: Array.from(reporterIds),
       reasons:     Array.from(reasons),
       ratingSum,
       ratingCount,
       updatedAt:   serverTimestamp(),
     }, { merge: true });

     if (isNegative) {
       pushToast('🚨 تم إشعار جميع السائقين فوراً', 'warn');
     }
   } catch {
     Alert.alert('خطأ', 'تعذر تحديث حالة الزبون، تحقق من اتصالك');
   }
 };

 const callCustomer = (phoneNum: string) => Linking.openURL(`tel:${phoneNum}`);

 const openMenu = () => {
   setMenuOpen(true);
   Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start();
 };
 const closeMenu = () => {
   Animated.timing(slideAnim, { toValue: -300, duration: 250, useNativeDriver: true })
     .start(() => setMenuOpen(false));
 };
 const handleLogout = async () => {
   closeMenu();
   if (auth.currentUser) {
     updateDoc(doc(db, 'drivers', auth.currentUser.uid), { isOnline: false }).catch(() => {});
   }
   await signOut(auth);
   router.replace('/');
 };

 if (checking || locLoading || !location) {
   return (
     <View style={s.loadingWrap}>
       <ActivityIndicator size="large" color="#E8B84B" />
     </View>
   );
 }

 const detailRegion = detailRequest
   ? regionForPoints([
       { latitude: location.lat, longitude: location.lng },
       { latitude: detailRequest.pickupLat, longitude: detailRequest.pickupLng },
       { latitude: detailRequest.destinationLat, longitude: detailRequest.destinationLng },
     ])
   : undefined;

 const chip1 = detailRequest ? Math.round(detailRequest.price * 1.05) : 0;
 const chip2 = detailRequest ? Math.round(detailRequest.price * 1.18) : 0;

 const thiefCount = customers.filter(c => c.status === 'thief').length;

 function isFlagged(phone: string): boolean {
   const rec = customers.find(c => c.phone === phone);
   return rec?.status === 'thief' || rec?.status === 'bad';
 }
 function isThiefLevel(phone: string): boolean {
   return customers.find(c => c.phone === phone)?.status === 'thief' ?? false;
 }

 const radarPoints: RadarPoint[] = requests.map(req => ({
   id: req.id,
   angleDeg: bearingDeg(location.lat, location.lng, req.pickupLat, req.pickupLng),
   distanceRatio: haversineKm(location.lat, location.lng, req.pickupLat, req.pickupLng) / RADAR_RANGE_KM,
   photoURL: req.customerId ? customerPhotos[req.customerId] : undefined,
   thief: isThiefLevel(req.phone),
   flagged: isFlagged(req.phone),
 }));

 const showRadarScreen = isOnline && !activeRide && viewMode === 'radar';
 const showMapScreen   = !showRadarScreen;

 return (
   <View style={s.container}>

     {showRadarScreen && (
       <View style={s.radarScreen}>
         <View style={s.header}>
           <TouchableOpacity style={s.iconBtn} onPress={openMenu}>
             <Text style={s.menuIcon}>☰</Text>
           </TouchableOpacity>
           <OnlineToggle isOnline={isOnline} onToggle={() => setIsOnline(v => !v)} />
           <View style={s.iconBtnPlaceholder} />
         </View>

         <View style={s.toastStack}>
           {toasts.map(t => (
             <Toast key={t.id} msg={t.msg} type={t.type}
               onClose={() => setToasts(prev => prev.filter(x => x.id !== t.id))} />
           ))}
         </View>

         <View style={s.radarWrap}>
           <RadarScope
             online={isOnline}
             points={radarPoints}
             size={RADAR_SIZE}
             onPressPoint={(id) => {
               const req = requests.find(r => r.id === id);
               if (req) openDetail(req);
             }}
           />
           {requests.length === 0 ? (
             <Text style={s.radarHint}>
               {isOnline ? 'انتظر... ستظهر الطلبات هنا قريباً' : '🔴 أنت غير متصل. فعّل الاتصال لاستقبال الطلبات'}
             </Text>
           ) : (
             <Text style={s.radarCount}>📦 {requests.length} طلبات متاحة حولك</Text>
           )}
         </View>

         <ScrollView style={s.requestListWrap} contentContainerStyle={{ paddingBottom: 90 }}>
           {requests.map(req => {
             const rec         = customers.find(c => c.phone === req.phone);
             const cmp         = rec?.complaints ?? 0;
             const isThiefLvl2 = rec?.status === 'thief';
             const isBadLvl1   = rec?.status === 'bad';
             const distKm      = haversineKm(location.lat, location.lng, req.pickupLat, req.pickupLng);
             return (
               <TouchableOpacity key={req.id}
                 style={[s.orderCard,
                   isThiefLvl2 && { borderColor: '#ef4444', borderWidth: 1.5 },
                   isBadLvl1 && !isThiefLvl2 && { borderColor: '#f97316', borderWidth: 1.5 },
                 ]}
                 onPress={() => openDetail(req)}>
                 <View style={s.avatar}>
                   {req.customerId && customerPhotos[req.customerId] ? (
                     <Image source={{ uri: customerPhotos[req.customerId] }} style={s.avatarPhoto} />
                   ) : (
                     <Text style={s.avatarEmoji}>{isThiefLvl2 ? '🚨' : isBadLvl1 ? '⚠️' : '🙂'}</Text>
                   )}
                 </View>
                 <View style={{ flex: 1 }}>
                   <Text style={s.miniName}>{req.customerName}</Text>
                   <Text style={s.orderDistance}>يبعد عنك {distKm.toFixed(1)} كم</Text>
                   <Text style={s.miniRoute} numberOfLines={1}>
                     {req.pickupAddress} → {req.destination}
                   </Text>
                   {isThiefLvl2 && <Text style={s.thiefTag}>🚨 سارق — بلّغ عنه {cmp} سائقين</Text>}
                   {isBadLvl1 && !isThiefLvl2 && <Text style={[s.thiefTag, { color: '#f97316' }]}>⚠️ سلوك سيئ</Text>}
                 </View>
                 <View style={{ alignItems: 'flex-end' }}>
                   <Text style={s.miniPrice}>{req.price} DZD</Text>
                   {req.price >= req.suggestedPrice && (
                     <Text style={s.fairPriceTag}>✅ عادل</Text>
                   )}
                 </View>
               </TouchableOpacity>
             );
           })}
         </ScrollView>

         <TouchableOpacity style={s.goMapBtn} onPress={() => setViewMode('map')}>
           <Text style={s.goMapBtnText}>🗺️ الذهاب إلى خريطة الطلبات</Text>
         </TouchableOpacity>
       </View>
     )}

     {showMapScreen && (
       <>
         <MapView
           ref={mainMapRef}
           provider={PROVIDER_GOOGLE}
           style={s.fullMap}
           initialRegion={{
             latitude: location.lat, longitude: location.lng,
             latitudeDelta: 0.025, longitudeDelta: 0.025,
           }}
           showsMyLocationButton={false}
         >
           <Marker coordinate={{ latitude: location.lat, longitude: location.lng }}>
             <BikeMarker />
           </Marker>

           {!activeRide && requests.map(req => {
             const flagged = isFlagged(req.phone);
             const thief   = isThiefLevel(req.phone);
             return (
               <Marker key={req.id}
                 coordinate={{ latitude: req.pickupLat, longitude: req.pickupLng }}
                 onPress={() => setSelectedRequest(req)}>
                 <View style={[mk.reqDot, thief && { borderColor: '#ef4444', borderWidth: 3 }, flagged && !thief && { borderColor: '#f97316', borderWidth: 2 }]}>
                   <Text style={mk.reqDotText}>{thief ? '🚨' : flagged ? '⚠️' : '🙂'}</Text>
                 </View>
               </Marker>
             );
           })}

           {activeRide && (
             <>
               <Marker coordinate={{ latitude: activeRide.pickupLat, longitude: activeRide.pickupLng }}>
                 <View style={mk.markerA}><Text style={mk.markerLetter}>A</Text></View>
               </Marker>
               <Marker coordinate={{ latitude: activeRide.destinationLat, longitude: activeRide.destinationLng }}>
                 <View style={mk.markerB}><Text style={mk.markerLetter}>B</Text></View>
               </Marker>
               {activeRide.driverRoute?.coords && (
                 <Polyline coordinates={activeRide.driverRoute.coords}
                   strokeColor="#4A90E2" strokeWidth={5} lineDashPattern={[6, 4]} lineCap="round" />
               )}
               {activeRide.tripRoute?.coords && (
                 <Polyline coordinates={activeRide.tripRoute.coords}
                   strokeColor="#1a56b0" strokeWidth={5} lineCap="round" />
               )}
             </>
           )}
         </MapView>

         <View style={s.header}>
           <TouchableOpacity style={s.iconBtn} onPress={openMenu}>
             <Text style={s.menuIcon}>☰</Text>
           </TouchableOpacity>
           <OnlineToggle isOnline={isOnline} onToggle={() => setIsOnline(v => !v)} />
           <View style={s.iconBtnPlaceholder} />
         </View>

         {!activeRide && (
           <TouchableOpacity style={s.backToRadarBtn} onPress={() => setViewMode('radar')}>
             <Text style={s.backToRadarText}>📡 رجوع للرادار</Text>
           </TouchableOpacity>
         )}

         <View style={s.toastStack}>
           {toasts.map(t => (
             <Toast key={t.id} msg={t.msg} type={t.type}
               onClose={() => setToasts(prev => prev.filter(x => x.id !== t.id))} />
           ))}
         </View>

         {activeRide && (
           <View style={s.activeCard}>
             <View style={s.avatar}><Text style={s.avatarEmoji}>🙂</Text></View>
             <View style={{ flex: 1 }}>
               <Text style={s.miniName}>{activeRide.customerName}</Text>
               <Text style={s.activePhone}>📞 {activeRide.phone}</Text>
               <Text style={s.miniRoute} numberOfLines={1}>
                 {activeRide.pickupAddress} → {activeRide.destination}
               </Text>
             </View>
             <View style={{ gap: 6 }}>
               <TouchableOpacity style={s.callBtn} onPress={() => callCustomer(activeRide.phone)}>
                 <Text style={s.callBtnText}>📞 اتصال</Text>
               </TouchableOpacity>
               <TouchableOpacity style={[s.callBtn, { backgroundColor: '#4A90E2' }]} onPress={markArrived}>
                 <Text style={s.callBtnText}>📍 وصلت</Text>
               </TouchableOpacity>
               <TouchableOpacity style={s.finishBtn} onPress={finishRide}>
                 <Text style={s.finishBtnText}>إنهاء</Text>
               </TouchableOpacity>
             </View>
           </View>
         )}

         {!activeRide && selectedRequest && !detailRequest && (() => {
           const rec        = customers.find(c => c.phone === selectedRequest.phone);
           const complaints  = rec?.complaints ?? 0;
           const isThiefLvl  = rec?.status === 'thief';
           const isBadLvl    = rec?.status === 'bad';
           const bannerMsg   = isThiefLvl
             ? `🚨 سارق — بلّغ عنه ${complaints} سائقين`
             : isBadLvl ? `⚠️ سلوك سيئ — بلّغ عنه سائق واحد` : null;
           return (
             <View style={[s.miniCard, isThiefLvl && { borderTopColor: '#ef4444', borderTopWidth: 3 }]}>
               {bannerMsg && (
                 <View style={[s.thiefBanner, isBadLvl && !isThiefLvl && { backgroundColor: '#7c2d12' }]}>
                   <Text style={s.thiefBannerTxt}>{bannerMsg}</Text>
                 </View>
               )}
               <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: bannerMsg ? 8 : 0 }}>
                 <View style={s.avatar}><Text style={s.avatarEmoji}>{isThiefLvl ? '🚨' : isBadLvl ? '⚠️' : '🙂'}</Text></View>
                 <View style={{ flex: 1 }}>
                   <Text style={s.miniName}>{selectedRequest.customerName}</Text>
                   <Text style={s.miniRoute} numberOfLines={1}>
                     {selectedRequest.pickupAddress} → {selectedRequest.destination}
                   </Text>
                   <View style={s.ratingRow}>
                     <Text style={s.star}>★</Text>
                     <Text style={s.ratingVal}>{getCustomerAvgRating(selectedRequest.phone).avg.toFixed(1)}</Text>
                     <Text style={s.tripCount}> ({rec?.trips ?? 0} رحلة)</Text>
                   </View>
                 </View>
                 <View style={{ alignItems: 'flex-end', gap: 6 }}>
                   <Text style={s.miniPrice}>{selectedRequest.price} DZD</Text>
                   {selectedRequest.price >= selectedRequest.suggestedPrice && (
                     <Text style={s.fairPriceTag}>✅ سعر عادل</Text>
                   )}
                   <TouchableOpacity style={s.viewDetailBtn} onPress={() => openDetail(selectedRequest)}>
                     <Text style={s.viewDetailText}>التفاصيل ›</Text>
                   </TouchableOpacity>
                 </View>
               </View>
             </View>
           );
         })()}
       </>
     )}

     <Modal visible={!!detailRequest} transparent={false} animationType="slide">
       {detailRequest && (() => {
         const record     = getCustomerRecord(detailRequest.phone);
         const complaints = record?.complaints ?? 0;
         const isThiefLvl = record?.status === 'thief';
         const isBadLvl   = record?.status === 'bad';
         const cfg        = record ? STATUS_CONFIG[record.status] : null;
         return (
           <View style={s.detailContainer}>
             <MapView ref={detailMapRef} provider={PROVIDER_GOOGLE}
               style={s.detailMap} region={detailRegion} showsMyLocationButton={false}>
               {detailRequest.driverRoute?.coords && (
                 <Polyline coordinates={detailRequest.driverRoute.coords}
                   strokeColor="#4A90E2" strokeWidth={5} lineDashPattern={[6, 4]} lineCap="round" />
               )}
               {detailRequest.tripRoute?.coords && (
                 <Polyline coordinates={detailRequest.tripRoute.coords}
                   strokeColor="#1a56b0" strokeWidth={5} lineCap="round" />
               )}
               <Marker coordinate={{ latitude: detailRequest.pickupLat, longitude: detailRequest.pickupLng }}>
                 <View style={mk.markerA}><Text style={mk.markerLetter}>A</Text></View>
               </Marker>
               <Marker coordinate={{ latitude: detailRequest.destinationLat, longitude: detailRequest.destinationLng }}>
                 <View style={mk.markerB}><Text style={mk.markerLetter}>B</Text></View>
               </Marker>
               <Marker coordinate={{ latitude: location.lat, longitude: location.lng }}>
                 <BikeMarker />
               </Marker>
             </MapView>

             <View style={s.detailTitleBar}>
               <Text style={s.detailTitle}>Commande de course</Text>
             </View>

             {routeLoading && (
               <View style={s.routeLoadingBadge}>
                 <ActivityIndicator size="small" color="#E8B84B" />
                 <Text style={s.routeLoadingText}>جاري تحميل المسار...</Text>
               </View>
             )}

             <ScrollView style={s.detailSheet} contentContainerStyle={{ paddingBottom: 20 }}>
               {(isThiefLvl || isBadLvl) && (
                 <View style={[s.detailThiefAlert, isBadLvl && !isThiefLvl && { backgroundColor: '#7c2d12' }]}>
                   <Text style={s.detailThiefIcon}>{isThiefLvl ? '🚨' : '⚠️'}</Text>
                   <View style={{ flex: 1 }}>
                     <Text style={s.detailThiefTitle}>
                       {isThiefLvl
                         ? `سارق — بلّغ عنه ${complaints} سائقين`
                         : 'سلوك سيئ — بلّغ عنه سائق واحد'}
                     </Text>
                     {(record?.reasons ?? []).length > 0 && (
                       <Text style={s.detailThiefNote}>
                         {(record?.reasons ?? []).map(reasonLabel).join(' • ')}
                       </Text>
                     )}
                     {(record?.reporters ?? []).length > 0 && (
                       <Text style={s.detailThiefReporter}>
                         السائقون: {(record?.reporters ?? []).join('، ')}
                       </Text>
                     )}
                   </View>
                 </View>
               )}

               <View style={s.cardRow}>
                 <View style={s.avatar}>
                   <Text style={s.avatarEmoji}>{isThiefLvl ? '🚨' : isBadLvl ? '⚠️' : '🙂'}</Text>
                 </View>
                 <View style={{ flex: 1 }}>
                   <Text style={s.customerName}>{detailRequest.customerName}</Text>
                   <Text style={s.activePhone}>📞 {detailRequest.phone}</Text>
                   <View style={s.ratingRow}>
                     <Text style={s.star}>★</Text>
                     <Text style={s.ratingVal}>{getCustomerAvgRating(detailRequest.phone).avg.toFixed(1)}</Text>
                     <Text style={s.tripCount}> ({record?.trips ?? 0} رحلة)</Text>
                   </View>
                   {cfg && (
                     <View style={[s.statusBadge, { backgroundColor: cfg.bg, borderColor: cfg.color + '66' }]}>
                       <Text style={[s.statusBadgeTxt, { color: cfg.color }]}>{cfg.icon} {cfg.label}</Text>
                     </View>
                   )}
                   {detailRequest.driverRoute && (
                     <Text style={s.etaText}>⏱ {detailRequest.driverRoute.durationMin} min للوصول إليك</Text>
                   )}
                 </View>
                 <View style={{ alignItems: 'flex-end' }}>
                   {detailRequest.tripRoute && (
                     <Text style={s.detailKm}>~{detailRequest.tripRoute.distanceKm} km</Text>
                   )}
                   <Text style={s.detailPrice}>{detailRequest.price} DZD</Text>
                   {detailRequest.price >= detailRequest.suggestedPrice && (
                     <Text style={s.fairPriceTag}>✅ سعر عادل</Text>
                   )}
                 </View>
               </View>

               <View style={s.divider} />

               <View style={s.routeBlock}>
                 <View style={[s.routeBadge, { backgroundColor: '#4A90E2' }]}>
                   <Text style={s.routeBadgeLetter}>A</Text>
                 </View>
                 <Text style={s.routeText} numberOfLines={2}>{detailRequest.pickupAddress}</Text>
               </View>
               <View style={s.routeConnector} />
               <View style={s.routeBlock}>
                 <View style={[s.routeBadge, { backgroundColor: '#27ae60' }]}>
                   <Text style={s.routeBadgeLetter}>B</Text>
                 </View>
                 <Text style={s.routeText} numberOfLines={2}>{detailRequest.destination}</Text>
               </View>

               <View style={s.divider} />

               <Text style={s.proposeLabel}>الزبون طلب {detailRequest.price} DZD — اقترح سعرك</Text>
               <View style={s.proposeRow}>
                 <TouchableOpacity style={s.pmBtn}
                   onPress={() => setProposedPrice(p => Math.max(50, p - 10))}>
                   <Text style={s.pmBtnText}>−</Text>
                 </TouchableOpacity>
                 <TouchableOpacity style={[s.priceChip, proposedPrice === detailRequest.price && s.priceChipActive]}
                   onPress={() => setProposedPrice(detailRequest.price)}>
                   <Text style={s.priceChipText}>{detailRequest.price} DZD</Text>
                 </TouchableOpacity>
                 <TouchableOpacity style={[s.priceChip, proposedPrice === chip1 && s.priceChipActive]}
                   onPress={() => setProposedPrice(chip1)}>
                   <Text style={s.priceChipText}>{chip1} DZD</Text>
                 </TouchableOpacity>
                 <TouchableOpacity style={[s.priceChip, proposedPrice === chip2 && s.priceChipActive]}
                   onPress={() => setProposedPrice(chip2)}>
                   <Text style={s.priceChipText}>{chip2} DZD</Text>
                 </TouchableOpacity>
                 <TouchableOpacity style={s.pmBtn} onPress={() => setProposedPrice(p => p + 10)}>
                   <Text style={s.pmBtnText}>+</Text>
                 </TouchableOpacity>
               </View>
             </ScrollView>

             <View style={s.stickyFooter}>
               <TouchableOpacity
                 style={[s.acceptBigBtn, isThiefLvl && { backgroundColor: '#7f1d1d' }]}
                 onPress={() => proposePrice(detailRequest, proposedPrice)}>
                 <Text style={s.acceptBigText}>
                   {isThiefLvl ? '⚠️ إرسال العرض رغم التحذير' : `إرسال العرض — ${proposedPrice} DZD`}
                 </Text>
               </TouchableOpacity>
               <TouchableOpacity style={s.fermerBtn} onPress={closeDetail}>
                 <Text style={s.fermerText}>إغلاق  /  Fermer</Text>
               </TouchableOpacity>
             </View>
           </View>
         );
       })()}
     </Modal>

     <CustomerHistoryModal
       visible={historyOpen}
       onClose={() => setHistoryOpen(false)}
       customers={customers}
     />

     <RatingModal
       visible={ratingVisible}
       subjectName={ratingTarget?.name ?? ''}
       reasons={CUSTOMER_BAD_REASONS}
       onSubmit={(status: RatingStatus, reasonCode?: string) => {
         if (ratingTarget) updateCustomerStatus(ratingTarget.phone, status, reasonCode);
         setRatingVisible(false);
         setRatingTarget(null);
       }}
       onClose={() => { setRatingVisible(false); setRatingTarget(null); }}
     />

     <Modal visible={menuOpen} transparent animationType="none">
       <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={closeMenu} />
       <Animated.View style={[s.drawer, { transform: [{ translateX: slideAnim }] }]}>
         <View style={s.drawerHeader}>
           <Text style={s.drawerAppName}>Taxi Moto DZ</Text>
           <Text style={s.drawerSubtitle}>مرحباً {name} 🏍️</Text>
         </View>

         <View style={s.drawerStatsCard}>
           <View style={s.drawerStatItem}>
             <Text style={s.drawerStatVal}>{todayRides}</Text>
             <Text style={s.drawerStatLabel}>رحلات</Text>
           </View>
           <View style={s.drawerStatDivider} />
           <View style={s.drawerStatItem}>
             <Text style={[s.drawerStatVal, { color: '#E8B84B' }]}>{todayEarnings}</Text>
             <Text style={s.drawerStatLabel}>أرباح اليوم (DZD)</Text>
           </View>
           <View style={s.drawerStatDivider} />
           <View style={s.drawerStatItem}>
             <Text style={[s.drawerStatVal, thiefCount > 0 && { color: '#ef4444' }]}>{thiefCount}</Text>
             <Text style={s.drawerStatLabel}>سارقون</Text>
           </View>
         </View>

         <View style={s.drawerBody}>
           <TouchableOpacity style={s.menuItem} onPress={() => { closeMenu(); setHistoryOpen(true); }}>
             <Text style={s.menuEmoji}>👥</Text>
             <View style={{ flex: 1 }}>
               <Text style={s.menuItemText}>سجل الزبائن</Text>
             </View>
             {thiefCount > 0 && (
               <View style={s.drawerThiefBadge}>
                 <Text style={s.drawerThiefBadgeTxt}>🚨 {thiefCount}</Text>
               </View>
             )}
           </TouchableOpacity>
           <View style={s.menuDivider} />

           <TouchableOpacity style={s.menuItem} onPress={() => { closeMenu(); router.push('/history'); }}>
             <Text style={s.menuEmoji}>📋</Text>
             <Text style={s.menuItemText}>سجل الرحلات</Text>
           </TouchableOpacity>
           <View style={s.menuDivider} />

           <TouchableOpacity style={s.menuItem} onPress={() => { closeMenu(); router.push('/settings'); }}>
             <Text style={s.menuEmoji}>⚙️</Text>
             <Text style={s.menuItemText}>الإعدادات</Text>
           </TouchableOpacity>
           <View style={s.menuDivider} />

           <TouchableOpacity style={s.menuItem} onPress={handleLogout}>
             <Text style={s.menuEmoji}>🚪</Text>
             <Text style={[s.menuItemText, { color: '#e74c3c' }]}>تسجيل الخروج</Text>
           </TouchableOpacity>
         </View>

         <TouchableOpacity style={s.closeDrawerBtn} onPress={closeMenu}>
           <Text style={s.closeDrawerText}>✕ إغلاق</Text>
         </TouchableOpacity>
       </Animated.View>
     </Modal>
   </View>
 );
}

const tog = StyleSheet.create({
 track:      { width: 124, height: 36, borderRadius: 18, justifyContent: 'center', overflow: 'hidden' },
 thumb:      { position: 'absolute', width: 30, height: 30, borderRadius: 15, backgroundColor: '#fff', elevation: 3, shadowColor: '#000', shadowOpacity: 0.2, shadowOffset: { width: 0, height: 1 }, shadowRadius: 2 },
 label:      { position: 'absolute', fontSize: 10, fontWeight: '800', color: '#fff' },
 labelLeft:  { right: 7 },
 labelRight: { left: 7 },
});

const mk = StyleSheet.create({
 wrap:         { alignItems: 'center' },
 circle:       { width: 38, height: 38, borderRadius: 19, backgroundColor: '#1F2A40', borderWidth: 2.5, borderColor: '#E8B84B', justifyContent: 'center', alignItems: 'center', elevation: 5 },
 icon:         { fontSize: 20 },
 shadow:       { width: 10, height: 4, borderRadius: 5, backgroundColor: 'rgba(0,0,0,0.25)', marginTop: 2 },
 reqDot:       { width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#E8B84B', elevation: 3 },
 reqDotText:   { fontSize: 18 },
 markerA:      { width: 30, height: 30, borderRadius: 6, backgroundColor: '#4A90E2', justifyContent: 'center', alignItems: 'center', elevation: 4 },
 markerB:      { width: 30, height: 30, borderRadius: 6, backgroundColor: '#27ae60', justifyContent: 'center', alignItems: 'center', elevation: 4 },
 markerLetter: { color: '#FFF', fontWeight: '900', fontSize: 15 },
});

const ch = StyleSheet.create({
 container:    { flex: 1, backgroundColor: '#1C1C1E' },
 header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 54, paddingBottom: 16, backgroundColor: '#1F2A40' },
 closeBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: '#2C2C2E', justifyContent: 'center', alignItems: 'center' },
 closeTxt:     { color: '#FFF', fontSize: 16, fontWeight: '800' },
 title:        { fontSize: 18, fontWeight: '900', color: '#FFF' },
 badge:        { backgroundColor: '#E8B84B', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 },
 badgeTxt:     { fontSize: 13, fontWeight: '900', color: '#1a1a1a' },
 alertBanner:  { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#7f1d1d', paddingHorizontal: 16, paddingVertical: 12 },
 alertIcon:    { fontSize: 22 },
 alertTxt:     { flex: 1, color: '#fecaca', fontSize: 13, fontWeight: '700' },
 searchWrap:   { flexDirection: 'row', alignItems: 'center', margin: 14, backgroundColor: '#2C2C2E', borderRadius: 12, paddingHorizontal: 12, gap: 8 },
 searchIcon:   { fontSize: 16 },
 searchInput:  { flex: 1, paddingVertical: 12, fontSize: 14, color: '#FFF' },
 filterScroll: { maxHeight: 44 },
 filterRow:    { paddingHorizontal: 14, gap: 8, alignItems: 'center' },
 chip:         { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, backgroundColor: '#2C2C2E' },
 chipTxt:      { fontSize: 12, fontWeight: '700', color: '#FFF' },
 card:         { backgroundColor: '#2C2C2E', borderRadius: 14, marginBottom: 10, borderWidth: 1.5, overflow: 'hidden' },
 cardHeader:   { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
 avatarCircle: { width: 42, height: 42, borderRadius: 21, justifyContent: 'center', alignItems: 'center' },
 cardName:     { fontSize: 14, fontWeight: '700', color: '#FFF', marginBottom: 2 },
 cardPhone:    { fontSize: 12, color: '#8E8E93' },
 reportedBy:   { fontSize: 11, color: '#f87171', marginTop: 2 },
 sharedBadge:  { backgroundColor: '#1e3a5f', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
 sharedTxt:    { fontSize: 10, color: '#60a5fa', fontWeight: '700' },
 statusPill:   { borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1 },
 statusPillTxt:{ fontSize: 11, fontWeight: '800' },
 chevron:      { color: '#8E8E93', fontSize: 13, marginLeft: 4 },
 expandedBody: { padding: 14, paddingTop: 0, borderTopWidth: 1, borderTopColor: '#3A3A3C' },
 noteLabel:    { fontSize: 12, color: '#8E8E93', marginBottom: 6, marginTop: 12 },
 reasonItem:   { fontSize: 12, color: '#f87171', marginBottom: 3, textAlign: 'right' },
 lastDate:     { fontSize: 11, color: '#636366', marginTop: 10 },
 empty:        { alignItems: 'center', paddingTop: 60 },
 emptyIcon:    { fontSize: 48, marginBottom: 12 },
 emptyTxt:     { fontSize: 15, color: '#636366' },
});

const s = StyleSheet.create({
 loadingWrap:      { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111' },
 container:        { flex: 1, backgroundColor: '#111' },
 fullMap:          { width: '100%', height: '100%' },

 radarScreen:      { flex: 1, backgroundColor: '#14181f' },
 radarWrap:        { alignItems: 'center', marginTop: 100, marginBottom: 8 },
 radarHint:        { color: '#8E8E93', fontSize: 13, textAlign: 'center', marginTop: 14, paddingHorizontal: 40 },
 radarCount:       { color: '#8BC900', fontSize: 14, fontWeight: '800', textAlign: 'center', marginTop: 14 },
 requestListWrap:  { flex: 1, paddingHorizontal: 14, marginTop: 6 },
 orderCard:        { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#1C1C1E', borderRadius: 16, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#2C2C2E' },
 orderDistance:    { fontSize: 11, color: '#4A90E2', fontWeight: '700', marginVertical: 1 },
 goMapBtn:         { position: 'absolute', bottom: 16, left: 16, right: 16, backgroundColor: '#1F2A40', borderRadius: 16, paddingVertical: 15, alignItems: 'center', borderWidth: 1.5, borderColor: '#E8B84B' },
 goMapBtnText:     { color: '#E8B84B', fontSize: 14, fontWeight: '800' },
 backToRadarBtn:   { position: 'absolute', top: 100, alignSelf: 'center', backgroundColor: '#1F2A40', borderRadius: 20, paddingVertical: 10, paddingHorizontal: 18, borderWidth: 1.5, borderColor: '#E8B84B', elevation: 6 },
 backToRadarText:  { color: '#E8B84B', fontSize: 13, fontWeight: '800' },

 header:           { position: 'absolute', top: 48, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, zIndex: 5 },
 iconBtn:          { width: 42, height: 42, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, elevation: 4 },
 iconBtnPlaceholder: { width: 42, height: 42 },
 menuIcon:         { fontSize: 20, color: '#283447' },

 toastStack:       { position: 'absolute', top: 100, left: 16, right: 16, gap: 6, zIndex: 999 },
 toast:            { borderRadius: 12, padding: 12, paddingHorizontal: 16, elevation: 10 },
 toastText:        { color: '#FFF', fontSize: 13, fontWeight: '700', textAlign: 'right' },

 activeCard:       { position: 'absolute', top: 100, left: 12, right: 12, backgroundColor: '#1C1C1E', borderRadius: 16, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, elevation: 10, borderWidth: 1.5, borderColor: '#E8B84B' },
 activePhone:      { fontSize: 13, color: '#E8B84B', fontWeight: '700', marginVertical: 2 },
 callBtn:          { backgroundColor: '#27ae60', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
 callBtnText:      { color: '#FFF', fontSize: 12, fontWeight: '800' },
 finishBtn:        { backgroundColor: '#c0392b', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
 finishBtnText:    { color: '#FFF', fontSize: 12, fontWeight: '800' },

 miniCard:         { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#1C1C1E', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, elevation: 20 },
 thiefBanner:      { backgroundColor: '#7f1d1d', borderRadius: 10, padding: 10, marginBottom: 4 },
 thiefBannerTxt:   { color: '#fecaca', fontSize: 13, fontWeight: '700', textAlign: 'right' },
 thiefTag:         { fontSize: 11, color: '#f87171', fontWeight: '700', marginTop: 2 },
 viewDetailBtn:    { backgroundColor: '#E8B84B', borderRadius: 8, paddingVertical: 5, paddingHorizontal: 12 },
 viewDetailText:   { fontSize: 12, fontWeight: '700', color: '#1a1a1a' },

 avatar:           { width: 48, height: 48, borderRadius: 24, backgroundColor: '#2C2C2E', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
 avatarPhoto:      { width: '100%', height: '100%' },
 avatarEmoji:      { fontSize: 26 },
 miniName:         { fontSize: 14, fontWeight: '700', color: '#FFF', marginBottom: 2 },
 miniRoute:        { fontSize: 12, color: '#8E8E93' },
 miniPrice:        { fontSize: 15, fontWeight: '800', color: '#E8B84B' },
 fairPriceTag:     { fontSize: 10, fontWeight: '800', color: '#27ae60', marginTop: 2 },
 ratingRow:        { flexDirection: 'row', alignItems: 'center' },
 star:             { color: '#E8B84B', fontSize: 13 },
 ratingVal:        { fontSize: 13, fontWeight: '700', color: '#FFF' },
 tripCount:        { fontSize: 12, color: '#8E8E93' },
 customerName:     { fontSize: 16, fontWeight: '700', color: '#FFF', marginBottom: 3 },
 etaText:          { fontSize: 12, color: '#4A90E2', marginTop: 3, fontWeight: '600' },

 statusBadge:      { alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, marginTop: 4 },
 statusBadgeTxt:   { fontSize: 12, fontWeight: '800' },

 detailContainer:  { flex: 1, backgroundColor: '#1C1C1E' },
 detailMap:        { width: '100%', height: 280 },
 detailTitleBar:   { position: 'absolute', top: 44, left: 0, right: 0, alignItems: 'center' },
 detailTitle:      { fontSize: 20, fontWeight: '900', color: '#FFF', textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5 },
 routeLoadingBadge:{ position: 'absolute', top: 288, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#2C2C2E', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 14 },
 routeLoadingText: { fontSize: 12, color: '#E8B84B' },
 detailSheet:      { flex: 1, paddingHorizontal: 18, paddingTop: 20 },
 cardRow:          { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
 detailKm:         { fontSize: 13, color: '#8E8E93', marginBottom: 2 },
 detailPrice:      { fontSize: 22, fontWeight: '900', color: '#FFF', marginBottom: 2 },
 divider:          { height: 1, backgroundColor: '#2C2C2E', marginVertical: 14 },
 routeBlock:       { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
 routeBadge:       { width: 26, height: 26, borderRadius: 13, justifyContent: 'center', alignItems: 'center' },
 routeBadgeLetter: { color: '#FFF', fontWeight: '900', fontSize: 13 },
 routeConnector:   { width: 2, height: 14, backgroundColor: '#3A3A3C', marginLeft: 12, marginBottom: 6 },
 routeText:        { flex: 1, fontSize: 14, color: '#EBEBF5' },

 detailThiefAlert: { backgroundColor: '#7f1d1d', borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
 detailThiefIcon:  { fontSize: 24 },
 detailThiefTitle: { fontSize: 14, fontWeight: '900', color: '#fca5a5', marginBottom: 3 },
 detailThiefNote:  { fontSize: 12, color: '#fecaca' },
 detailThiefReporter: { fontSize: 11, color: '#f87171', marginTop: 3, fontStyle: 'italic' },

 stickyFooter:     { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 28, backgroundColor: '#1C1C1E', borderTopWidth: 1, borderTopColor: '#2C2C2E', elevation: 30 },
 acceptBigBtn:     { backgroundColor: '#F57C00', borderRadius: 16, paddingVertical: 17, alignItems: 'center', minHeight: 56, justifyContent: 'center' },
 acceptBigText:    { fontSize: 17, fontWeight: '900', color: '#FFF' },
 proposeLabel:     { fontSize: 14, color: '#8E8E93', textAlign: 'center', marginBottom: 12 },
 proposeRow:       { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
 pmBtn:            { width: 40, height: 40, borderRadius: 20, backgroundColor: '#3A3A3C', justifyContent: 'center', alignItems: 'center' },
 pmBtnText:        { fontSize: 22, fontWeight: '900', color: '#FFF' },
 priceChip:        { flex: 1, paddingVertical: 11, borderRadius: 12, backgroundColor: '#2C2C2E', alignItems: 'center' },
 priceChipActive:  { backgroundColor: '#3A3A3C', borderWidth: 1.5, borderColor: '#E8B84B' },
 priceChipText:    { fontSize: 12, fontWeight: '700', color: '#FFF' },
 fermerBtn:        { alignItems: 'center', paddingVertical: 10 },
 fermerText:       { fontSize: 13, color: '#8E8E93', fontWeight: '600' },

 backdrop:         { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
 drawer:           { position: 'absolute', top: 0, left: 0, bottom: 0, width: 280, backgroundColor: '#fff', elevation: 20 },
 drawerHeader:     { backgroundColor: '#1F2A40', padding: 24, alignItems: 'center', paddingTop: 56 },
 drawerAppName:    { color: '#E8B84B', fontSize: 18, fontWeight: '900' },
 drawerSubtitle:   { color: '#FFF', fontSize: 14, marginTop: 4 },
 drawerStatsCard:  { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F0EDE8', marginHorizontal: 16, marginTop: 14, borderRadius: 14, paddingVertical: 14 },
 drawerStatItem:   { flex: 1, alignItems: 'center' },
 drawerStatVal:    { fontSize: 17, fontWeight: '900', color: '#283447' },
 drawerStatLabel:  { fontSize: 10, color: '#8E8E93', fontWeight: '600', marginTop: 2, textAlign: 'center' },
 drawerStatDivider:{ width: 1, height: 30, backgroundColor: '#D9D4CB' },
 drawerBody:       { flex: 1, paddingTop: 14 },
 menuItem:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 22, gap: 14 },
 menuEmoji:        { fontSize: 22 },
 menuItemText:     { fontSize: 15, color: '#283447', fontWeight: '600' },
 menuDivider:      { height: 1, backgroundColor: '#F0EDE8', marginHorizontal: 20 },
 drawerThiefBadge: { backgroundColor: '#fef2f2', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
 drawerThiefBadgeTxt: { color: '#c0392b', fontSize: 11, fontWeight: '800' },
 closeDrawerBtn:   { margin: 20, backgroundColor: '#F0EDE8', borderRadius: 12, padding: 14, alignItems: 'center' },
 closeDrawerText:  { color: '#283447', fontWeight: '700', fontSize: 15 },
});
