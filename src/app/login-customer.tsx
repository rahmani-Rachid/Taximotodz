import { useRouter } from 'expo-router';
import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { auth, db } from '../utils/firebase';

export default function LoginCustomer() {
  const router = useRouter();
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
const [phoneNumber, setPhoneNumber] = useState('+213');
  // ── تسجيل الدخول ──
  const handleLogin = async () => {
    if (!email.includes('@')) { Alert.alert('خطأ', 'أدخل بريدك الإلكتروني'); return; }
    if (password.length < 6)  { Alert.alert('خطأ', 'كلمة المرور 6 أحرف على الأقل'); return; }

    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const snap = await getDoc(doc(db, 'users', cred.user.uid));
      const role = snap.data()?.role;
      if (role === 'customer') {
        router.replace('/app-customer');
      } else {
        Alert.alert('خطأ', 'هذا الحساب ليس حساب زبون');
        await auth.signOut();
      }
    } catch (e: any) {
      if (e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password') {
        Alert.alert('❌ خطأ', 'البريد الإلكتروني أو كلمة المرور غير صحيحة');
      } else if (e.code === 'auth/user-not-found') {
        Alert.alert('❌ خطأ', 'لا يوجد حساب بهذا البريد الإلكتروني');
      } else {
        Alert.alert('خطأ', e.message);
      }
    }
    setLoading(false);
  };

  // ── إعادة تعيين كلمة المرور ──
  const handleReset = async () => {
    if (!resetEmail.includes('@')) {
      Alert.alert('خطأ', 'أدخل بريدك الإلكتروني الصحيح');
      return;
    }
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, resetEmail);
      Alert.alert(
        '✅ تم الإرسال',
        `أُرسل رابط إعادة تعيين كلمة المرور إلى:\n${resetEmail}\n\nتحقق من بريدك الإلكتروني`
      );
      setShowReset(false);
      setResetEmail('');
    } catch (e: any) {
      if (e.code === 'auth/user-not-found') {
        Alert.alert('❌ خطأ', 'لا يوجد حساب بهذا البريد الإلكتروني');
      } else {
        Alert.alert('خطأ', e.message);
      }
    }
    setLoading(false);
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backBtnText}>→</Text>
        </TouchableOpacity>
        <Text style={s.title}>دخول الزبون 👤</Text>
      </View>

      {/* ── شاشة الدخول ── */}
      {!showReset ? (
        <>
          <View style={s.fieldWrap}>
            <Text style={s.fieldLabel}>البريد الإلكتروني</Text>
            <TextInput
              style={s.fieldInput}
              value={email}
              onChangeText={setEmail}
              placeholder="example@gmail.com"
              placeholderTextColor="#bbb"
              keyboardType="email-address"
              textAlign="right"
              autoCapitalize="none"
            />
          </View>

          <View style={s.fieldWrap}>
            <Text style={s.fieldLabel}>كلمة المرور</Text>
            <TextInput
              style={s.fieldInput}
              value={password}
              onChangeText={setPassword}
              placeholder="أدخل كلمة المرور"
              placeholderTextColor="#bbb"
              secureTextEntry
              textAlign="right"
            />
          </View>

          {loading
            ? <ActivityIndicator color="#E8B84B" size="large" style={{ marginTop:20 }} />
            : (
              <TouchableOpacity style={s.btn} onPress={handleLogin}>
                <Text style={s.btnText}>دخول ✓</Text>
              </TouchableOpacity>
            )
          }

          {/* نسيت كلمة المرور */}
          <TouchableOpacity style={s.forgotBtn} onPress={() => { setResetEmail(email); setShowReset(true); }}>
            <Text style={s.forgotText}>نسيت كلمة المرور؟</Text>
          </TouchableOpacity>

          {/* ليس لديك حساب */}
          <TouchableOpacity style={s.linkBtn} onPress={() => router.push('/register-customer')}>
            <Text style={s.linkText}>ليس لديك حساب؟ سجل الآن</Text>
          </TouchableOpacity>
        </>
      ) : (
        /* ── شاشة إعادة تعيين كلمة المرور ── */
        <View style={s.resetBox}>
          <Text style={s.resetIcon}>🔑</Text>
          <Text style={s.resetTitle}>نسيت كلمة المرور؟</Text>
          <Text style={s.resetSub}>أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة التعيين</Text>

          <View style={s.fieldWrap}>
            <Text style={s.fieldLabel}>البريد الإلكتروني</Text>
            <TextInput
              style={s.fieldInput}
              value={resetEmail}
              onChangeText={setResetEmail}
              placeholder="example@gmail.com"
              placeholderTextColor="#bbb"
              keyboardType="email-address"
              textAlign="right"
              autoCapitalize="none"
            />
          </View>

          {loading
            ? <ActivityIndicator color="#E8B84B" size="large" style={{ marginTop:20 }} />
            : (
              <TouchableOpacity style={s.btn} onPress={handleReset}>
                <Text style={s.btnText}>إرسال رابط الإعادة 📧</Text>
              </TouchableOpacity>
            )
          }

          <TouchableOpacity style={s.linkBtn} onPress={() => setShowReset(false)}>
            <Text style={s.linkText}>← رجوع لتسجيل الدخول</Text>
          </TouchableOpacity>
        </View>
      )}

    </ScrollView>
  );
}

const s = StyleSheet.create({
  container:   { flex:1, backgroundColor:'#fff' },
  content:     { padding:24, paddingBottom:60 },
  header:      { flexDirection:'row-reverse', alignItems:'center', marginBottom:36, gap:12 },
  backBtn:     { width:40, height:40, borderRadius:20, backgroundColor:'#f0f0f0', alignItems:'center', justifyContent:'center' },
  backBtnText: { fontSize:20, color:'#333' },
  title:       { fontSize:22, fontWeight:'bold', color:'#222' },
  fieldWrap:   { marginBottom:16 },
  fieldLabel:  { fontSize:14, fontWeight:'600', color:'#555', textAlign:'right', marginBottom:6 },
  fieldInput:  { backgroundColor:'#f7f7f7', borderRadius:12, padding:14, fontSize:15, color:'#222', borderWidth:1, borderColor:'#eee' },
  btn:         { backgroundColor:'#E8B84B', padding:15, borderRadius:14, alignItems:'center', marginTop:8, elevation:3 },
  btnText:     { fontSize:16, fontWeight:'bold', color:'#1F2A40' },
  forgotBtn:   { marginTop:16, alignItems:'center' },
  forgotText:  { color:'#888', fontSize:14, textDecorationLine:'underline' },
  linkBtn:     { marginTop:12, alignItems:'center' },
  linkText:    { color:'#E8B84B', fontSize:14, textDecorationLine:'underline', textAlign:'center' },
  resetBox:    { alignItems:'center', paddingTop:20 },
  resetIcon:   { fontSize:64, marginBottom:16 },
  resetTitle:  { fontSize:22, fontWeight:'bold', color:'#222', marginBottom:8 },
  resetSub:    { fontSize:14, color:'#888', textAlign:'center', marginBottom:24, lineHeight:22, paddingHorizontal:20 },
});

