import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { usePaletteColors, useResolvedColorScheme } from '@/hooks/use-palette';
import { unreadAnnouncements, useApp } from '@/providers/app-provider';
import { useVersionManager } from '@/providers/version-provider';

export default function TabLayout() {
  const app = useApp();
  const versions = useVersionManager();
  const dark = useResolvedColorScheme() === 'dark';
  const colors = usePaletteColors();
  const unread = unreadAnnouncements(app.data).length;
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: colors.pine,
      tabBarInactiveTintColor: dark ? '#A1A1AA' : '#71717A',
      tabBarStyle: { backgroundColor: dark ? '#09090B' : '#FFFFFF', borderTopColor: colors.line },
      tabBarHideOnKeyboard: true,
    }}>
      {[
        { name: 'index', title: 'Asignaturas', icon: 'A' },
        { name: 'announcements', title: 'Anuncios', icon: 'N' },
        { name: 'sync', title: 'Descargas', icon: 'D' },
        { name: 'settings', title: 'Ajustes', icon: 'C' },
      ].map((tab) => <Tabs.Screen key={tab.name} name={tab.name} options={{
        title: tab.title,
        tabBarBadge: tab.name === 'announcements' && unread
          ? (unread > 99 ? '99+' : unread)
          : tab.name === 'settings' && versions.updateAvailable ? '!' : undefined,
        tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18, fontWeight: '700' }}>{tab.icon}</Text>,
      }} />)}
    </Tabs>
  );
}
