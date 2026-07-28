import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

type Props = {
  title?: string;
  unreadCount?: number;
  onPressBell?: () => void;
};

export default function AppHeader({
  title = "TaxiMotodz",
  unreadCount = 0,
  onPressBell,
}: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>

      <TouchableOpacity style={styles.bellWrap} onPress={onPressBell} activeOpacity={0.7}>
        <Text style={styles.bellIcon}>🔔</Text>
        {unreadCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {unreadCount > 99 ? "99+" : String(unreadCount)}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 56,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
  },
  bellWrap: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  bellIcon: {
    fontSize: 20,
  },
  badge: {
    position: "absolute",
    top: 4,
    right: 2,
    minWidth: 18,
    paddingHorizontal: 4,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#ff3b30",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
});

