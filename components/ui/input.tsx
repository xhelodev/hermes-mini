import * as React from 'react';
import { TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

type FieldProps = {
  label: string;
  value: string;
  placeholder?: string;
  secureTextEntry?: boolean;
  borderColor: string;
  backgroundColor: string;
  textColor: string;
  mutedColor: string;
  className?: string;
};

export function Field({
  label,
  value,
  placeholder,
  secureTextEntry,
  borderColor,
  backgroundColor,
  textColor,
  mutedColor,
  className,
}: FieldProps) {
  return (
    <View className={cn('mb-4', className)}>
      <Text className="mb-1.5 text-sm" style={{ color: mutedColor }}>
        {label}
      </Text>
      <TextInput
        editable={false}
        value={value}
        placeholder={placeholder}
        secureTextEntry={secureTextEntry}
        placeholderTextColor={mutedColor}
        className="rounded-xl border px-3 py-3 text-base"
        style={{
          borderColor,
          backgroundColor,
          color: textColor,
        }}
      />
    </View>
  );
}
