import { useAudioPlayer } from 'expo-audio';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import {
  addDoc, collection, doc, getDoc, increment, onSnapshot,
  orderBy, query, serverTimestamp, setDoc, updateDoc
} from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Easing, Image, Keyboard,
  Linking, Modal, Platform, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, Vibration, View,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import RatingModal, { RatingStatus } from '../components/RatingModal';
import { registerForPushNotificationsAsync } from '../constants/pushNotifications';
import { useLanguage, type Lang } from '../contexts/LanguageContext';
import { auth, db } from '../utils/firebase';

const DRIVER_BAD_REASON_CODES = ['bad_driving', 'uncomfortable_bike', 'dangerous_driving', 'disrespectful'] as const;
const DRIVER_STATUS_CODES: RatingStatus[] = ['good', 'average', 'bad'];

type LatLng = { latitude: number; longitude: number };
type Stage = 'idle' | 'searching' | 'choosing' | 'tracking' | 'done';

type Driver = {
 id:       string;
 name:     string;
 phone:    string;
 photo:    string;
 rating:   number;
 trips:    number;
 price:    number;
 etaMin:   number;
 distKm:   number;
 lat:      number;
 lng:      number;
};

type DriverStatus = 'good' | 'average' | 'bad';

type DriverRecord = {
 id:          string;
 name:        string;
 status:      DriverStatus;
 complaints:  number;
 reporters:   string[];
 reporterIds: string[];
 reasons:     string[];
};

function reasonLabel(code: string, ct: Record<string, string>): string {
 const map: Record<string, string> = {
   bad_driving:         ct.reasonBadDriving,
   uncomfortable_bike:  ct.reasonUncomfortableBike,
   dangerous_driving: ct.reasonDangerousDriving,
   disrespectful:       ct.reasonDisrespectful,
 };
 return map[code] ?? code;
}

async function fetchRoute(
 fromLat: number, fromLng: number,
 toLat: number,   toLng: number,
): Promise<LatLng[]> {
 try {
   const url =
     `https://router.project-osrm.org/route/v1/driving/` +
     `${fromLng},${fromLat};${toLng},${toLat}` +
     `?overview=full&geometries=geojson`;
   const res  = await fetch(url);
   const json = await res.json();
   if (json.code !== 'Ok') return [];
   return json.routes[0].geometry.coordinates.map(
     ([lng, lat]: [number, number]) => ({ latitude: lat, longitude: lng })
   );
 } catch { return []; }
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

function computePrice(distKm: number): number {
 return Math.round(280 + 19 * distKm);
}

function regionFor(points: LatLng[], pad = 1.5) {
 const lats = points.map(p => p.latitude);
 const lngs = points.map(p => p.longitude);
 return {
   latitude:       (Math.min(...lats) + Math.max(...lats)) / 2,
   longitude:      (Math.min(...lngs) + Math.max(...lngs)) / 2,
   latitudeDelta:  Math.max((Math.max(...lats) - Math.min(...lats)) * pad, 0.01),
   longitudeDelta: Math.max((Math.max(...lngs) - Math.min(...lngs)) * pad, 0.01),
 };
}

function useRadarRing(delay: number) {
 const val = useRef(new Animated.Value(0)).current;
 useEffect(() => {
   let cancelled = false;
   const timer = setTimeout(() => {
     if (cancelled) return;
     Animated.loop(
       Animated.sequence([
         Animated.timing(val, {
           toValue: 1, duration: 1800,
           easing: Easing.out(Easing.ease), useNativeDriver: true,
         }),
         Animated.timing(val, { toValue: 0, duration: 0, useNativeDriver: true }),
       ]),
     ).start();
   }, delay);
   return () => { cancelled = true; clearTimeout(timer); };
 }, []);
 return val;
}

function SearchRadar() {
 const rings = [useRadarRing(0), useRadarRing(600), useRadarRing(1200)];
 return (
   <View style={radar.wrap}>
     {rings.map((a, i) => {
       const scale = a.interpolate({ inputRange: [0, 1], outputRange: [0.4, 2.4] });
       const opacity = a.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });
       return (
         <Animated.View
           key={i}
           style={[radar.ring, { transform: [{ scale }], opacity }]}
         />
       );
     })}
     <View style={radar.center}>
       <Text style={{ fontSize: 28 }}>🏍️</Text>
     </View>
   </View>
 );
}

type PlaceSuggestion = {
 id: string;
 mainText: string;
 secondaryText: string;
};

const GOOGLE_PLACES_API_KEY = 'AIzaSyDMRMFp__TH8IuSTcB6uh9vj_C1N06waXk';

const LANDMARK_TYPES = [
 'train_station', 'bus_station', 'shopping_mall',
 'hospital', 'university', 'stadium',
];

