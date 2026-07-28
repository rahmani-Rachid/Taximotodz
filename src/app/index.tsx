import { useRouter } from 'expo-router';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Image, Modal,
  StyleSheet, Text, TouchableOpacity, View
} from 'react-native';
import { Lang, useLanguage } from '../contexts/LanguageContext.tsx';
import { auth, db } from '../utils/firebase';

const translations: Record<Lang, Record<string, string>> = {
  ar: {
    logoSub:        '🚀 أسرع وأرخص طريقة للتنقل في الجزائر!',
    chooseTitle:    'كيف تريد الدخول؟',
    customerTitle:  'أنا زبون',
    customerSub:    'سجل واطلب دراجة في ثوان',
    driverTitle:    'أنا سائق',
    driverSub:      'سجل واربح من رحلاتك',
    loginBtnText:   'لديك حساب؟ سجل الدخول 🔑',
    footer:         '© 2025 Taxi Moto DZ · الجزائر',
    loginModalTitle:'ادخل كـ',
    customerLabel:  'زبون',
    driverLabel:    'سائق',
    cancel:         'إلغاء',
    menuHistory:    'سجل الرحلات',
    menuSettings:   'الإعدادات',
    menuLogout:     'تسجيل الخروج',
    menuLanguage:   'اللغة',
    closeMenu:      '✕ إغلاق',
  },
  fr: {
    logoSub:        '🚀 Le moyen le plus rapide et économique de se déplacer en Algérie !',
    chooseTitle:    'Comment voulez-vous vous connecter ?',
    customerTitle:  'Je suis client',
    customerSub:    'Inscrivez-vous et commandez en quelques secondes',
    driverTitle:    'Je suis chauffeur',
    driverSub:      'Inscrivez-vous et gagnez avec vos trajets',
    loginBtnText:   'Vous avez un compte ? Connectez-vous 🔑',
    footer:         '© 2025 Taxi Moto DZ · Algérie',
    loginModalTitle:'Se connecter en tant que',
    customerLabel:  'Client',
    driverLabel:    'Chauffeur',
    cancel:         'Annuler',
    menuHistory:    'Historique des trajets',
    menuSettings:   'Paramètres',
    menuLogout:     'Déconnexion',
    menuLanguage:   'Langue',
    closeMenu:      '✕ Fermer',
  },
  en: {
    logoSub:        '🚀 The fastest and cheapest way to get around Algeria!',
    chooseTitle:    'How do you want to sign in?',
    customerTitle:  'I am a customer',
    customerSub:    'Sign up and order a ride in seconds',
    driverTitle:    'I am a driver',
    driverSub:      'Sign up and earn from your rides',
    loginBtnText:   'Have an account? Log in 🔑',
    footer:         '© 2025 Taxi Moto DZ · Algeria',
    loginModalTitle:'Sign in as',
    customerLabel:  'Customer',
    driverLabel:    'Driver',
    cancel:         'Cancel',
    menuHistory:    'Ride history',
    menuSettings:   'Settings',
    menuLogout:     'Log out',
    menuLanguage:   'Language',
    closeMenu:      '✕ Close',
  },
};

