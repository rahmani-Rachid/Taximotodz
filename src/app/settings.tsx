import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { deleteUser, sendPasswordResetEmail } from 'firebase/auth';
import { deleteDoc, doc, getDoc, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { useEffect, useState } from 'react';
import {
  Alert, Image, Linking, ScrollView, StyleSheet,
  Switch, Text, TouchableOpacity, View,
} from 'react-native';
import { Lang, useLanguage } from '../contexts/LanguageContext'; // ← اللغة الآن مشتركة
import { auth, db, storage } from '../utils/firebase';

const translations: Record<Lang, Record<string, string>> = {
 ar: {
   settings:        '⚙️ الإعدادات',
   account:         'الحساب',
   name:            'الاسم',
   email:           'البريد الإلكتروني',
   type:            'النوع',
   driver:          '🏍️ سائق',
   customer:        '👤 زبون',
   photo:           'الصورة الشخصية',
   changePhoto:     'اضغط لتغيير الصورة',
   selfieFixed:     '🔒 صورة التحقق (ثابتة)',
   photoDone:       'تم تحديث صورة البروفايل',
   security:        'الأمان',
   changePass:      'تغيير كلمة المرور',
   passSent:        'أُرسل رابط تغيير كلمة المرور إلى:',
   appearance:      'المظهر',
   darkMode:        'الوضع الليلي',
   support:         'الدعم',
   contactUs:       'تواصل معنا واتساب',
   about:           'عن التطبيق',
   aboutMsg:        'الإصدار 1.0.0\n© 2025 Taxi Moto DZ — الجزائر',
   danger:          'منطقة الخطر',
   deleteTitle:     '🗑️ حذف الحساب',
   deleteConfirm:   'هل أنت متأكد؟ سيتم حذف كل بياناتك نهائياً.',
   deleteBtn:       'حذف نهائي',
   deleteAccount:   'حذف الحساب نهائياً',
   deleteHint:      'هذا الإجراء لا يمكن التراجع عنه',
   cancel:          'إلغاء',
   reloginRequired: 'يجب تسجيل الدخول مجدداً قبل حذف الحساب.',
   notifications:   'الإشعارات',
   notifRides:      'إشعارات الرحلات',
   notifOffers:     'إشعارات العروض',
 },
 fr: {
   settings:        '⚙️ Paramètres',
   account:         'Compte',
   name:            'Nom',
   email:           'Email',
   type:            'Type',
   driver:          '🏍️ Chauffeur',
   customer:        '👤 Client',
   photo:           'Photo de profil',
   changePhoto:     'Appuyer pour changer',
   selfieFixed:     '🔒 Photo de vérification (fixe)',
   photoDone:       'Photo de profil mise à jour',
   security:        'Sécurité',
   changePass:      'Changer le mot de passe',
   passSent:        'Lien envoyé à :',
   appearance:      'Apparence',
   darkMode:        'Mode sombre',
   support:         'Support',
   contactUs:       'Nous contacter WhatsApp',
   about:           'À propos',
   aboutMsg:        'Version 1.0.0\n© 2025 Taxi Moto DZ — Algérie',
   danger:          'Zone de danger',
   deleteTitle:     '🗑️ Supprimer le compte',
   deleteConfirm:   'Êtes-vous sûr ? Toutes vos données seront supprimées.',
   deleteBtn:       'Supprimer',
   deleteAccount:   'Supprimer le compte',
   deleteHint:      'Cette action est irréversible',
   cancel:          'Annuler',
   reloginRequired: 'Veuillez vous reconnecter avant de supprimer le compte.',
   notifications:   'Notifications',
   notifRides:      'Notifications de trajets',
   notifOffers:     'Notifications des offres',
 },
 en: {
   settings:        '⚙️ Settings',
   account:         'Account',
   name:            'Name',
   email:           'Email',
   type:            'Type',
   driver:          '🏍️ Driver',
   customer:        '👤 Customer',
   photo:           'Profile photo',
   changePhoto:     'Tap to change photo',
   selfieFixed:     '🔒 Verification photo (fixed)',
   photoDone:       'Profile photo updated',
   security:        'Security',
   changePass:      'Change password',
   passSent:        'Password reset link sent to:',
   appearance:      'Appearance',
   darkMode:        'Dark mode',
   support:         'Support',
   contactUs:       'Contact us on WhatsApp',
   about:           'About',
   aboutMsg:        'Version 1.0.0\n© 2025 Taxi Moto DZ — Algeria',
   danger:          'Danger zone',
   deleteTitle:     '🗑️ Delete account',
   deleteConfirm:   'Are you sure? All your data will be permanently deleted.',
   deleteBtn:       'Delete permanently',
   deleteAccount:   'Delete account permanently',
   deleteHint:      'This action cannot be undone',
   cancel:          'Cancel',
   reloginRequired: 'Please sign in again before deleting your account.',
   notifications:   'Notifications',
   notifRides:      'Ride notifications',
   notifOffers:     'Offer notifications',
 },
};

export default function Settings() {
 const router = useRouter();
 const { lang } = useLanguage(); // ← القراءة فقط، الاختيار صار من القائمة الجانبية فقط
 const [darkMode,    setDarkMode]    = useState(false);
 const [notifRides,  setNotifRides]  = useState(true);
 const [notifOffers, setNotifOffers] = useState(true);
 const [userName,    setUserName]    = useState('');
 const [userRole,    setUserRole]    = useState<'driver' | 'customer' | null>(null);
 const [photoURL,    setPhotoURL]    = useState<string | null>(null);
 const [selfieURL,   setSelfieURL]   = useState<string | null>(null);
 const [loading,     setLoading]     = useState(false);

 const T = translations[lang];

 useEffect(() => {
   const user = auth.currentUser;
   if (!user) return;
   getDoc(doc(db, 'drivers', user.uid)).then(snap => {
     if (snap.exists()) {
       setUserName(snap.data()?.name || '');
       setUserRole('driver');
       setSelfieURL(snap.data()?.selfieUrl || null);
     } else {
       getDoc(doc(db, 'users', user.uid)).then(snap2 => {
         if (snap2.exists()) {
           setUserName(snap2.data()?.name || '');
           setUserRole('customer');
           setPhotoURL(snap2.data()?.photoURL || null);
         }
       });
     }
   });
 }, []);

 // ── تغيير صورة الزبون فقط ──
 const changePhoto = async () => {
   const res = await ImagePicker.launchImageLibraryAsync({
     mediaTypes: ImagePicker.MediaType.Images,
     allowsEditing: true,
     aspect: [1, 1],
     quality: 0.8,
   });
   if (res.canceled) return;
   try {
     const user = auth.currentUser!;
     const uri  = res.assets[0].uri;
     const r    = ref(storage, `users/${user.uid}/profile.jpg`);
     const url  = await new Promise<string>((resolve, reject) => {
       const xhr = new XMLHttpRequest();
       xhr.onload = async () => {
         try {
           await uploadBytes(r, xhr.response);
           resolve(await getDownloadURL(r));
         } catch (e) { reject(e); }
       };
       xhr.onerror = (e) => reject(e);
       xhr.responseType = 'blob';
       xhr.open('GET', uri, true);
       xhr.send(null);
     });
     await updateDoc(doc(db, 'users', user.uid), { photoURL: url });
     setPhotoURL(url);
     Alert.alert('✅', T.photoDone);
   } catch (e: any) {
     Alert.alert('خطأ', e.message);
   }
 };

 // ── تغيير كلمة المرور ──
 const handleChangePassword = async () => {
   const user = auth.currentUser;
   if (!user?.email) return;
   setLoading(true);
   try {
     await sendPasswordResetEmail(auth, user.email);
     Alert.alert('✅', `${T.passSent}\n${user.email}`);
   } catch (e: any) {
     Alert.alert('خطأ', e.message);
   }
   setLoading(false);
 };

 // ── حذف الحساب ──
 const handleDeleteAccount = () => {
   Alert.alert(T.deleteTitle, T.deleteConfirm, [
     { text: T.cancel, style: 'cancel' },
     {
       text: T.deleteBtn, style: 'destructive',
       onPress: async () => {
         setLoading(true);
         try {
           const user = auth.currentUser;
           if (!user) return;
           const col = userRole === 'driver' ? 'drivers' : 'users';
           await deleteDoc(doc(db, col, user.uid));
           await deleteUser(user);
           router.replace('/');
         } catch (e: any) {
           if (e.code === 'auth/requires-recent-login') {
             Alert.alert('⚠️', T.reloginRequired);
           } else {
             Alert.alert('خطأ', e.message);
           }
         }
         setLoading(false);
       },
     },
   ]);
 };

 const bg   = darkMode ? '#111' : '#F7F4ED';
 const card = darkMode ? '#1C1C1E' : '#fff';
 const text = darkMode ? '#fff' : '#283447';
 const sub  = darkMode ? '#8E8E93' : '#888';

 return (
   <ScrollView style={[s.container, { backgroundColor: bg }]}
     contentContainerStyle={{ paddingBottom: 60 }}>

     {/* Header */}
     <View style={s.header}>
       <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
         <Text style={s.backBtnText}>→</Text>
       </TouchableOpacity>
       <Text style={s.headerTitle}>{T.settings}</Text>
     </View>

     {/* ── صورة البروفايل ── */}
     <View style={[s.card, { backgroundColor: card, alignItems: 'center', paddingVertical: 24 }]}>
       <Text style={[s.cardTitle, { color: sub }]}>{T.photo}</Text>
       {userRole === 'customer' ? (
         <TouchableOpacity onPress={changePhoto} style={s.avatarWrap}>
           {photoURL
             ? <Image source={{ uri: photoURL }} style={s.avatar} />
             : <View style={[s.avatar, s.avatarPlaceholder]}>
                 <Text style={{ fontSize: 40 }}>👤</Text>
               </View>
           }
           <View style={s.editBadge}>
             <Text style={{ fontSize: 14 }}>✏️</Text>
           </View>
         </TouchableOpacity>
       ) : (
         <View style={s.avatarWrap}>
           {selfieURL
             ? <Image source={{ uri: selfieURL }} style={s.avatar} />
             : <View style={[s.avatar, s.avatarPlaceholder]}>
                 <Text style={{ fontSize: 40 }}>🏍️</Text>
               </View>
           }
           <View style={[s.editBadge, { backgroundColor: '#888' }]}>
             <Text style={{ fontSize: 14 }}>🔒</Text>
           </View>
         </View>
       )}
       <Text style={[s.avatarName, { color: text }]}>{userName}</Text>
       <Text style={{ fontSize: 12, color: sub, marginTop: 4 }}>
         {userRole === 'customer' ? T.changePhoto : T.selfieFixed}
       </Text>
     </View>

     {/* معلومات الحساب */}
     <View style={[s.card, { backgroundColor: card }]}>
       <Text style={[s.cardTitle, { color: sub }]}>{T.account}</Text>
       <View style={s.infoRow}>
         <Text style={[s.infoLabel, { color: sub }]}>{T.name}</Text>
         <Text style={[s.infoValue, { color: text }]}>{userName}</Text>
       </View>
       <View style={s.infoRow}>
         <Text style={[s.infoLabel, { color: sub }]}>{T.email}</Text>
         <Text style={[s.infoValue, { color: text }]} numberOfLines={1}>
           {auth.currentUser?.email}
         </Text>
       </View>
       <View style={s.infoRow}>
         <Text style={[s.infoLabel, { color: sub }]}>{T.type}</Text>
         <Text style={[s.infoValue, { color: text }]}>
           {userRole === 'driver' ? T.driver : T.customer}
         </Text>
       </View>
     </View>

     {/* الأمان */}
     <View style={[s.card, { backgroundColor: card }]}>
       <Text style={[s.cardTitle, { color: sub }]}>{T.security}</Text>
       <TouchableOpacity style={s.menuItem} onPress={handleChangePassword} disabled={loading}>
         <Text style={s.menuEmoji}>🔑</Text>
         <Text style={[s.menuText, { color: text }]}>{T.changePass}</Text>
         <Text style={s.chevron}>›</Text>
       </TouchableOpacity>
     </View>

     {/* الإشعارات */}
     <View style={[s.card, { backgroundColor: card }]}>
       <Text style={[s.cardTitle, { color: sub }]}>{T.notifications}</Text>
       <View style={s.switchRow}>
         <Text style={s.menuEmoji}>🏍️</Text>
         <Text style={[s.menuText, { color: text }]}>{T.notifRides}</Text>
         <Switch
           value={notifRides}
           onValueChange={setNotifRides}
           trackColor={{ false: '#ccc', true: '#E8B84B' }}
           thumbColor={notifRides ? '#1F2A40' : '#f4f3f4'}
         />
       </View>
       <View style={s.divider} />
       <View style={s.switchRow}>
         <Text style={s.menuEmoji}>🎁</Text>
         <Text style={[s.menuText, { color: text }]}>{T.notifOffers}</Text>
         <Switch
           value={notifOffers}
           onValueChange={setNotifOffers}
           trackColor={{ false: '#ccc', true: '#E8B84B' }}
           thumbColor={notifOffers ? '#1F2A40' : '#f4f3f4'}
         />
       </View>
     </View>

     {/* المظهر — للسائق فقط */}
     {userRole === 'driver' && (
       <View style={[s.card, { backgroundColor: card }]}>
         <Text style={[s.cardTitle, { color: sub }]}>{T.appearance}</Text>
         <View style={s.switchRow}>
           <Text style={s.menuEmoji}>🌙</Text>
           <Text style={[s.menuText, { color: text }]}>{T.darkMode}</Text>
           <Switch
             value={darkMode}
             onValueChange={setDarkMode}
             trackColor={{ false: '#ccc', true: '#E8B84B' }}
             thumbColor={darkMode ? '#1F2A40' : '#f4f3f4'}
           />
         </View>
       </View>
     )}

     {/* الدعم */}
     <View style={[s.card, { backgroundColor: card }]}>
       <Text style={[s.cardTitle, { color: sub }]}>{T.support}</Text>
       <TouchableOpacity style={s.menuItem}
         onPress={() => Linking.openURL('https://wa.me/213XXXXXXXXX')}>
         <Text style={s.menuEmoji}>📞</Text>
         <Text style={[s.menuText, { color: text }]}>{T.contactUs}</Text>
         <Text style={s.chevron}>›</Text>
       </TouchableOpacity>
       <View style={s.divider} />
       <TouchableOpacity style={s.menuItem}
         onPress={() => Alert.alert('Taxi Moto DZ', T.aboutMsg)}>
         <Text style={s.menuEmoji}>ℹ️</Text>
         <Text style={[s.menuText, { color: text }]}>{T.about}</Text>
         <Text style={s.chevron}>›</Text>
       </TouchableOpacity>
     </View>

     {/* حذف الحساب */}
     <View style={[s.card, { backgroundColor: card }]}>
       <Text style={[s.cardTitle, { color: sub }]}>{T.danger}</Text>
       <TouchableOpacity style={s.deleteBtn} onPress={handleDeleteAccount} disabled={loading}>
         <Text style={s.deleteBtnText}>🗑️ {T.deleteAccount}</Text>
       </TouchableOpacity>
       <Text style={[s.deleteHint, { color: sub }]}>{T.deleteHint}</Text>
     </View>

   </ScrollView>
 );
}

const s = StyleSheet.create({
 container:        { flex: 1 },
 header:           { flexDirection: 'row-reverse', alignItems: 'center', paddingTop: 54, paddingBottom: 16, paddingHorizontal: 20, gap: 12, marginBottom: 16, backgroundColor: '#1F2A40' },
 backBtn:          { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
 backBtnText:      { fontSize: 20, color: '#fff' },
 headerTitle:      { fontSize: 20, fontWeight: '900', color: '#E8B84B' },
 card:             { marginHorizontal: 16, marginBottom: 14, borderRadius: 16, padding: 16, elevation: 2, shadowColor: '#000', shadowOpacity: 0.06, shadowOffset: { width: 0, height: 2 }, shadowRadius: 6 },
 cardTitle:        { fontSize: 12, fontWeight: '700', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
 avatarWrap:       { position: 'relative', marginBottom: 10 },
 avatar:           { width: 90, height: 90, borderRadius: 45, borderWidth: 3, borderColor: '#E8B84B' },
 avatarPlaceholder:{ backgroundColor: '#F0EDE8', justifyContent: 'center', alignItems: 'center' },
 avatarName:       { fontSize: 16, fontWeight: '800', marginTop: 4 },
 editBadge:        { position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderRadius: 14, backgroundColor: '#E8B84B', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#fff' },
 infoRow:          { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F0EDE8' },
 infoLabel:        { fontSize: 13 },
 infoValue:        { fontSize: 14, fontWeight: '600', textAlign: 'right', flex: 1, marginRight: 8 },
 menuItem:         { flexDirection: 'row-reverse', alignItems: 'center', paddingVertical: 12, gap: 12 },
 menuEmoji:        { fontSize: 22 },
 menuText:         { flex: 1, fontSize: 15, fontWeight: '600', textAlign: 'right' },
 chevron:          { fontSize: 20, color: '#ccc' },
 switchRow:        { flexDirection: 'row-reverse', alignItems: 'center', paddingVertical: 8, gap: 12 },
 divider:          { height: 1, backgroundColor: '#F0EDE8', marginVertical: 4 },
 deleteBtn:        { backgroundColor: '#fef2f2', borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1.5, borderColor: '#fca5a5', marginBottom: 8 },
 deleteBtnText:    { fontSize: 15, fontWeight: '800', color: '#c0392b' },
 deleteHint:       { fontSize: 12, textAlign: 'center' },
});

