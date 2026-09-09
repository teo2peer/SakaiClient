import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { usePaletteColors } from '@/hooks/use-palette';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  progress?: number;
};

const variantClasses = {
  primary: 'bg-pine border-pine',
  secondary: 'bg-white dark:bg-zinc-900 border-line dark:border-zinc-700',
  danger: 'bg-white dark:bg-zinc-900 border-ember',
  ghost: 'bg-transparent border-transparent',
};

const labelClasses = {
  primary: 'text-pine-contrast',
  secondary: 'text-ink dark:text-zinc-100',
  danger: 'text-ember',
  ghost: 'text-pine',
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  accessibilityLabel,
  progress,
}: ButtonProps) {
  const colors = usePaletteColors();
  const percentage = progress === undefined ? undefined : Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: disabled || loading || percentage !== undefined, busy: loading || percentage !== undefined }}
      disabled={disabled || loading || percentage !== undefined}
      onPress={onPress}
      accessibilityValue={percentage === undefined ? undefined : { min: 0, max: 100, now: percentage }}
      className={`relative min-h-12 overflow-hidden items-center justify-center rounded-xl border px-5 active:opacity-70 ${variantClasses[variant]} ${
        disabled || loading ? 'opacity-50' : ''
      }`}>
      {percentage !== undefined ? <>
        <View
          className={`absolute inset-y-0 left-0 ${variant === 'primary' ? 'bg-white/20' : 'bg-mint dark:bg-zinc-800'}`}
          style={{ width: `${percentage}%` }}
        />
        <Text className={`text-[15px] font-semibold ${labelClasses[variant]}`}>{label} · {percentage}%</Text>
      </> : loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.pineContrast : colors.pine} />
      ) : (
        <Text className={`text-[15px] font-semibold ${labelClasses[variant]}`}>{label}</Text>
      )}
    </Pressable>
  );
}
