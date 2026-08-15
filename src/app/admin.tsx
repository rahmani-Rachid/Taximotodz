import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, getDoc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import {
    ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform, ScrollView,
    StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { auth, db } from '../utils/firebase';

type PendingDriver = {
  id: string;
  name: string;
  phone: string;
  email: string;
  licenseUrl: string;
  carteGriseUrl: string;
  selfieUrl: string;
};

export default function AdminDriverApprovals() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [drivers, setDrivers] = useState<PendingDriver[]>([]);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [rejectingDriver, setRejectingDriver] = useState<PendingDriver | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // ── التحقق من صلاحية الأدمن قبل عرض أي شيء ──
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { router.replace('/'); return; }
      try {
        const adminSnap = await getDoc(doc(db, 'admins', user.uid));
        if (!adminSnap.exists()) {
          Alert.alert('غير مصرح', 'هذا القسم مخصص للأدمن فقط');
          router.replace('/');
          return;
        }
        setIsAdmin(true);
      } catch {
        router.replace('/');
      }
      setChecking(false);
    });
    return unsub;
  }, []);

  // ── الاستماع الحي لكل السائقين بحالة "قيد المراجعة" ──
  useEffect(() => {
    if (!isAdmin) return;
    const q = query(collection(db, 'drivers'), where('kyc_status', '==', 'pending'));
    const unsub = onSnapshot(q, (snap) => {
      const list: PendingDriver[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name ?? '',
          phone: data.phone ?? '',
          email: data.email ?? '',
          licenseUrl: data.licenseUrl ?? '',
          carteGriseUrl: data.carteGriseUrl ?? '',
          selfieUrl: data.selfieUrl ?? '',
        };
      });
      setDrivers(list);
    });
    return unsub;
  }, [isAdmin]);

  const handleApprove = async (driver: PendingDriver) => {
    setProcessingId(driver.id);
    try {
      // فقط تغيير الحالة — Cloud Function (onDriverKycStatusChange) تتولى إرسال الإشعار push + جرس تلقائياً
      await updateDoc(doc(db, 'drivers', driver.id), { kyc_status: 'approved' });
    } catch {
      Alert.alert('خطأ', 'تعذر تحديث الحالة، حاول مجدداً');
    }
    setProcessingId(null);
  };

  const openRejectModal = (driver: PendingDriver) => {
    setRejectReason('');
    setRejectingDriver(driver);
  };

  const confirmReject = async () => {
    if (!rejectingDriver) return;
    if (!rejectReason.trim()) {
      Alert.alert('تنبيه', 'يجب كتابة سبب الرفض قبل الإرسال');
      return;
    }
    setProcessingId(rejectingDriver.id);
    try {
      // نحفظ السبب في مستند السائق نفسه — Cloud Function تقرأه وترسل الإشعار (push + جرس) من طرف الخادم
      await updateDoc(doc(db, 'drivers', rejectingDriver.id), {
        kyc_status: 'rejected',
        rejectionReason: rejectReason.trim(),
      });
    } catch {
      Alert.alert('خطأ', 'تعذر تحديث الحالة، حاول مجدداً');
    }
    setProcessingId(null);
    setRejectingDriver(null);
    setRejectReason('');
  };

  if (checking) {
    return (
      <View style={s.centerScreen}>
        <ActivityIndicator size="large" color="#E8B84B" />
      </View>
    );
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backBtnText}>←</Text>
        </TouchableOpacity>
        <Text style={s.title}>مراجعة السائقين الجدد</Text>
        <View style={s.countBadge}>
          <Text style={s.countBadgeText}>{drivers.length}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.scrollContent}>
        {drivers.length === 0 && (
          <View style={s.emptyBox}>
            <Text style={s.emptyIcon}>✅</Text>
            <Text style={s.emptyText}>لا يوجد سائقون بانتظار المراجعة حالياً</Text>
          </View>
        )}

        {drivers.map((driver) => (
          <View key={driver.id} style={s.card}>
            <Text style={s.driverName}>{driver.name || 'بدون اسم'}</Text>
            <Text style={s.driverInfo}>📞 {driver.phone}</Text>
            <Text style={s.driverInfo}>✉️ {driver.email}</Text>

            <View style={s.docsRow}>
              <View style={s.docBox}>
                <Text style={s.docLabel}>رخصة السياقة</Text>
                {driver.licenseUrl ? (
                  <TouchableOpacity onPress={() => setZoomedImage(driver.licenseUrl)}>
                    <Image source={{ uri: driver.licenseUrl }} style={s.docImage} />
                  </TouchableOpacity>
                ) : (
                  <View style={s.docMissing}><Text style={s.docMissingText}>لا توجد صورة</Text></View>
                )}
              </View>
              <View style={s.docBox}>
                <Text style={s.docLabel}>البطاقة الرمادية</Text>
                {driver.carteGriseUrl ? (
                  <TouchableOpacity onPress={() => setZoomedImage(driver.carteGriseUrl)}>
                    <Image source={{ uri: driver.carteGriseUrl }} style={s.docImage} />
                  </TouchableOpacity>
                ) : (
                  <View style={s.docMissing}><Text style={s.docMissingText}>لا توجد صورة</Text></View>
                )}
              </View>
              <View style={s.docBox}>
                <Text style={s.docLabel}>السيلفي</Text>
                {driver.selfieUrl ? (
                  <TouchableOpacity onPress={() => setZoomedImage(driver.selfieUrl)}>
                    <Image source={{ uri: driver.selfieUrl }} style={s.docImage} />
                  </TouchableOpacity>
                ) : (
                  <View style={s.docMissing}><Text style={s.docMissingText}>لا توجد صورة</Text></View>
                )}
              </View>
            </View>

            {processingId === driver.id ? (
              <ActivityIndicator color="#E8B84B" style={{ marginTop: 14 }} />
            ) : (
              <View style={s.actionsRow}>
                <TouchableOpacity
                  style={[s.actionBtn, s.rejectBtn]}
                  onPress={() => openRejectModal(driver)}
                >
                  <Text style={s.actionBtnText}>❌ رفض</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.actionBtn, s.approveBtn]}
                  onPress={() => handleApprove(driver)}
                >
                  <Text style={s.actionBtnText}>✅ قبول</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      {/* ── نافذة تكبير الصورة ── */}
      <Modal visible={!!zoomedImage} transparent animationType="fade">
        <View style={s.zoomBackdrop}>
          <TouchableOpacity
            style={s.zoomCloseBtn}
            onPress={() => setZoomedImage(null)}
          >
            <Text style={s.zoomCloseBtnText}>✕</Text>
          </TouchableOpacity>
          {zoomedImage && (
            <Image
              source={{ uri: zoomedImage }}
              style={s.zoomImage}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>

      {/* ── نافذة كتابة سبب الرفض ── */}
      <Modal visible={!!rejectingDriver} transparent animationType="slide">
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={s.rejectBackdrop}>
            <View style={s.rejectBox}>
              <Text style={s.rejectTitle}>سبب رفض {rejectingDriver?.name}</Text>
              <Text style={s.rejectHint}>سيصل هذا النص للسائق مباشرة في جرس إشعاراته</Text>
              <TextInput
                style={s.rejectInput}
                value={rejectReason}
                onChangeText={setRejectReason}
                placeholder="مثال: صورة الرخصة غير واضحة، أعد رفعها"
                placeholderTextColor="#666"
                multiline
                textAlign="right"
              />
              <View style={s.rejectActionsRow}>
                <TouchableOpacity
                  style={[s.rejectActionBtn, s.rejectCancelBtn]}
                  onPress={() => { setRejectingDriver(null); setRejectReason(''); }}
                >
                  <Text style={s.actionBtnText}>إلغاء</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.rejectActionBtn, s.rejectSendBtn]}
                  onPress={confirmReject}
                  disabled={processingId === rejectingDriver?.id}
                >
                  {processingId === rejectingDriver?.id ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={s.actionBtnText}>إرسال الرفض</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  centerScreen: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1f2e' },
  container: { flex: 1, backgroundColor: '#1a1f2e' },
  header: { flexDirection: 'row-reverse', alignItems: 'center', padding: 20, paddingTop: 56, gap: 12 },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' },
  backBtnText: { fontSize: 18, color: '#fff' },
  title: { flex: 1, fontSize: 19, fontWeight: '900', color: '#fff', textAlign: 'right' },
  countBadge: { backgroundColor: '#E8B84B', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  countBadgeText: { fontSize: 13, fontWeight: '900', color: '#1a1f2e' },

  scrollContent: { padding: 16, paddingBottom: 60 },
  emptyBox: { alignItems: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 15, color: '#8E8E93' },

  card: { backgroundColor: '#242938', borderRadius: 16, padding: 16, marginBottom: 16 },
  driverName: { fontSize: 17, fontWeight: '900', color: '#fff', textAlign: 'right', marginBottom: 4 },
  driverInfo: { fontSize: 13, color: '#aaa', textAlign: 'right', marginBottom: 2 },

  docsRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  docBox: { flex: 1 },
  docLabel: { fontSize: 11, color: '#E8B84B', textAlign: 'center', marginBottom: 6, fontWeight: '700' },
  docImage: { width: '100%', height: 90, borderRadius: 10, backgroundColor: '#1a1f2e' },
  docMissing: { width: '100%', height: 90, borderRadius: 10, backgroundColor: '#1a1f2e', justifyContent: 'center', alignItems: 'center' },
  docMissingText: { fontSize: 10, color: '#666' },

  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  actionBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  approveBtn: { backgroundColor: '#27ae60' },
  rejectBtn: { backgroundColor: '#c0392b' },
  actionBtnText: { fontSize: 14, fontWeight: '800', color: '#fff' },

  zoomBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  zoomImage: { width: '95%', height: '80%' },
  zoomCloseBtn: { position: 'absolute', top: 50, right: 20, width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  zoomCloseBtnText: { fontSize: 20, color: '#fff', fontWeight: '900' },

  rejectBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  rejectBox: { backgroundColor: '#242938', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 },
  rejectTitle: { fontSize: 17, fontWeight: '900', color: '#fff', textAlign: 'right', marginBottom: 6 },
  rejectHint: { fontSize: 12, color: '#8E8E93', textAlign: 'right', marginBottom: 14 },
  rejectInput: { backgroundColor: '#1a1f2e', borderRadius: 12, padding: 14, color: '#fff', fontSize: 14, minHeight: 90, textAlignVertical: 'top', marginBottom: 16 },
  rejectActionsRow: { flexDirection: 'row', gap: 10 },
  rejectActionBtn: { flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  rejectCancelBtn: { backgroundColor: '#3A3A3C' },
  rejectSendBtn: { backgroundColor: '#c0392b' },
});

