import { View, type ViewProps } from 'react-native';

export function Card({ className = '', ...props }: ViewProps & { className?: string }) {
  return (
    <View
      className={`rounded-2xl border border-line bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
      {...props}
    />
  );
}
