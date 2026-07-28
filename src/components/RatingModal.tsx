import { useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export type RatingStatus = 'good' | 'average' | 'bad' | 'thief';

export interface RatingReason {
  code: string;
  label: string;
}

interface StatusOption {
  code: RatingStatus;
  label: string;
  icon: string;
  color: string;
  needsReason?: boolean;
}

// الافتراضي 4 مستويات (لتقييم السائق للزبون: جيد/متوسط/سيئ/سارق) —
// عند تقييم الزبون للسائق، مرّر statuses بـ 3 مستويات فقط (بدون "سارق")
const DEFAULT_STATUSES: StatusOption[] = [
  { code: 'good',    label: 'جيد',   icon: '😊', color: '#27ae60' },
  { code: 'average', label: 'متوسط', icon: '😐', color: '#f59e0b' },
  { code: 'bad',     label: 'سيئ',   icon: '⚠️', color: '#f97316', needsReason: true },
  { code: 'thief',   label: 'سارق',  icon: '🚨', color: '#ef4444', needsReason: true },
];

interface RatingModalProps {
  visible: boolean;
  subjectName: string;
  reasons: RatingReason[];
  statuses?: StatusOption[];
  onSubmit: (status: RatingStatus, reasonCode?: string) => void;
  onClose: () => void;
}

export default function RatingModal({
  visible, subjectName, reasons, statuses = DEFAULT_STATUSES, onSubmit, onClose,
}: RatingModalProps) {
  const [selected,   setSelected]   = useState<RatingStatus | null>(null);
  const [reasonCode, setReasonCode] = useState<string | null>(null);

  const chosen = statuses.find(s => s.code === selected);
  const reset  = () => { setSelected(null); setReasonCode(null); };

  const handleSubmit = () => {
    if (!selected) return;
    if (chosen?.needsReason && !reasonCode) return;
    onSubmit(selected, reasonCode ?? undefined);
    reset();
  };

  const handleClose = () => { reset(); onClose(); };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={s.backdrop}>
        <View style={s.card}>
          <Text style={s.title}>قيّم {subjectName}</Text>

          <View style={s.statusRow}>
            {statuses.map(st => (
              <TouchableOpacity
                key={st.code}
                style={[
                  s.statusBtn,
                  selected === st.code && { borderColor: st.color, backgroundColor: st.color + '18' },
                ]}
                onPress={() => { setSelected(st.code); setReasonCode(null); }}
              >
                <Text style={{ fontSize: 24 }}>{st.icon}</Text>
                <Text style={[s.statusLabel, selected === st.code && { color: st.color }]}>{st.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {chosen?.needsReason && (
            <View style={s.reasonsBox}>
              <Text style={s.reasonsTitle}>ما السبب؟</Text>
              {reasons.map(r => (
                <TouchableOpacity key={r.code} style={s.reasonRow} onPress={() => setReasonCode(r.code)}>
                  <View style={[s.radio, reasonCode === r.code && s.radioActive]}>
                    {reasonCode === r.code && <View style={s.radioDot} />}
                  </View>
                  <Text style={s.reasonText}>{r.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={[
              s.submitBtn,
              (!selected || (chosen?.needsReason && !reasonCode)) && { opacity: 0.4 },
            ]}
            disabled={!selected || (chosen?.needsReason && !reasonCode)}
            onPress={handleSubmit}
          >
            <Text style={s.submitText}>إرسال التقييم</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleClose} style={{ marginTop: 10 }}>
            <Text style={s.skipText}>تخطي</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  card:          { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 36 },
  title:         { fontSize: 18, fontWeight: '900', color: '#283447', textAlign: 'center', marginBottom: 16 },
  statusRow:     { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
  statusBtn:     { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 14, backgroundColor: '#F7F4ED', borderWidth: 2, borderColor: 'transparent' },
  statusLabel:   { fontSize: 11, fontWeight: '700', color: '#888', marginTop: 5 },
  reasonsBox:    { marginTop: 16, backgroundColor: '#FFF3F3', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#fca5a5' },
  reasonsTitle:  { fontSize: 12, fontWeight: '700', color: '#c0392b', marginBottom: 8, textAlign: 'right' },
  reasonRow:     { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, paddingVertical: 8 },
  radio:         { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#c0392b', justifyContent: 'center', alignItems: 'center' },
  radioActive:   { borderColor: '#c0392b' },
  radioDot:      { width: 10, height: 10, borderRadius: 5, backgroundColor: '#c0392b' },
  reasonText:    { flex: 1, fontSize: 13, color: '#283447', fontWeight: '600', textAlign: 'right' },
  submitBtn:     { backgroundColor: '#1F2A40', borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 18 },
  submitText:    { color: '#E8B84B', fontWeight: '800', fontSize: 15 },
  skipText:      { color: '#888', fontSize: 13, textAlign: 'center' },
});

