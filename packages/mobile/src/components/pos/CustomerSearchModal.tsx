import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
  Animated,
  Easing,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as haptics from '@/utils/haptics';

interface Customer {
  customer_id: number;
  first_name: string;
  last_name?: string;
  [key: string]: any;
}

interface CustomerSearchModalProps {
  visible: boolean;
  customers: Customer[];
  onSelect: (customer: Customer) => void;
  onClose: () => void;
}

export default function CustomerSearchModal({
  visible,
  customers,
  onSelect,
  onClose,
}: CustomerSearchModalProps) {
  const isDark = useColorScheme() === 'dark';
  const [query, setQuery] = useState('');
  const inputRef = useRef<TextInput>(null);
  const slideVal = useRef(new Animated.Value(300)).current;
  const opacity  = useRef(new Animated.Value(0)).current;

  const filtered = query.trim()
    ? customers.filter(c =>
        `${c.first_name} ${c.last_name || ''}`.toLowerCase().includes(query.toLowerCase())
      )
    : customers;

  useEffect(() => {
    if (visible) {
      setQuery('');
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(slideVal, {
          toValue: 0,
          friction: 8,
          tension: 60,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setTimeout(() => inputRef.current?.focus(), 50);
      });
    } else {
      Keyboard.dismiss();
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver: true }),
        Animated.timing(slideVal, {
          toValue: 300,
          duration: 150,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  const bg      = isDark ? '#111827' : '#fff';
  const surface = isDark ? '#1f2937' : '#f8fafc';
  const text     = isDark ? '#f9fafb' : '#111827';
  const subText  = isDark ? '#9ca3af' : '#6b7280';
  const border   = isDark ? '#374151' : '#e2e8f0';

  const handleSelect = (customer: Customer) => {
    haptics.tap?.();
    onSelect(customer);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.backdrop, { opacity }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />

        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: bg, transform: [{ translateY: slideVal }] },
          ]}
        >
          {/* Handle bar */}
          <View style={[styles.handle, { backgroundColor: border }]} />

          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: text }]}>Select Customer</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name="close-circle" size={24} color={subText} />
            </TouchableOpacity>
          </View>

          {/* Search input */}
          <View style={[styles.searchWrap, { backgroundColor: surface, borderColor: border }]}>
            <Ionicons name="search-outline" size={18} color={subText} style={{ marginRight: 8 }} />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={setQuery}
              placeholder="Search by name..."
              placeholderTextColor={subText}
              style={[styles.searchInput, { color: text }]}
              clearButtonMode="while-editing"
              returnKeyType="search"
            />
          </View>

          {/* Results */}
          <FlatList
            data={filtered}
            keyExtractor={item => String(item.customer_id)}
            contentContainerStyle={{ paddingBottom: 32 }}
            ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: border }]} />}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const label = `${item.first_name} ${item.last_name || ''}`.trim();
              const initials = `${item.first_name?.[0] ?? ''}${item.last_name?.[0] ?? ''}`.toUpperCase();
              return (
                <TouchableOpacity
                  style={[styles.row, { backgroundColor: bg }]}
                  onPress={() => handleSelect(item)}
                  activeOpacity={0.65}
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.customerName, { color: text }]} numberOfLines={1}>
                      {label}
                    </Text>
                    {item.email ? (
                      <Text style={[styles.customerSub, { color: subText }]} numberOfLines={1}>
                        {item.email}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={subText} />
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="person-outline" size={36} color={subText} style={{ marginBottom: 8 }} />
                <Text style={[styles.emptyText, { color: subText }]}>No customers found</Text>
              </View>
            }
          />
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 16,
    maxHeight: '82%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 20,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    padding: 0,
  },
  separator: {
    height: 1,
    marginHorizontal: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  customerName: {
    fontSize: 15,
    fontWeight: '600',
  },
  customerSub: {
    fontSize: 12,
    marginTop: 1,
  },
  empty: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
  },
});
