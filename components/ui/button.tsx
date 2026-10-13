import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/ui/text';

type ButtonProps = Omit<ComponentProps<typeof Pressable>, 'style' | 'children'> & {
  label: string;
  backgroundColor?: string;
  borderColor?: string;
  textColor?: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm';
  style?: StyleProp<ViewStyle>;
};

function Button({
  label,
  backgroundColor,
  borderColor,
  textColor,
  variant = 'default',
  size = 'default',
  disabled,
  style,
  ...props
}: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={[
        styles.base,
        size === 'sm' ? styles.sm : styles.md,
        variant === 'default' && backgroundColor ? { backgroundColor } : null,
        variant === 'outline' ? { borderWidth: 1, borderColor } : null,
        variant === 'ghost' ? styles.ghost : null,
        disabled ? styles.disabled : null,
        style,
      ]}
      {...props}
    >
      <Text style={[styles.label, textColor ? { color: textColor } : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  md: { minHeight: 48 },
  sm: { minHeight: 40, paddingHorizontal: 12, paddingVertical: 8 },
  ghost: { backgroundColor: 'transparent' },
  disabled: { opacity: 0.5 },
  label: { textAlign: 'center', fontWeight: '600' },
});

export { Button };