async function fetchLandmarkShortcuts(center: LatLng, radiusM = 4000): Promise<PlaceSuggestion[]> {
 const seen = new Set<string>();
 const results: PlaceSuggestion[] = [];

 for (const type of LANDMARK_TYPES) {
   if (results.length >= 10) break;
   try {
     const url =
       `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
       `?location=${center.latitude},${center.longitude}` +
       `&radius=${radiusM}` +
       `&type=${type}` +
       `&language=ar` +
       `&key=${GOOGLE_PLACES_API_KEY}`;
     const res = await fetch(url);
     const json = await res.json();
     if (json.status === 'ZERO_RESULTS') continue;
     if (json.status !== 'OK' || !Array.isArray(json.results)) continue;
     for (const r of json.results) {
       if (!r.place_id || seen.has(r.place_id) || !r.name) continue;
       const loc = r.geometry?.location;
       if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
         const distKm = haversineKm(center.latitude, center.longitude, loc.lat, loc.lng);
         if (distKm > 6) continue;
       }
       seen.add(r.place_id);
       results.push({ id: r.place_id, mainText: r.name, secondaryText: r.vicinity ?? '' });
       if (results.length >= 10) break;
     }
   } catch {}
 }
 return results;
}

async function searchPlacesGoogle(query: string, near: LatLng): Promise<PlaceSuggestion[]> {
 if (query.trim().length < 2) return [];
 const url =
   `https://maps.googleapis.com/maps/api/place/autocomplete/json` +
   `?input=${encodeURIComponent(query)}` +
   `&key=${GOOGLE_PLACES_API_KEY}` +
   `&language=ar` +
   `&components=country:dz` +
   `&location=${near.latitude},${near.longitude}` +
   `&radius=50000`;
 try {
   const res = await fetch(url);
   const json = await res.json();
   if (json.status === 'ZERO_RESULTS') return [];
   if (json.status !== 'OK' || !Array.isArray(json.predictions)) return [];

   const predictions: PlaceSuggestion[] = json.predictions.map((p: any) => ({
     id:             p.place_id,
     mainText:       p.structured_formatting?.main_text ?? p.description ?? '',
     secondaryText:  p.structured_formatting?.secondary_text ?? '',
   }));

   const top = json.predictions[0];
   const topTypes: string[] = top?.types ?? [];
   const topMainNorm = normalizeQuery(top?.structured_formatting?.main_text ?? '');
   const queryNorm = normalizeQuery(query);
   const confidentAreaMatch = queryNorm.length >= 3 && topMainNorm.startsWith(queryNorm);
   const isAreaQuery = confidentAreaMatch && (
     topTypes.includes('locality') || topTypes.includes('sublocality')
     || topTypes.includes('administrative_area_level_2') || topTypes.includes('political')
   );

   if (isAreaQuery && top?.place_id) {
     const adminKey = normalizeQuery(top.structured_formatting?.main_text ?? query);
     let landmarks = await getCachedLandmarks(adminKey);
     if (!landmarks) {
       const center = await fetchPlaceDetails(top.place_id);
       landmarks = center ? await fetchLandmarkShortcuts(center) : [];
       if (landmarks.length > 0) cacheLandmarks(adminKey, landmarks);
     }
     return [...predictions, ...landmarks];
   }

   return predictions;
 } catch { return []; }
}

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
 try {
   const url =
     `https://maps.googleapis.com/maps/api/geocode/json` +
     `?latlng=${lat},${lng}` +
     `&language=ar` +
     `&key=${GOOGLE_PLACES_API_KEY}`;
   const res  = await fetch(url);
   const json = await res.json();
   if (json.status !== 'OK' || !json.results?.length) return null;

   const validResults = json.results.filter((r: any) =>
     !/^unnamed road/i.test(r.formatted_address ?? '') &&
     !/طريق بدون اسم/.test(r.formatted_address ?? '')
   );
   const pool = validResults.length > 0 ? validResults : json.results;

   const priority = ['neighborhood', 'sublocality_level_1', 'sublocality', 'locality', 'route'];
   let preferred: any = null;
   for (const type of priority) {
     preferred = pool.find((r: any) => r.types?.includes(type));
     if (preferred) break;
   }
   preferred = preferred ?? pool[0];

   return preferred?.formatted_address ?? null;
 } catch { return null; }
}

async function fetchPlaceDetails(placeId: string): Promise<LatLng | null> {
 try {
   const snap = await getDoc(doc(db, 'placeDetailsCache', placeId));
   if (snap.exists()) {
     const data = snap.data();
     const updatedAtMs: number = data.updatedAt?.toMillis?.() ?? 0;
     if (Date.now() - updatedAtMs < PLACE_CACHE_TTL_MS && typeof data.lat === 'number') {
       return { latitude: data.lat, longitude: data.lng };
     }
   }
 } catch {}

 try {
   const url =
     `https://maps.googleapis.com/maps/api/place/details/json` +
     `?place_id=${placeId}` +
     `&fields=geometry` +
     `&key=${GOOGLE_PLACES_API_KEY}`;
   const res = await fetch(url);
   const json = await res.json();
   const loc = json.result?.geometry?.location;
   if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return null;
   setDoc(doc(db, 'placeDetailsCache', placeId), {
     lat: loc.lat, lng: loc.lng, updatedAt: serverTimestamp(),
   }, { merge: true }).catch(() => {});
   return { latitude: loc.lat, longitude: loc.lng };
 } catch { return null; }
}

const PLACE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PLACE_CACHE_VERSION = 'v8';

const LATIN_ACCENT_MAP: Record<string, string> = {
 'à':'a','â':'a','ä':'a','á':'a','ã':'a','å':'a',
 'ç':'c','ć':'c',
 'é':'e','è':'e','ê':'e','ë':'e',
 'î':'i','ï':'i','í':'i','ì':'i',
 'ô':'o','ö':'o','ó':'o','ò':'o','õ':'o',
 'ù':'u','û':'u','ü':'u','ú':'u',
 'ñ':'n',
 'ÿ':'y','ý':'y',
};

function stripLatinAccents(s: string): string {
 try {
   // @ts-ignore
   const n = s.normalize?.('NFD')?.replace(/[\u0300-\u036f]/g, '');
   if (n) return n;
 } catch {}
 return s.split('').map((ch) => LATIN_ACCENT_MAP[ch] ?? ch).join('');
}

// يزيل أي اقتراح مكان مكرر (نفس place_id) قد يظهر مرتين — مرة من البحث النصي ومرة من الأماكن المشهورة القريبة
function dedupeSuggestions(list: PlaceSuggestion[]): PlaceSuggestion[] {
  const seen = new Set<string>();
  return list.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

function normalizeQuery(q: string): string {
 let s = stripLatinAccents(q.trim().toLowerCase());
 s = s.replace(/[\u064B-\u065F\u0670]/g, '');
 s = s.replace(/[إأآا]/g, 'ا');
 s = s.replace(/[-_]/g, ' ');
 s = s.replace(/\s+/g, ' ').trim();
 s = s
   .split(' ')
   .map((tok) => tok.replace(/^ال(?=.)/, '').replace(/^(el|al)$/, ''))
   .filter(Boolean)
   .join(' ');
 s = s.replace(/[ةه]$/, 'ه');
 s = s.replace(/\//g, '-');
 return s;
}

async function getCachedPlaces(key: string): Promise<PlaceSuggestion[] | null> {
 try {
   const snap = await getDoc(doc(db, 'placeCache', `${PLACE_CACHE_VERSION}:${key}`));
   if (!snap.exists()) return null;
   const data = snap.data();
   const updatedAtMs: number = data.updatedAt?.toMillis?.() ?? 0;
   if (Date.now() - updatedAtMs > PLACE_CACHE_TTL_MS) return null;
   return Array.isArray(data.results) ? data.results : null;
 } catch { return null; }
}

function cachePlaces(key: string, originalQuery: string, results: PlaceSuggestion[]) {
 setDoc(doc(db, 'placeCache', `${PLACE_CACHE_VERSION}:${key}`), {
   query: originalQuery, results, updatedAt: serverTimestamp(), hits: increment(1),
 }, { merge: true }).catch(() => {});
}

async function getCachedLandmarks(adminKey: string): Promise<PlaceSuggestion[] | null> {
 try {
   const snap = await getDoc(doc(db, 'landmarksCache', `${PLACE_CACHE_VERSION}:${adminKey}`));
   if (!snap.exists()) return null;
   const data = snap.data();
   const updatedAtMs: number = data.updatedAt?.toMillis?.() ?? 0;
   if (Date.now() - updatedAtMs > PLACE_CACHE_TTL_MS) return null;
   return Array.isArray(data.results) ? data.results : null;
 } catch { return null; }
}

function cacheLandmarks(adminKey: string, results: PlaceSuggestion[]) {
 setDoc(doc(db, 'landmarksCache', `${PLACE_CACHE_VERSION}:${adminKey}`), {
   results, updatedAt: serverTimestamp(),
 }, { merge: true }).catch(() => {});
}

const CT: Record<Lang, Record<string, string>> = {
 ar: {
   whereTo:            '🏍️ أين تريد الذهاب؟',
   myLocation:         'موقعي الحالي',
   enterDestination:   'أدخل وجهتك...',
   locatingYou:        '⏳ جاري تحديد موقعك...',
   resultsCount:       'نتيجة',
   noResults:          'لا توجد نتائج لـ',
   fromGoogle:         'نتيجة من Google',
   yourPrice:          'سعرك المقترح للرحلة',
   priceLow:           '⚠️ أقل من السعر المقترح — قد يتأخر قبول السائقين',
   priceFair:          '✅ سعر عادل — الأرجح أن تجد سائقاً بسرعة',
   searchDriver:       'بحث عن سائق 🔍',
   sendingRequest:     '🔍 جاري إرسال طلبك للسائقين...',
   chooseDriver:       'اختر سائقاً',
   waitingOffers:      'بانتظار عروض السائقين...',
   cancel:             'إلغاء',
   driversWillAppear:  'سيظهر السائقون هنا فور استلامهم طلبك',
   minutes:            'دقائق',
   km:                 'كم',
   trip:               'رحلة',
   choose:             'اختر',
   driverArrivingIn:   'السائق يصل خلال',
   minute:             'دقيقة',
   driverArrived:      '🏍️ السائق وصل!',
   cancelRideTitle:    'إلغاء الرحلة',
   cancelRideMsg:      'هل تريد إلغاء الرحلة؟',
   no:                 'لا',
   yes:                'نعم',
   arrivedSafely:      'وصلت بسلامة!',
   thanksUsing:        'شكراً على استخدامك Taxi Moto DZ',
   newTrip:            'رحلة جديدة 🏍️',
   tripHistory:        'سجل الرحلات',
   settings:           'الإعدادات',
   logout:             'تسجيل الخروج',
   error:              'خطأ',
   notice:             'تنبيه',
   enterDestErr:       'أدخل وجهتك',
   pickFromSuggestions:'اختر وجهة من الاقتراحات',
   failedResolvePlace: 'تعذر تحديد موقع هذا المكان، جرّب اختيار اقتراح آخر',
   failedSendRequest:  'تعذر إرسال طلب الرحلة، تحقق من اتصالك',
   failedAccept:       'تعذر قبول السائق، حاول مجدداً',
   driverCancelled:    'ألغى السائق الرحلة، جاري البحث عن سائق آخر...',
   driverArrivedTitle: '🏍️ وصل السائق!',
   arrivedToYou:       'وصل إليك',
   ok:                 'حسناً',
   theDriver:          'السائق',
   ratingFailed:       'تعذر إرسال تقييمك، تحقق من اتصالك',
   reasonBadDriving:        'سيئ القيادة',
   reasonUncomfortableBike: 'الدراجة غير مريحة',
   reasonDangerousDriving:  'خطر أثناء السياقة',
   reasonDisrespectful:     'لا يحترم الزبائن',
   statusGood:    'جيد',
   statusAverage: 'متوسط',
   statusBad:     'سيء',
   badRatingsBy:  'زبائن قيّموه سيئاً',
   closeMenu:     '✕ إغلاق',
   ratingQuestion: 'كيف كانت تجربتك مع',
   ratingReasonTitle: 'ما سبب التقييم السيء؟',
   ratingSkip:    'تخطي',
   ratingBack:    '← رجوع',
 },
 fr: {
   whereTo:            '🏍️ Où voulez-vous aller ?',
   myLocation:         'Ma position actuelle',
   enterDestination:   'Entrez votre destination...',
   locatingYou:        '⏳ Localisation en cours...',
   resultsCount:       'résultat(s)',
   noResults:          'Aucun résultat pour',
   fromGoogle:         'résultat(s) de Google',
   yourPrice:          'Votre prix proposé pour le trajet',
   priceLow:           '⚠️ Inférieur au prix suggéré — les chauffeurs pourraient mettre plus de temps à accepter',
   priceFair:          '✅ Prix juste — vous trouverez probablement un chauffeur rapidement',
   searchDriver:       'Rechercher un chauffeur 🔍',
   sendingRequest:     '🔍 Envoi de votre demande aux chauffeurs...',
   chooseDriver:       'Choisissez un chauffeur',
   waitingOffers:      "En attente d'offres des chauffeurs...",
   cancel:             'Annuler',
   driversWillAppear:  'Les chauffeurs apparaîtront ici dès réception de votre demande',
   minutes:            'minutes',
   km:                 'km',
   trip:               'trajet',
   choose:             'Choisir',
   driverArrivingIn:   "Le chauffeur arrive dans",
   minute:             'minute',
   driverArrived:      '🏍️ Le chauffeur est arrivé !',
   cancelRideTitle:    'Annuler le trajet',
   cancelRideMsg:      'Voulez-vous annuler le trajet ?',
   no:                 'Non',
   yes:                'Oui',
   arrivedSafely:      'Vous êtes arrivé en toute sécurité !',
   thanksUsing:        "Merci d'utiliser Taxi Moto DZ",
   newTrip:            'Nouveau trajet 🏍️',
   tripHistory:        'Historique des trajets',
   settings:           'Paramètres',
   logout:             'Déconnexion',
   error:              'Erreur',
   notice:             'Avis',
   enterDestErr:       'Entrez votre destination',
   pickFromSuggestions:'Choisissez une destination parmi les suggestions',
   failedResolvePlace: "Impossible de localiser cet endroit, essayez une autre suggestion",
   failedSendRequest:  "Impossible d'envoyer la demande, vérifiez votre connexion",
   failedAccept:       "Impossible d'accepter le chauffeur, réessayez",
   driverCancelled:    "Le chauffeur a annulé le trajet, recherche d'un autre chauffeur...",
   driverArrivedTitle: '🏍️ Le chauffeur est arrivé !',
   arrivedToYou:       'est arrivé à votre position',
   ok:                 'OK',
   theDriver:          'Le chauffeur',
   ratingFailed:       "Impossible d'envoyer votre évaluation, vérifiez votre connexion",
   reasonBadDriving:        'Mauvaise conduite',
   reasonUncomfortableBike: 'Moto inconfortable',
   reasonDangerousDriving:  'Conduite dangereuse',
   reasonDisrespectful:     'Ne respecte pas les clients',
   statusGood:    'Bon',
   statusAverage: 'Moyen',
   statusBad:     'Mauvais',
   badRatingsBy:  "clients l'ont mal évalué",
   closeMenu:     '✕ Fermer',
   ratingQuestion: "Comment s'est passée votre expérience avec",
   ratingReasonTitle: 'Quelle est la raison de la mauvaise note ?',
   ratingSkip:    'Passer',
   ratingBack:    '← Retour',
 },
 en: {
   whereTo:            '🏍️ Where do you want to go?',
   myLocation:         'My current location',
   enterDestination:   'Enter your destination...',
   locatingYou:        '⏳ Locating you...',
   resultsCount:       'result(s)',
   noResults:          'No results for',
   fromGoogle:         'result(s) from Google',
   yourPrice:          'Your proposed price for the trip',
   priceLow:           '⚠️ Below the suggested price — drivers may take longer to accept',
   priceFair:          '✅ Fair price — you will likely find a driver quickly',
   searchDriver:       'Search for a driver 🔍',
   sendingRequest:     '🔍 Sending your request to drivers...',
   chooseDriver:       'Choose a driver',
   waitingOffers:      'Waiting for driver offers...',
   cancel:             'Cancel',
   driversWillAppear:  'Drivers will appear here once they receive your request',
   minutes:            'minutes',
   km:                 'km',
   trip:               'trip',
   choose:             'Choose',
   driverArrivingIn:   'Driver arriving in',
   minute:             'minute',
   driverArrived:      '🏍️ The driver has arrived!',
   cancelRideTitle:    'Cancel Ride',
   cancelRideMsg:      'Do you want to cancel the ride?',
   no:                 'No',
   yes:                'Yes',
   arrivedSafely:      'You arrived safely!',
   thanksUsing:        'Thank you for using Taxi Moto DZ',
   newTrip:            'New trip 🏍️',
   tripHistory:        'Trip history',
   settings:           'Settings',
   logout:             'Log out',
   error:              'Error',
   notice:             'Notice',
   enterDestErr:       'Enter your destination',
   pickFromSuggestions:'Choose a destination from the suggestions',
   failedResolvePlace: 'Could not locate this place, try another suggestion',
   failedSendRequest:  'Could not send the ride request, check your connection',
   failedAccept:       'Could not accept the driver, try again',
   driverCancelled:    'The driver cancelled the ride, searching for another driver...',
   driverArrivedTitle: '🏍️ The driver has arrived!',
   arrivedToYou:       'has arrived at your location',
   ok:                 'OK',
   theDriver:          'The driver',
   ratingFailed:       'Could not submit your rating, check your connection',
   reasonBadDriving:        'Poor driving',
   reasonUncomfortableBike: 'Uncomfortable bike',
   reasonDangerousDriving:  'Dangerous driving',
   reasonDisrespectful:     'Disrespectful to customers',
   statusGood:    'Good',
   statusAverage: 'Average',
   statusBad:     'Bad',
   badRatingsBy:  'customers rated them poorly',
   closeMenu:     '✕ Close',
   ratingQuestion: 'How was your experience with',
   ratingReasonTitle: 'What was the reason for the bad rating?',
   ratingSkip:    'Skip',
   ratingBack:    '← Back',
 },
};

export default function AppCustomer() {
 const router = useRouter();
 const { lang } = useLanguage();
 const ct = CT[lang];
 const isRTL = lang === 'ar';

 const [checking,     setChecking]     = useState(true);
 const [userName,     setUserName]     = useState('');
 const [userPhone,    setUserPhone]    = useState('');
 const [photoURL,     setPhotoURL]     = useState<string | null>(null);
 const [menuOpen,     setMenuOpen]     = useState(false);
 const [stage,        setStage]        = useState<Stage>('idle');
 const [location,     setLocation]     = useState<LatLng | null>(null);
 const [currentPlaceName, setCurrentPlaceName] = useState<string>(ct.myLocation);
 const [pickupText,   setPickupText]   = useState(ct.myLocation); // يظهر فوراً، ثم يُستبدل باسم الموقع الحقيقي بمجرد تحديده
 const [pickupCoords, setPickupCoords] = useState<LatLng | null>(null); // null = استخدم موقعي GPS الحالي فعلياً
 const [pickupManuallyEdited, setPickupManuallyEdited] = useState(false);
 const [searchTarget, setSearchTarget] = useState<'pickup' | 'destination'>('destination');
 const [destination,  setDestination]  = useState('');
 const [destCoords,   setDestCoords]   = useState<LatLng | null>(null);
 const [drivers,      setDrivers]      = useState<Driver[]>([]);
 const [chosenDriver, setChosenDriver] = useState<Driver | null>(null);
 const [routeCoords,  setRouteCoords]  = useState<LatLng[]>([]);
 const [driverPos,    setDriverPos]    = useState<LatLng | null>(null);
 const [etaMin,       setEtaMin]       = useState(0);
 const [rideId,       setRideId]       = useState<string | null>(null);
 const [suggestions,  setSuggestions]  = useState<PlaceSuggestion[]>([]);
 const [suggestLoading, setSuggestLoading] = useState(false);
 const [searchAttempted, setSearchAttempted] = useState(false);
 const [selectedDestCoords, setSelectedDestCoords] = useState<LatLng | null>(null);
 const [suggestedPrice, setSuggestedPrice] = useState<number | null>(null);
 const [customerPrice,  setCustomerPrice]  = useState<number | null>(null);

 const [driverReports, setDriverReports] = useState<DriverRecord[]>([]);
 const [ratingVisible, setRatingVisible] = useState(false);
 const [ratingTarget,  setRatingTarget]  = useState<{ id: string; name: string } | null>(null);

 const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
 const pendingQueryRef = useRef<string>('');

 const slideAnim   = useRef(new Animated.Value(-300)).current;
 const mapRef      = useRef<MapView>(null);
 const initialDistRef = useRef<number | null>(null);
 const arrivedFiredRef = useRef(false);
 const arrivedPingRef  = useRef(0); // آخر قيمة arrivedPing رآها الزبون — لاكتشاف كل ضغطة جديدة من السائق
 const bellPlayer = useAudioPlayer(require('../../assets/sounds/bell.wav'));
 const keyboardOffset  = useRef(new Animated.Value(0)).current;

 // جرس + اهتزاز 3 مرات متتالية ثم يتوقف — يُستدعى عند أول وصول حقيقي، وكل مرة يضغط السائق "وصلت" مجدداً
 const triggerArrivalAlert = () => {
   let count = 0;
   const fire = () => {
     if (count >= 3) return;
     count += 1;
     Vibration.vibrate(450);
     try { bellPlayer.seekTo(0); bellPlayer.play(); } catch {}
     setTimeout(fire, 750);
   };
   fire();
 };

 useEffect(() => {
   const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
   const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
   const showSub = Keyboard.addListener(showEvt, (e) => {
     Animated.timing(keyboardOffset, {
       toValue: e.endCoordinates.height,
       duration: Platform.OS === 'ios' ? e.duration ?? 250 : 200,
       useNativeDriver: true,
     }).start();
   });
   const hideSub = Keyboard.addListener(hideEvt, (e) => {
     Animated.timing(keyboardOffset, {
       toValue: 0,
       duration: Platform.OS === 'ios' ? e.duration ?? 200 : 200,
       useNativeDriver: true,
     }).start();
   });
   return () => { showSub.remove(); hideSub.remove(); };
 }, []);

 useEffect(() => {
   const unsub = onAuthStateChanged(auth, (user) => {
     if (!user) { router.replace('/login-customer'); return; }

     // تحميل بيانات الحساب مع إعادة محاولة تلقائية عند انقطاع الإنترنت —
     // لا حاجة لإغلاق التطبيق وإعادة فتحه، يتعافى وحده فور عودة الاتصال
     let cancelled = false;
     const loadUserData = async () => {
       try {
         const snap = await getDoc(doc(db, 'users', user.uid));
         if (cancelled) return;
         const data = snap.data();
         if (!data || data.role !== 'customer') {
           await signOut(auth); router.replace('/'); return;
         }
         setUserName(data.name || '');
         setUserPhone(data.phone || '');
         setPhotoURL(data.photoURL || null);
         setChecking(false);
         registerForPushNotificationsAsync('users').catch(() => {});
       } catch {
         // فشل التحميل (غالباً انقطاع إنترنت مؤقت) — أعد المحاولة تلقائياً بعد 3 ثوانٍ
         if (!cancelled) setTimeout(loadUserData, 3000);
       }
     };
     loadUserData();
     return () => { cancelled = true; };
   });
   return unsub;
 }, []);

 useEffect(() => {
   (async () => {
     const { status } = await Location.requestForegroundPermissionsAsync();
     const pos = status === 'granted'
       ? await Location.getCurrentPositionAsync({})
       : null;
     const newLocation = pos
       ? { latitude: pos.coords.latitude, longitude: pos.coords.longitude }
       : { latitude: 36.7538, longitude: 3.0588 };
     setLocation(newLocation);
     reverseGeocode(newLocation.latitude, newLocation.longitude).then((name) => {
       if (name) {
         setCurrentPlaceName(name);
         if (!pickupManuallyEdited) setPickupText(name); // تعبئة تلقائية فقط إن لم يعدّل الزبون الحقل بنفسه
       }
     });
     if (pendingQueryRef.current.trim().length >= 2) {
       performSearch(pendingQueryRef.current, newLocation);
     }
   })();
 }, []);

 useEffect(() => {
   if (!rideId || stage !== 'choosing') return;
   const q = query(
     collection(db, 'rides', rideId, 'offers'),
     orderBy('createdAt', 'asc'),
   );
   const unsub = onSnapshot(q, (snap) => {
     const offers: Driver[] = snap.docs.map((d) => {
       const o = d.data();
       return {
         id:     o.driverId ?? d.id,
         name:   o.driverName ?? 'سائق',
         phone:  o.driverPhone ?? '',
         photo:  '',
         rating: o.rating ?? 4.5,
         trips:  o.trips ?? 0,
         price:  o.price,
         etaMin: o.etaMin ?? 5,
         distKm: o.distKm ?? 1,
         lat:    o.lat,
         lng:    o.lng,
       };
     });
     setDrivers(offers);
   });
   return unsub;
 }, [rideId, stage]);

 useEffect(() => {
   const unsub = onSnapshot(collection(db, 'driverReports'), (snap) => {
     const recs: DriverRecord[] = snap.docs.map((d) => {
       const r = d.data();
       return {
         id:          d.id,
         name:        r.name ?? '',
         status:      (r.status ?? 'good') as DriverStatus,
         complaints:  r.complaints ?? 0,
         reporters:   r.reporters ?? [],
         reporterIds: r.reporterIds ?? [],
         reasons:     r.reasons ?? [],
       };
     });
     setDriverReports(recs);
   });
   return unsub;
 }, []);

 function getDriverRecord(driverId: string): DriverRecord | undefined {
   return driverReports.find(d => d.id === driverId);
 }

 useEffect(() => {
   if (!rideId) return;
   const unsub = onSnapshot(doc(db, 'rides', rideId), (snap) => {
     const data = snap.data();
     if (!data) return;

     if (data.status === 'accepted') {
       setChosenDriver((prev) => {
         if (prev && prev.id === data.driverId) return prev;
         return {
           id:     data.driverId,
           name:   data.driverName ?? 'سائق',
           phone:  data.driverPhone ?? '',
           photo:  '',
           rating: data.driverRating ?? 4.5,
           trips:  data.driverTrips ?? 0,
           price:  data.price,
           etaMin: data.etaMin ?? 5,
           distKm: data.distKm ?? 1,
           lat:    data.driverLat ?? 0,
           lng:    data.driverLng ?? 0,
         };
       });
       initialDistRef.current = null;
       arrivedFiredRef.current = false;
       setStage((s) => (s === 'tracking' ? s : 'tracking'));
     }

     if (data.status === 'arrived' && !arrivedFiredRef.current) {
       arrivedFiredRef.current = true;
       arrivedPingRef.current = data.arrivedPing ?? 0;
       triggerArrivalAlert();
       Alert.alert(ct.driverArrivedTitle, `${data.driverName ?? ct.theDriver} ${ct.arrivedToYou}`, [
         { text: ct.ok },
       ]);
       // تكبير الخريطة تلقائياً لرؤية دقيقة لموقعي وموقع السائق عند الوصول
       if (mapRef.current && location) {
         const driverPoint = driverPos ?? (
           typeof data.driverLat === 'number' && typeof data.driverLng === 'number'
             ? { latitude: data.driverLat, longitude: data.driverLng }
             : null
         );
         mapRef.current.animateToRegion(
           regionFor(driverPoint ? [location, driverPoint] : [location], 2.2),
           700,
         );
       }
     }

     // كل ضغطة جديدة على "وصلت" من السائق تزيد arrivedPing — نعيد الجرس والاهتزاز من جديد حتى لو سبق وصل
     if (arrivedFiredRef.current && typeof data.arrivedPing === 'number' && data.arrivedPing > arrivedPingRef.current) {
       arrivedPingRef.current = data.arrivedPing;
       triggerArrivalAlert();
     }

     if (data.status === 'completed') {
       setStage('done');
     }

     if (data.status === 'cancelled_by_driver') {
       Alert.alert(ct.notice, ct.driverCancelled);
       setStage('choosing');
       setChosenDriver(null);
       setDriverPos(null);
     }
   });
   return unsub;
 }, [rideId]);

 useEffect(() => {
   if (stage === 'done' && chosenDriver) {
     setRatingTarget({ id: chosenDriver.id, name: chosenDriver.name });
     setRatingVisible(true);
   }
 }, [stage]);

 useEffect(() => {
   if (stage !== 'tracking' || !chosenDriver?.id) return;
   const unsub = onSnapshot(doc(db, 'drivers', chosenDriver.id), (snap) => {
     const d = snap.data();
     if (!d || typeof d.lat !== 'number' || typeof d.lng !== 'number') return;

     setDriverPos({ latitude: d.lat, longitude: d.lng });

     if (location) {
       const dist = haversineKm(d.lat, d.lng, location.latitude, location.longitude);
       if (initialDistRef.current == null || dist > initialDistRef.current) {
         initialDistRef.current = Math.max(dist, 0.05);
       }
       const ratio = Math.max(0, Math.min(1, dist / initialDistRef.current));
       setEtaMin(Math.round(ratio * (chosenDriver.etaMin || 5)));

       if (dist < 0.05 && !arrivedFiredRef.current) {
         arrivedFiredRef.current = true;
         if (rideId) updateDoc(doc(db, 'rides', rideId), { status: 'arrived' }).catch(() => {});
       }
     }
   });
   return unsub;
 }, [stage, chosenDriver?.id]);

 const performSearch = async (text: string, currentLocation: LatLng) => {
   if (text.trim().length < 2) { setSuggestions([]); return; }
   setSuggestLoading(true);
   setSearchAttempted(false);
   try {
     const key = normalizeQuery(text);
     const cached = await getCachedPlaces(key);
     if (cached && cached.length > 0) {
       const unique = dedupeSuggestions(cached);
       setSuggestions(unique);
       cachePlaces(key, text, unique);
       return;
     }
     const results = dedupeSuggestions(await searchPlacesGoogle(text, currentLocation));
     setSuggestions(results);
     if (results.length > 0) cachePlaces(key, text, results);
   } catch {
     setSuggestions([]);
   } finally {
     setSuggestLoading(false);
     setSearchAttempted(true);
   }
 };

 const onDestinationChange = (text: string) => {
   setSearchTarget('destination');
   setDestination(text);
   setSelectedDestCoords(null);
   setSuggestedPrice(null);
   setCustomerPrice(null);
   setSearchAttempted(false);
   if (debounceRef.current) clearTimeout(debounceRef.current);

   if (text.trim().length < 2) {
     setSuggestions([]);
     pendingQueryRef.current = '';
     return;
   }

   pendingQueryRef.current = text;

   if (!location) {
     setSuggestLoading(true);
     return;
   }

   debounceRef.current = setTimeout(() => {
     performSearch(text, location);
   }, 450);
 };

 // نفس منطق حقل الوجهة، لكن لنقطة الانطلاق — تسمح للزبون بكتابة أي مكان بدل الاكتفاء بموقعه GPS الحالي فقط
 const onPickupChange = (text: string) => {
   setSearchTarget('pickup');
   setPickupText(text);
   setPickupCoords(null);
   setPickupManuallyEdited(true);
   setSearchAttempted(false);
   if (debounceRef.current) clearTimeout(debounceRef.current);

   if (text.trim().length < 2) {
     setSuggestions([]);
     pendingQueryRef.current = '';
     return;
   }

   pendingQueryRef.current = text;

   if (!location) {
     setSuggestLoading(true);
     return;
   }

   debounceRef.current = setTimeout(() => {
     performSearch(text, location);
   }, 450);
 };

 // إعادة نقطة الانطلاق لموقع GPS الحقيقي الحالي بضغطة واحدة
 const resetPickupToCurrentLocation = () => {
   setPickupText(currentPlaceName);
   setPickupCoords(null);
   setPickupManuallyEdited(false);
   setSuggestions([]);
 };

 const pickSuggestion = async (p: PlaceSuggestion) => {
   const target = searchTarget;
   if (target === 'pickup') { setPickupText(p.mainText); } else { setDestination(p.mainText); }
   setSuggestions([]);
   setSearchAttempted(false);
   pendingQueryRef.current = '';
   Keyboard.dismiss();

   setSuggestLoading(true);
   const coords = await fetchPlaceDetails(p.id);
   setSuggestLoading(false);

   if (!coords) {
     Alert.alert(ct.error, ct.failedResolvePlace);
     return;
   }

   if (target === 'pickup') {
     setPickupCoords(coords);
     // إعادة حساب السعر إذا كانت الوجهة محددة مسبقاً — المسافة الحقيقية تغيّرت بتغيّر نقطة الانطلاق
     if (selectedDestCoords) {
       const distKm = haversineKm(coords.latitude, coords.longitude, selectedDestCoords.latitude, selectedDestCoords.longitude);
       const price = computePrice(distKm);
       setSuggestedPrice(price);
       setCustomerPrice(price);
     }
   } else {
     setSelectedDestCoords(coords);
     const originPoint = pickupCoords ?? location;
     if (originPoint) {
       const distKm = haversineKm(originPoint.latitude, originPoint.longitude, coords.latitude, coords.longitude);
       const price = computePrice(distKm);
       setSuggestedPrice(price);
       setCustomerPrice(price);
     }
   }
 };

 const openMenu = () => {
   setMenuOpen(true);
   Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start();
 };
 const closeMenu = () => {
   Animated.timing(slideAnim, { toValue: -300, duration: 250, useNativeDriver: true })
     .start(() => setMenuOpen(false));
 };
 const handleLogout = async () => { closeMenu(); await signOut(auth); router.replace('/'); };

 const searchDrivers = async () => {
   if (!destination.trim()) { Alert.alert(ct.error, ct.enterDestErr); return; }
   if (!selectedDestCoords) {
     return Alert.alert(ct.error, ct.pickFromSuggestions);
   }
   // إذا عدّل الزبون نقطة الانطلاق يدوياً لكن لم يختر اقتراحاً فعلياً، لا نملك إحداثيات دقيقة له
   if (pickupManuallyEdited && !pickupCoords) {
     return Alert.alert(ct.error, ct.pickFromSuggestions);
   }
   if (!location || !auth.currentUser) return;
   setStage('searching');
   setSuggestions([]);

   const origin: LatLng = pickupCoords ?? location; // نقطة الانطلاق الفعلية — مخصصة أو موقعي الحالي
   const originAddress = pickupCoords ? pickupText : currentPlaceName;

   const dest: LatLng = selectedDestCoords;
   setDestCoords(dest);

   const coords = await fetchRoute(origin.latitude, origin.longitude, dest.latitude, dest.longitude);
   setRouteCoords(coords);

   const distKm = haversineKm(origin.latitude, origin.longitude, dest.latitude, dest.longitude);
   const finalSuggested = suggestedPrice ?? computePrice(distKm);
   const finalPrice     = customerPrice  ?? finalSuggested;

   try {
     const rideRef = await addDoc(collection(db, 'rides'), {
       customerId:      auth.currentUser.uid,
       customerName:    userName,
       customerPhone:   userPhone,
       pickupLat:       origin.latitude,
       pickupLng:       origin.longitude,
       pickupAddress:   originAddress,
       destLat:         dest.latitude,
       destLng:         dest.longitude,
       destination,
       price:           finalPrice,
       suggestedPrice:  finalSuggested,
       status:          'pending',
       createdAt:       serverTimestamp(),
     });
     setRideId(rideRef.id);
     setStage('choosing');
   } catch (e) {
     Alert.alert(ct.error, ct.failedSendRequest);
     setStage('idle');
     return;
   }

   if (mapRef.current) {
     mapRef.current.animateToRegion(regionFor([origin, dest]), 800);
   }
 };

 const acceptDriver = async (driver: Driver) => {
   if (!rideId) return;
   try {
     await updateDoc(doc(db, 'rides', rideId), {
       status:        'accepted',
       driverId:      driver.id,
       driverName:    driver.name,
       driverPhone:   driver.phone,
       driverRating:  driver.rating,
       driverTrips:   driver.trips,
       price:         driver.price,
       etaMin:        driver.etaMin,
       distKm:        driver.distKm,
     });
     setChosenDriver(driver);
     setStage('tracking');
   } catch {
     Alert.alert(ct.error, ct.failedAccept);
   }
 };

 const cancelRide = () => {
   if (rideId) {
     updateDoc(doc(db, 'rides', rideId), { status: 'cancelled' }).catch(() => {});
   }
   setStage('idle');
   setDrivers([]);
   setChosenDriver(null);
   setRouteCoords([]);
   setDestCoords(null);
   setDestination('');
   setRideId(null);
   setDriverPos(null);
   setSuggestedPrice(null);
   setCustomerPrice(null);
   setRatingVisible(false);
   setRatingTarget(null);
   initialDistRef.current = null;
   arrivedFiredRef.current = false;
   arrivedPingRef.current = 0;
 };

 const updateDriverStatus = async (driverId: string, status: DriverStatus, reasonCode?: string) => {
   if (!auth.currentUser) return;
   const customerUid = auth.currentUser.uid;
   try {
     const driverRef  = doc(db, 'driverReports', driverId);
     const driverSnap = await getDoc(driverRef);
     const existing    = driverSnap.data();

     const reporters   = new Set<string>(existing?.reporters ?? []);
     const reporterIds = new Set<string>(existing?.reporterIds ?? []);
     const reasons      = new Set<string>(existing?.reasons ?? []);
     let complaints = existing?.complaints ?? 0;

     const isNegative = status === 'bad';
     if (isNegative && !reporterIds.has(customerUid)) {
       reporterIds.add(customerUid);
       reporters.add(userName || 'زبون');
       complaints += 1;
       if (reasonCode) reasons.add(reasonCode);
     }

     const starValue   = status === 'good' ? 5 : status === 'average' ? 3 : 1;
     const ratingSum   = (existing?.ratingSum ?? 0) + starValue;
     const ratingCount = (existing?.ratingCount ?? 0) + 1;

     await setDoc(driverRef, {
       name:        existing?.name ?? ratingTarget?.name ?? '',
       status,
       complaints,
       reporters:   Array.from(reporters),
       reporterIds: Array.from(reporterIds),
       reasons:     Array.from(reasons),
       trips:       (existing?.trips ?? 0) + 1,
       ratingSum,
       ratingCount,
       updatedAt:   serverTimestamp(),
     }, { merge: true });
   } catch (e: any) {
     Alert.alert(ct.error, ct.ratingFailed);
   }
 };

 if (checking || !location) {
   return (
     <View style={{ flex:1, justifyContent:'center', alignItems:'center', backgroundColor:'#F7F4ED' }}>
       <ActivityIndicator size="large" color="#E8B84B" />
     </View>
   );
 }

 return (
   <View style={s.container}>

     <MapView
       ref={mapRef}
       provider={PROVIDER_GOOGLE}
       style={s.map}
       initialRegion={{ ...location, latitudeDelta: 0.02, longitudeDelta: 0.02 }}
       showsMyLocationButton={false}
     >
       <Marker coordinate={location}>
         <View style={s.myMarker}><Text style={{ fontSize:20 }}>📍</Text></View>
       </Marker>

       {destCoords && (
         <Marker coordinate={destCoords}>
           <View style={s.destMarker}><Text style={s.destMarkerText}>B</Text></View>
         </Marker>
       )}

       {routeCoords.length > 0 && (
         <Polyline coordinates={routeCoords} strokeColor="#1F2A40" strokeWidth={4} lineCap="round" />
       )}

       {stage === 'choosing' && drivers.map(d => (
         d.lat && d.lng ? (
           <Marker key={d.id} coordinate={{ latitude: d.lat, longitude: d.lng }}>
             <View style={s.driverMarker}>
               <Text style={{ fontSize:22 }}>🏍️</Text>
               <Text style={s.driverMarkerPrice}>{d.price}</Text>
             </View>
           </Marker>
         ) : null
       ))}

       {stage === 'tracking' && driverPos && (
         <Marker coordinate={driverPos}>
           <View style={s.trackingMarker}>
             <Text style={{ fontSize:28 }}>🏍️</Text>
           </View>
         </Marker>
       )}
     </MapView>

     <View style={s.header}>
       <TouchableOpacity style={s.iconBtn} onPress={openMenu}>
         <Text style={{ fontSize:22, color:'#283447' }}>☰</Text>
       </TouchableOpacity>
       <View style={s.headerCenter}>
         {photoURL
           ? <Image source={{ uri: photoURL }} style={s.headerAvatar} />
           : <View style={[s.headerAvatar, { justifyContent:'center', alignItems:'center', backgroundColor:'#F0EDE8' }]}>
               <Text style={{ fontSize:18 }}>👤</Text>
             </View>
         }
         <Text style={s.headerName}>{userName}</Text>
       </View>
       <TouchableOpacity style={s.iconBtn} onPress={() => router.push('/settings')}>
         <Text style={{ fontSize:20 }}>⚙️</Text>
       </TouchableOpacity>
     </View>

     {stage === 'idle' && (
       <Animated.View
         style={[
           s.bottomSheet,
           { transform: [{ translateY: Animated.multiply(keyboardOffset, -1) }] },
         ]}
       >
         <Text style={[s.sheetTitle, { textAlign: isRTL ? 'right' : 'left' }]}>{ct.whereTo}</Text>
         <View style={[s.inputWrap, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
           <Text style={s.inputIcon}>📍</Text>
           <TextInput
             style={s.input}
             placeholder={ct.myLocation}
             placeholderTextColor="#bbb"
             value={pickupText}
             onChangeText={onPickupChange}
             onFocus={() => setSearchTarget('pickup')}
             textAlign={isRTL ? 'right' : 'left'}
           />
           {pickupManuallyEdited && (
             <TouchableOpacity onPress={resetPickupToCurrentLocation}>
               <Text style={{ fontSize: 18 }}>🎯</Text>
             </TouchableOpacity>
           )}
         </View>
         <View style={[s.inputWrap, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
           <Text style={s.inputIcon}>🎯</Text>
           <TextInput
             style={s.input}
             placeholder={ct.enterDestination}
             placeholderTextColor="#bbb"
             value={destination}
             onChangeText={onDestinationChange}
             onFocus={() => setSearchTarget('destination')}
             textAlign={isRTL ? 'right' : 'left'}
             returnKeyType="search"
             onSubmitEditing={searchDrivers}
           />
           {suggestLoading && (
             <ActivityIndicator size="small" color="#E8B84B" style={{ marginLeft: 6 }} />
           )}
         </View>

         {!location && destination.trim().length >= 2 && (
           <Text style={{ color: '#888', fontSize: 12, textAlign: 'center', marginBottom: 8 }}>
             {ct.locatingYou}
           </Text>
         )}

         {suggestions.length > 0 && (
           <View style={s.suggestBox}>
             <Text style={{ fontSize: 11, color: '#aaa', textAlign: 'center', paddingVertical: 4 }}>
               {suggestions.length} {ct.resultsCount}
             </Text>
             <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 260 }}>
               {suggestions.map((p) => (
                 <TouchableOpacity
                   key={p.id}
                   style={[s.suggestRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
                   onPress={() => pickSuggestion(p)}
                 >
                   <View style={{ flex: 1 }}>
                     <Text style={[s.suggestTitle, { textAlign: isRTL ? 'right' : 'left' }]} numberOfLines={1}>{p.mainText}</Text>
                     {!!p.secondaryText && (
                       <Text style={[s.suggestSubtitle, { textAlign: isRTL ? 'right' : 'left' }]} numberOfLines={1}>{p.secondaryText}</Text>
                     )}
                   </View>
                 </TouchableOpacity>
               ))}
             </ScrollView>
           </View>
         )}

         {searchAttempted && !suggestLoading && suggestions.length === 0 &&
           !selectedDestCoords && destination.trim().length >= 2 && (
           <Text style={{ color: '#c0392b', fontSize: 12, textAlign: 'center', marginBottom: 8 }}>
             ⚠️ {ct.noResults} "{destination}" (0 {ct.fromGoogle})
           </Text>
         )}

         {customerPrice !== null && suggestedPrice !== null && (
           <View style={s.priceBox}>
             <Text style={s.priceBoxLabel}>{ct.yourPrice}</Text>
             <View style={s.priceEditRow}>
               <TouchableOpacity
                 style={s.priceStepBtn}
                 onPress={() => setCustomerPrice(p => Math.max(50, (p ?? 0) - 20))}>
                 <Text style={s.priceStepText}>−</Text>
               </TouchableOpacity>
               <Text style={s.priceValue}>{customerPrice} DZD</Text>
               <TouchableOpacity
                 style={s.priceStepBtn}
                 onPress={() => setCustomerPrice(p => (p ?? 0) + 20)}>
                 <Text style={s.priceStepText}>+</Text>
               </TouchableOpacity>
             </View>
             {customerPrice < suggestedPrice && (
               <Text style={s.priceHintLow}>{ct.priceLow}</Text>
             )}
             {customerPrice >= suggestedPrice && (
               <Text style={s.priceHintOk}>{ct.priceFair}</Text>
             )}
           </View>
         )}

         <TouchableOpacity style={s.searchBtn} onPress={searchDrivers}>
           <Text style={s.searchBtnText}>{ct.searchDriver}</Text>
         </TouchableOpacity>
       </Animated.View>
     )}

     {stage === 'searching' && (
       <View style={s.bottomSheet}>
         <SearchRadar />
         <Text style={s.searchingText}>{ct.sendingRequest}</Text>
       </View>
     )}

     {stage === 'choosing' && (
       <View style={s.bottomSheetTall}>
         <View style={[s.sheetRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
           <Text style={[s.sheetTitle, { textAlign: isRTL ? 'right' : 'left', marginBottom: 0 }]}>
             {drivers.length > 0 ? ct.chooseDriver : ct.waitingOffers}
           </Text>
           <TouchableOpacity onPress={cancelRide}>
             <Text style={s.cancelText}>{ct.cancel}</Text>
           </TouchableOpacity>
         </View>

         {drivers.length === 0 && (
           <View style={{ alignItems:'center', paddingVertical:20 }}>
             <ActivityIndicator color="#E8B84B" />
             <Text style={{ color:'#888', marginTop:10, fontSize:13 }}>
               {ct.driversWillAppear}
             </Text>
           </View>
         )}

         <ScrollView showsVerticalScrollIndicator={false}>
           {drivers.map(d => {
             const rec = getDriverRecord(d.id);
             const isBadLvl = rec?.status === 'bad';
             return (
               <TouchableOpacity
                 key={d.id}
                 style={[s.driverCard, { flexDirection: isRTL ? 'row-reverse' : 'row' }, isBadLvl && { borderWidth: 1.5, borderColor: '#f97316' }]}
                 onPress={() => acceptDriver(d)}
               >
                 <View style={s.driverAvatarWrap}>
                   <Text style={{ fontSize:30 }}>🏍️</Text>
                 </View>
                 <View style={s.driverInfo}>
                   <Text style={[s.driverName, { textAlign: isRTL ? 'right' : 'left' }]}>{d.name}</Text>
                   <View style={[s.driverMeta, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                     <Text style={s.driverRating}>★ {d.rating.toFixed(1)}</Text>
                     <Text style={s.driverTrips}> • {d.trips} {ct.trip}</Text>
                   </View>
                   <Text style={[s.driverEta, { textAlign: isRTL ? 'right' : 'left' }]}>⏱ {d.etaMin} {ct.minutes} • {d.distKm} {ct.km}</Text>
                   {isBadLvl && (
                     <Text style={[s.warnTag, { textAlign: isRTL ? 'right' : 'left' }]}>
                       ⚠️ {rec?.complaints} {ct.badRatingsBy}
                       {(rec?.reasons ?? []).length > 0 ? ` — ${(rec!.reasons).map(code => reasonLabel(code, ct)).join(' • ')}` : ''}
                     </Text>
                   )}
                 </View>
                 <View style={s.driverPriceWrap}>
                   <Text style={s.driverPrice}>{d.price}</Text>
                   <Text style={s.driverPriceSub}>DZD</Text>
                   <View style={s.acceptBtn}>
                     <Text style={s.acceptBtnText}>{ct.choose}</Text>
                   </View>
                 </View>
               </TouchableOpacity>
             );
           })}
         </ScrollView>
       </View>
     )}

     {stage === 'tracking' && chosenDriver && (
       <View style={s.trackingSheet}>
         <View style={s.etaBar}>
           <Text style={s.etaText}>
             {etaMin > 0 ? `⏱ ${ct.driverArrivingIn} ${etaMin} ${ct.minute}` : ct.driverArrived}
           </Text>
         </View>

         <View style={[s.trackingCard, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
           <View style={s.trackingAvatarWrap}>
             <Text style={{ fontSize:36 }}>🏍️</Text>
           </View>
           <View style={s.trackingInfo}>
             <Text style={[s.trackingName, { textAlign: isRTL ? 'right' : 'left' }]}>{chosenDriver.name}</Text>
             <View style={[s.trackingRatingRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
               <Text style={s.trackingRating}>★ {chosenDriver.rating.toFixed(1)}</Text>
               <Text style={s.trackingTrips}> • {chosenDriver.trips} {ct.trip}</Text>
             </View>
             <Text style={[s.trackingDest, { textAlign: isRTL ? 'right' : 'left' }]}>🎯 {destination}</Text>
             <Text style={[s.trackingPrice, { textAlign: isRTL ? 'right' : 'left' }]}>{chosenDriver.price} DZD</Text>
           </View>

           <View style={s.trackingBtns}>
             <TouchableOpacity
               style={s.callBtn}
               onPress={() => Linking.openURL(`tel:${chosenDriver.phone}`)}>
               <Text style={s.callBtnText}>📞</Text>
             </TouchableOpacity>
             <TouchableOpacity style={s.cancelSmallBtn} onPress={() => {
               Alert.alert(ct.cancelRideTitle, ct.cancelRideMsg, [
                 { text: ct.no, style: 'cancel' },
                 { text: ct.yes, style: 'destructive', onPress: cancelRide },
               ]);
             }}>
               <Text style={s.cancelSmallText}>✕</Text>
             </TouchableOpacity>
           </View>
         </View>

         <View style={s.progressBar}>
           <View style={[s.progressFill, {
             width: `${Math.max(5, 100 - (etaMin / (chosenDriver.etaMin || 1)) * 100)}%`
           }]} />
         </View>
       </View>
     )}

     {stage === 'done' && (
       <View style={s.bottomSheet}>
         <Text style={s.doneIcon}>✅</Text>
         <Text style={s.doneTitle}>{ct.arrivedSafely}</Text>
         <Text style={s.doneSub}>{ct.thanksUsing}</Text>
         <TouchableOpacity style={s.searchBtn} onPress={cancelRide}>
           <Text style={s.searchBtnText}>{ct.newTrip}</Text>
         </TouchableOpacity>
       </View>
     )}

     <Modal visible={menuOpen} transparent animationType="none">
       <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={closeMenu} />
       <Animated.View style={[s.drawer, { transform: [{ translateX: slideAnim }] }]}>
         <View style={s.drawerHeader}>
           {photoURL
             ? <Image source={{ uri: photoURL }} style={s.drawerAvatar} />
             : <View style={[s.drawerAvatar, { justifyContent:'center', alignItems:'center', backgroundColor:'#2C3E50' }]}>
                 <Text style={{ fontSize:30 }}>👤</Text>
               </View>
           }
           <Text style={s.drawerName}>{userName}</Text>
         </View>
         <View style={s.drawerBody}>
           <TouchableOpacity style={[s.menuItem, { flexDirection: isRTL ? 'row-reverse' : 'row' }]} onPress={() => { closeMenu(); router.push('/history'); }}>
             <Text style={s.menuEmoji}>📋</Text>
             <Text style={[s.menuItemText, { textAlign: isRTL ? 'right' : 'left' }]}>{ct.tripHistory}</Text>
           </TouchableOpacity>
           <View style={s.menuDivider} />
           <TouchableOpacity style={[s.menuItem, { flexDirection: isRTL ? 'row-reverse' : 'row' }]} onPress={() => { closeMenu(); router.push('/settings'); }}>
             <Text style={s.menuEmoji}>⚙️</Text>
             <Text style={[s.menuItemText, { textAlign: isRTL ? 'right' : 'left' }]}>{ct.settings}</Text>
           </TouchableOpacity>
           <View style={s.menuDivider} />
           <TouchableOpacity style={[s.menuItem, { flexDirection: isRTL ? 'row-reverse' : 'row' }]} onPress={handleLogout}>
             <Text style={s.menuEmoji}>🚪</Text>
             <Text style={[s.menuItemText, { color:'#e74c3c', textAlign: isRTL ? 'right' : 'left' }]}>{ct.logout}</Text>
           </TouchableOpacity>
         </View>
         <TouchableOpacity style={s.closeDrawerBtn} onPress={closeMenu}>
           <Text style={s.closeDrawerText}>{ct.closeMenu}</Text>
         </TouchableOpacity>
       </Animated.View>
     </Modal>

     <RatingModal
       visible={ratingVisible}
       subjectName={ratingTarget?.name ?? ''}
       reasons={DRIVER_BAD_REASON_CODES.map(code => ({ code, label: reasonLabel(code, ct) }))}
       statuses={DRIVER_STATUS_CODES.map(code => ({
         code,
         label: code === 'good' ? ct.statusGood : code === 'average' ? ct.statusAverage : ct.statusBad,
         icon:  code === 'good' ? '😊' : code === 'average' ? '😐' : '⚠️',
         color: code === 'good' ? '#27ae60' : code === 'average' ? '#f59e0b' : '#f97316',
         needsReason: code === 'bad',
       }))}
       onSubmit={(status: RatingStatus, reasonCode?: string) => {
         if (ratingTarget) updateDriverStatus(ratingTarget.id, status as DriverStatus, reasonCode);
         setRatingVisible(false);
         setRatingTarget(null);
       }}
       onClose={() => { setRatingVisible(false); setRatingTarget(null); }}
     />

   </View>
 );
}

const radar = StyleSheet.create({
 wrap:   { width:110, height:110, justifyContent:'center', alignItems:'center', marginBottom:8 },
 ring:   { position:'absolute', width:90, height:90, borderRadius:45, borderWidth:2, borderColor:'#E8B84B', backgroundColor:'rgba(232,184,75,0.15)' },
 center: { width:56, height:56, borderRadius:28, backgroundColor:'#1F2A40', justifyContent:'center', alignItems:'center', elevation:6, borderWidth:2, borderColor:'#E8B84B' },
});

const s = StyleSheet.create({
 container:          { flex:1 },
 map:                { flex:1 },

 header:             { position:'absolute', top:48, left:0, right:0, flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16 },
 iconBtn:            { width:42, height:42, justifyContent:'center', alignItems:'center', backgroundColor:'#fff', borderRadius:12, elevation:4 },
 headerCenter:       { flexDirection:'row', alignItems:'center', gap:8, backgroundColor:'#fff', borderRadius:20, paddingHorizontal:12, paddingVertical:6, elevation:4 },
 headerAvatar:       { width:28, height:28, borderRadius:14 },
 headerName:         { fontSize:13, fontWeight:'700', color:'#283447' },

 myMarker:           { alignItems:'center' },
 destMarker:         { width:30, height:30, borderRadius:6, backgroundColor:'#27ae60', justifyContent:'center', alignItems:'center' },
 destMarkerText:     { color:'#fff', fontWeight:'900', fontSize:14 },
 driverMarker:       { alignItems:'center', backgroundColor:'#fff', borderRadius:12, padding:6, elevation:3, borderWidth:1.5, borderColor:'#E8B84B' },
 driverMarkerPrice:  { fontSize:10, fontWeight:'800', color:'#E8B84B' },
 trackingMarker:     { alignItems:'center' },

 bottomSheet:        { position:'absolute', bottom:0, left:0, right:0, backgroundColor:'#fff', borderTopLeftRadius:24, borderTopRightRadius:24, padding:24, paddingBottom:36, elevation:20, alignItems:'center' },
 bottomSheetTall:    { position:'absolute', bottom:0, left:0, right:0, backgroundColor:'#fff', borderTopLeftRadius:24, borderTopRightRadius:24, padding:20, paddingBottom:36, elevation:20, maxHeight:'55%' },

 sheetTitle:         { fontSize:18, fontWeight:'900', color:'#283447', marginBottom:16, textAlign:'right' },
 sheetRow:           { flexDirection:'row-reverse', justifyContent:'space-between', alignItems:'center', marginBottom:14 },
 cancelText:         { color:'#e74c3c', fontSize:14, fontWeight:'700' },

 inputWrap:          { flexDirection:'row-reverse', alignItems:'center', backgroundColor:'#F7F4ED', borderRadius:14, paddingHorizontal:14, paddingVertical:12, marginBottom:12, width:'100%', gap:10 },
 inputIcon:          { fontSize:20 },
 inputFixed:         { fontSize:14, color:'#888', flex:1, textAlign:'right' },
 input:              { flex:1, fontSize:14, color:'#283447' },
 suggestBox:         { width:'100%', alignSelf:'stretch', backgroundColor:'#fff', borderRadius:14, borderWidth:1, borderColor:'#F0EDE8', marginTop:-6, marginBottom:12, elevation:6, shadowColor:'#000', shadowOpacity:0.08, shadowOffset:{width:0,height:2}, shadowRadius:6 },
 suggestRow:         { flexDirection:'row-reverse', alignItems:'flex-start', gap:8, paddingHorizontal:14, paddingVertical:12, borderBottomWidth:1, borderBottomColor:'#F7F4ED' },
 suggestTitle:       { fontSize:14, fontWeight:'800', color:'#283447', textAlign:'right' },
 suggestSubtitle:    { fontSize:11, color:'#999', textAlign:'right', marginTop:2 },
 priceBox:           { backgroundColor:'#F7F4ED', borderRadius:14, padding:14, marginBottom:12, width:'100%', alignItems:'center' },
 priceBoxLabel:      { fontSize:12, color:'#888', marginBottom:8, fontWeight:'700' },
 priceEditRow:       { flexDirection:'row', alignItems:'center', gap:16 },
 priceStepBtn:       { width:38, height:38, borderRadius:19, backgroundColor:'#1F2A40', justifyContent:'center', alignItems:'center' },
 priceStepText:      { color:'#E8B84B', fontSize:20, fontWeight:'900' },
 priceValue:         { fontSize:20, fontWeight:'900', color:'#283447', minWidth:100, textAlign:'center' },
 priceHintLow:       { fontSize:11, color:'#c0392b', marginTop:8, textAlign:'center' },
 priceHintOk:        { fontSize:11, color:'#27ae60', marginTop:8, textAlign:'center' },
 searchBtn:          { backgroundColor:'#E8B84B', borderRadius:14, paddingVertical:14, paddingHorizontal:40, alignItems:'center', marginTop:4 },
 searchBtnText:      { fontSize:16, fontWeight:'900', color:'#1F2A40' },
 searchingText:      { fontSize:15, color:'#888', marginTop:12 },

 driverCard:         { flexDirection:'row-reverse', alignItems:'center', backgroundColor:'#F7F4ED', borderRadius:16, padding:14, marginBottom:10, gap:12 },
 driverAvatarWrap:   { width:54, height:54, borderRadius:27, backgroundColor:'#1F2A40', justifyContent:'center', alignItems:'center' },
 driverInfo:         { flex:1 },
 driverName:         { fontSize:15, fontWeight:'800', color:'#283447', marginBottom:3 },
 driverMeta:         { flexDirection:'row-reverse' },
 driverRating:       { fontSize:13, color:'#E8B84B', fontWeight:'700' },
 driverTrips:        { fontSize:12, color:'#888' },
 driverEta:          { fontSize:12, color:'#888', marginTop:3 },
 warnTag:            { fontSize:11, color:'#f97316', fontWeight:'700', marginTop:4, textAlign:'right' },
 driverPriceWrap:    { alignItems:'center', gap:4 },
 driverPrice:        { fontSize:18, fontWeight:'900', color:'#283447' },
 driverPriceSub:     { fontSize:11, color:'#888' },
 acceptBtn:          { backgroundColor:'#E8B84B', borderRadius:10, paddingHorizontal:12, paddingVertical:6, marginTop:4 },
 acceptBtnText:      { fontSize:12, fontWeight:'800', color:'#1F2A40' },

 trackingSheet:      { position:'absolute', bottom:0, left:0, right:0, backgroundColor:'#1C1C1E', borderTopLeftRadius:24, borderTopRightRadius:24, paddingBottom:36, elevation:20 },
 etaBar:             { backgroundColor:'#E8B84B', borderTopLeftRadius:24, borderTopRightRadius:24, padding:14, alignItems:'center' },
 etaText:            { fontSize:15, fontWeight:'900', color:'#1F2A40' },
 trackingCard:       { flexDirection:'row-reverse', alignItems:'center', padding:16, gap:12 },
 trackingAvatarWrap: { width:60, height:60, borderRadius:30, backgroundColor:'#2C2C2E', justifyContent:'center', alignItems:'center', borderWidth:2, borderColor:'#E8B84B' },
 trackingInfo:       { flex:1 },
 trackingName:       { fontSize:16, fontWeight:'900', color:'#fff', marginBottom:3 },
 trackingRatingRow:  { flexDirection:'row-reverse', marginBottom:3 },
 trackingRating:     { fontSize:13, color:'#E8B84B', fontWeight:'700' },
 trackingTrips:      { fontSize:12, color:'#8E8E93' },
 trackingDest:       { fontSize:12, color:'#8E8E93', marginBottom:3 },
 trackingPrice:      { fontSize:15, fontWeight:'900', color:'#E8B84B' },
 trackingBtns:       { gap:8 },
 callBtn:            { width:44, height:44, borderRadius:22, backgroundColor:'#27ae60', justifyContent:'center', alignItems:'center' },
 callBtnText:        { fontSize:20 },
 cancelSmallBtn:     { width:44, height:44, borderRadius:22, backgroundColor:'#c0392b', justifyContent:'center', alignItems:'center' },
 cancelSmallText:    { fontSize:18, color:'#fff', fontWeight:'900' },
 progressBar:        { height:6, backgroundColor:'#2C2C2E', marginHorizontal:16, borderRadius:3, marginBottom:8 },
 progressFill:       { height:6, backgroundColor:'#E8B84B', borderRadius:3 },

 doneIcon:           { fontSize:64, marginBottom:12 },
 doneTitle:          { fontSize:22, fontWeight:'900', color:'#283447', marginBottom:6 },
 doneSub:            { fontSize:14, color:'#888', marginBottom:20 },

 backdrop:           { position:'absolute', top:0, left:0, right:0, bottom:0, backgroundColor:'rgba(0,0,0,0.45)' },
 drawer:             { position:'absolute', top:0, left:0, bottom:0, width:270, backgroundColor:'#fff', elevation:20 },
 drawerHeader:       { backgroundColor:'#1F2A40', padding:24, alignItems:'center', paddingTop:56 },
 drawerAvatar:       { width:70, height:70, borderRadius:35, marginBottom:10, borderWidth:2, borderColor:'#E8B84B' },
 drawerName:         { color:'#E8B84B', fontSize:16, fontWeight:'900' },
 drawerBody:         { flex:1, paddingTop:16 },
 menuItem:           { flexDirection:'row-reverse', alignItems:'center', paddingVertical:16, paddingHorizontal:22, gap:14 },
 menuEmoji:          { fontSize:22 },
 menuItemText:       { flex:1, fontSize:15, color:'#283447', fontWeight:'600', textAlign:'right' },
 menuDivider:        { height:1, backgroundColor:'#F0EDE8', marginHorizontal:20 },
 closeDrawerBtn:     { margin:20, backgroundColor:'#F0EDE8', borderRadius:12, padding:14, alignItems:'center' },
 closeDrawerText:    { color:'#283447', fontWeight:'700', fontSize:15 },
});