export default function Welcome() {
 const router = useRouter();
 const { lang, setLang } = useLanguage(); // ← اللغة الآن مشتركة عبر كل التطبيق
 const T = translations[lang];
 const isRTL = lang === 'ar';

 const [checking, setChecking] = useState(true);
 const [menuOpen, setMenuOpen] = useState(false);
 const [loginModal, setLoginModal] = useState(false);
 const slideAnim = useRef(new Animated.Value(-300)).current;

 useEffect(() => {
   const unsub = onAuthStateChanged(auth, async (user) => {
     if (user) {
       const snapU = await getDoc(doc(db, 'users',   user.uid));
       const snapD = await getDoc(doc(db, 'drivers', user.uid));
       if (snapU.data()?.role === 'customer') { router.replace('/app-customer'); return; }
       if (snapD.data()?.role === 'driver')   { router.replace('/app-driver');   return; }
     }
     setChecking(false);
   });
   return unsub;
 }, []);

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
   await signOut(auth);
   router.replace('/');
 };

 if (checking) {
   return (
     <View style={{ flex:1, justifyContent:'center', alignItems:'center', backgroundColor:'#F7F4ED' }}>
       <ActivityIndicator size="large" color="#E8B84B" />
     </View>
   );
 }

 return (
   <View style={s.container}>

     {/* HEADER */}
     <View style={s.header}>
       <TouchableOpacity style={s.menuBtn} onPress={openMenu}>
         <Text style={s.menuIcon}>☰</Text>
       </TouchableOpacity>
     </View>

     {/* LOGO */}
     <View style={s.logoWrap}>
       <Image
         source={require('../../assets/images/motodz_clear.png')}
         style={s.logoImg}
         resizeMode="contain"
       />
       <Text style={s.logoSub}>{T.logoSub}</Text>
     </View>

     {/* BUTTONS */}
     <View style={s.btnWrap}>
       <Text style={[s.chooseTitle, { textAlign: isRTL ? 'right' : 'left' }]}>{T.chooseTitle}</Text>

       {/* أنا زبون */}
       <TouchableOpacity
         style={[s.cardBtn, s.cardBtnCustomer, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
         onPress={() => router.push('/register-customer')}>
         <View style={s.cardIconCircle}>
           <Text style={s.cardIcon}>👤</Text>
         </View>
         <View style={s.cardText}>
           <Text style={[s.cardTitle, { color:'#283447', textAlign: isRTL ? 'right' : 'left' }]}>{T.customerTitle}</Text>
           <Text style={[s.cardSub, { color:'#5A4A1F', textAlign: isRTL ? 'right' : 'left' }]}>{T.customerSub}</Text>
         </View>
         <Text style={[s.cardArrow, { color:'#283447' }]}>{isRTL ? '←' : '→'}</Text>
       </TouchableOpacity>

       {/* أنا سائق */}
       <TouchableOpacity
         style={[s.cardBtn, s.cardBtnDriver, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
         onPress={() => router.push('/register-driver')}>
         <View style={[s.cardIconCircle, { backgroundColor:'rgba(232,184,75,0.15)' }]}>
           <Text style={s.cardIcon}>🏍️</Text>
         </View>
         <View style={s.cardText}>
           <Text style={[s.cardTitle, { color:'#E8B84B', textAlign: isRTL ? 'right' : 'left' }]}>{T.driverTitle}</Text>
           <Text style={[s.cardSub, { color:'rgba(232,184,75,0.8)', textAlign: isRTL ? 'right' : 'left' }]}>{T.driverSub}</Text>
         </View>
         <Text style={[s.cardArrow, { color:'#E8B84B' }]}>{isRTL ? '←' : '→'}</Text>
       </TouchableOpacity>

       {/* زر الدخول */}
       <TouchableOpacity style={s.loginBtn} onPress={() => setLoginModal(true)}>
         <Text style={s.loginBtnText}>{T.loginBtnText}</Text>
       </TouchableOpacity>

     </View>

     <Text style={s.footer}>{T.footer}</Text>

     {/* MODAL اختيار نوع الدخول */}
     <Modal visible={loginModal} transparent animationType="slide">
       <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={() => setLoginModal(false)} />
       <View style={s.loginModal}>
         <Text style={s.loginModalTitle}>{T.loginModalTitle}</Text>

         <TouchableOpacity style={[s.cardBtn, s.cardBtnCustomer, { marginBottom:12, flexDirection: isRTL ? 'row-reverse' : 'row' }]}
           onPress={() => { setLoginModal(false); router.push('/login-customer'); }}>
           <View style={s.cardIconCircle}>
             <Text style={s.cardIcon}>👤</Text>
           </View>
           <View style={s.cardText}>
             <Text style={[s.cardTitle, { color:'#283447', textAlign: isRTL ? 'right' : 'left' }]}>{T.customerLabel}</Text>
           </View>
           <Text style={[s.cardArrow, { color:'#283447' }]}>{isRTL ? '←' : '→'}</Text>
         </TouchableOpacity>

         <TouchableOpacity style={[s.cardBtn, s.cardBtnDriver, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
           onPress={() => { setLoginModal(false); router.push('/login-driver'); }}>
           <View style={[s.cardIconCircle, { backgroundColor:'rgba(232,184,75,0.15)' }]}>
             <Text style={s.cardIcon}>🏍️</Text>
           </View>
           <View style={s.cardText}>
             <Text style={[s.cardTitle, { color:'#E8B84B', textAlign: isRTL ? 'right' : 'left' }]}>{T.driverLabel}</Text>
           </View>
           <Text style={[s.cardArrow, { color:'#E8B84B' }]}>{isRTL ? '←' : '→'}</Text>
         </TouchableOpacity>

         <TouchableOpacity style={s.cancelBtn} onPress={() => setLoginModal(false)}>
           <Text style={s.cancelText}>{T.cancel}</Text>
         </TouchableOpacity>
       </View>
     </Modal>

     {/* SIDE MENU — الآن يضم كل الإعدادات مباشرة، بما فيها اللغة */}
     <Modal visible={menuOpen} transparent animationType="none">
       <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={closeMenu} />
       <Animated.View style={[s.drawer, { transform: [{ translateX: slideAnim }] }]}>
         <View style={s.drawerHeader}>
           <Image source={require('../../assets/images/motodz_clear.png')} style={s.drawerLogo} resizeMode="contain" />
           <Text style={s.drawerAppName}>Taxi Moto DZ</Text>
         </View>
         <View style={s.drawerBody}>

           {/* ── اللغة مباشرة هنا، بدون الحاجة للدخول لصفحة الإعدادات ── */}
           <Text style={s.drawerSectionTitle}>{T.menuLanguage}</Text>
           <View style={s.langRow}>
             {(['ar', 'fr', 'en'] as Lang[]).map((l) => (
               <TouchableOpacity
                 key={l}
                 style={[s.langBtn, lang === l && s.langBtnActive]}
                 onPress={() => setLang(l)}>
                 <Text style={[s.langBtnText, lang === l && s.langBtnTextActive]}>
                   {l === 'ar' ? '🇩🇿 عربي' : l === 'fr' ? '🇫🇷 Français' : '🇬🇧 English'}
                 </Text>
               </TouchableOpacity>
             ))}
           </View>
           <View style={s.divider} />

           <TouchableOpacity style={[s.menuItem, { flexDirection: isRTL ? 'row-reverse' : 'row' }]} onPress={() => { closeMenu(); router.push('/history'); }}>
             <Text style={s.menuEmoji}>📋</Text>
             <Text style={[s.menuText, { textAlign: isRTL ? 'right' : 'left' }]}>{T.menuHistory}</Text>
           </TouchableOpacity>
           <View style={s.divider} />
           <TouchableOpacity style={[s.menuItem, { flexDirection: isRTL ? 'row-reverse' : 'row' }]} onPress={() => { closeMenu(); router.push('/settings'); }}>
             <Text style={s.menuEmoji}>⚙️</Text>
             <Text style={[s.menuText, { textAlign: isRTL ? 'right' : 'left' }]}>{T.menuSettings}</Text>
           </TouchableOpacity>
           <View style={s.divider} />
           <TouchableOpacity style={[s.menuItem, { flexDirection: isRTL ? 'row-reverse' : 'row' }]} onPress={handleLogout}>
             <Text style={s.menuEmoji}>🚪</Text>
             <Text style={[s.menuText, { color:'#e74c3c', textAlign: isRTL ? 'right' : 'left' }]}>{T.menuLogout}</Text>
           </TouchableOpacity>
         </View>
         <TouchableOpacity style={s.closeBtn} onPress={closeMenu}>
           <Text style={s.closeBtnText}>{T.closeMenu}</Text>
         </TouchableOpacity>
       </Animated.View>
     </Modal>

   </View>
 );
}

const s = StyleSheet.create({
 container:        { flex:1, backgroundColor:'#F7F4ED', justifyContent:'space-between', paddingBottom:40 },
 header:            { paddingTop:50, paddingHorizontal:20, alignItems:'flex-start' },
 menuBtn:           { width:44, height:44, justifyContent:'center', alignItems:'center', backgroundColor:'#E8E4DC', borderRadius:12 },
 menuIcon:          { fontSize:22, color:'#283447' },
 logoWrap:          { alignItems:'center' },
 logoImg:           { width:160, height:160, alignSelf:'center' },
 logoSub:           { fontSize:14, color:'#5A6B7D', textAlign:'center', marginTop:8, lineHeight:20 },
 btnWrap:           { gap:12, paddingHorizontal:24 },
 chooseTitle:       { fontSize:18, fontWeight:'bold', color:'#283447', marginBottom:4 },
 cardBtn:           { alignItems:'center', borderRadius:20, padding:18, gap:14 },
 cardBtnCustomer:   { backgroundColor:'#E8B84B' },
 cardBtnDriver:     { backgroundColor:'#1F2A40' },
 cardIconCircle:    { width:50, height:50, borderRadius:25, backgroundColor:'rgba(40,52,71,0.1)', alignItems:'center', justifyContent:'center' },
 cardIcon:          { fontSize:24 },
 cardText:          { flex:1 },
 cardTitle:         { fontSize:18, fontWeight:'bold' },
 cardSub:           { fontSize:13, marginTop:2 },
 cardArrow:         { fontSize:22, fontWeight:'bold' },
 loginBtn:          { backgroundColor:'#fff', borderWidth:2, borderColor:'#E8B84B', borderRadius:16, padding:14, alignItems:'center' },
 loginBtnText:      { fontSize:15, fontWeight:'700', color:'#1F2A40' },
 footer:            { textAlign:'center', fontSize:12, color:'#aaa' },
 backdrop:          { position:'absolute', top:0, left:0, right:0, bottom:0, backgroundColor:'rgba(0,0,0,0.45)' },
 loginModal:        { position:'absolute', bottom:0, left:0, right:0, backgroundColor:'#F7F4ED', borderTopLeftRadius:24, borderTopRightRadius:24, padding:24, paddingBottom:40 },
 loginModalTitle:   { fontSize:20, fontWeight:'bold', color:'#283447', textAlign:'center', marginBottom:20 },
 cancelBtn:         { marginTop:14, alignItems:'center', padding:14 },
 cancelText:        { color:'#888', fontSize:15 },
 drawer:            { position:'absolute', top:0, left:0, bottom:0, width:270, backgroundColor:'#fff', elevation:20 },
 drawerHeader:      { backgroundColor:'#FFFFFF', padding:28, alignItems:'center', paddingTop:60 },
 drawerLogo:        { width:70, height:70 },
 drawerAppName:     { color:'#1F2A40', fontSize:17, fontWeight:'900', marginTop:8 },
 drawerBody:        { flex:1, paddingTop:16, paddingHorizontal:16 },
 drawerSectionTitle:{ fontSize:12, fontWeight:'700', color:'#888', marginBottom:8, textTransform:'uppercase' },
 langRow:           { flexDirection:'row', gap:6, marginBottom:8 },
 langBtn:           { flex:1, paddingVertical:8, borderRadius:10, backgroundColor:'#F0EDE8', alignItems:'center', borderWidth:1.5, borderColor:'transparent' },
 langBtnActive:     { backgroundColor:'#1F2A40', borderColor:'#E8B84B' },
 langBtnText:       { fontSize:11, fontWeight:'700', color:'#283447' },
 langBtnTextActive: { color:'#E8B84B' },
 menuItem:          { alignItems:'center', paddingVertical:16, gap:14 },
 menuEmoji:         { fontSize:22 },
 menuText:          { fontSize:15, color:'#283447', fontWeight:'600', flex:1 },
 divider:           { height:1, backgroundColor:'#F0EDE8', marginVertical:8 },
 closeBtn:          { margin:20, backgroundColor:'#F0EDE8', borderRadius:12, padding:14, alignItems:'center' },
 closeBtnText:      { color:'#283447', fontWeight:'700', fontSize:15 },
});

