import { useRouter } from 'expo-router';
import {
    collection, doc, onSnapshot, orderBy,
    query, updateDoc, where,
} from 'firebase/firestore';
import { useEffect, useState } from 'react';
import {
    FlatList, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { auth, db } from '../utils/firebase';

type NotificationItem = {
  id:        string;
  title:     string;
  body:      string;
  read:      boolean;
  createdAt: any;
  data?:     { type?: string; rideId?: string; [key: string]: any };
};

// أيقونة مناسبة لكل نوع إشعار — لتمييز بصري سريع بالقائمة
function iconFor(type?: string): string {
  switch (type) {
    case 'new_ride':               return '🏍️';
    case 'ride_accepted':          return '✅';
    case 'offer_accepted':         return '🎉';
    case 'driver_arrived':         return '📍';
    case 'ride_completed':         return '⭐';
    case 'ride_cancelled':
    case 'ride_cancelled_by_driver': return '⚠️';
    case 'broadcast':              return '📢';
    case 'support_message':        return '📩';
    case 'kyc_approved':           return '🎉';
    case 'kyc_rejected':           return '❌';
    default:                       return '🔔';
  }
}

function timeAgo(createdAt: any): string {
  const date = createdAt?.toDate?.();
  if (!date) return '';
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1)  return 'الآن';
  if (diffMin < 60) return `منذ ${diffMin} د`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24)  return `منذ ${diffHr} س`;
  const diffDay = Math.floor(diffHr / 24);
  return `منذ ${diffDay} يوم`;
}

export default function Notifications() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      const list: NotificationItem[] = snap.docs.map(d => ({ id: d.id, ...d.data() } as NotificationItem));
      setItems(list);
      setLoading(false);
    });
    return unsub;
  }, []);

  const markAsRead = (item: NotificationItem) => {
    if (item.read) return;
    updateDoc(doc(db, 'notifications', item.id), { read: true }).catch(() => {});
  };

  const unreadCount = items.filter(i => !i.read).length;

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>→</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>
          🔔 الإشعارات {unreadCount > 0 ? `(${unreadCount})` : ''}
        </Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        ListEmptyComponent={
          !loading ? (
            <View style={s.empty}>
              <Text style={s.emptyIcon}>🔔</Text>
              <Text style={s.emptyText}>لا توجد إشعارات بعد</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[s.card, !item.read && s.cardUnread]}
            onPress={() => markAsRead(item)}
          >
            {!item.read && <View style={s.unreadDot} />}
            <Text style={s.cardIcon}>{iconFor(item.data?.type)}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle} numberOfLines={2}>{item.title}</Text>
              <Text style={s.cardBody} numberOfLines={3}>{item.body}</Text>
              <Text style={s.cardTime}>{timeAgo(item.createdAt)}</Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#F7F4ED' },
  header:       { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, backgroundColor: '#1F2A40', paddingTop: 54, paddingBottom: 16, paddingHorizontal: 20 },
  backBtn:      { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  backText:     { fontSize: 20, color: '#fff' },
  headerTitle:  { fontSize: 18, fontWeight: '900', color: '#E8B84B' },

  card:         { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, elevation: 1 },
  cardUnread:   { backgroundColor: '#FFFBF0', borderWidth: 1, borderColor: '#F5E1A8' },
  unreadDot:    { position: 'absolute', top: 14, left: 14, width: 8, height: 8, borderRadius: 4, backgroundColor: '#E8B84B' },
  cardIcon:     { fontSize: 24 },
  cardTitle:    { fontSize: 14, fontWeight: '800', color: '#283447', textAlign: 'right', marginBottom: 3 },
  cardBody:     { fontSize: 13, color: '#666', textAlign: 'right', marginBottom: 6, lineHeight: 18 },
  cardTime:     { fontSize: 11, color: '#aaa', textAlign: 'right' },

  empty:        { alignItems: 'center', paddingTop: 80 },
  emptyIcon:    { fontSize: 48, marginBottom: 12 },
  emptyText:    { fontSize: 15, color: '#aaa' },
});

