import { StyleSheet, TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';

type FieldProps = {
  label: string;
  value: string;
  onChangeText?: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  editable?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
  keyboardType?: 'default' | 'url' | 'email-address' | 'number-pad';
  multiline?: boolean;
  borderColor: string;
  backgroundColor: string;
  textColor: string;
  mutedColor: string;
};

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  editable,
  autoCapitalize,
  autoCorrect,
  keyboardType,
  multiline,
  borderColor,
  backgroundColor,
  textColor,
  mutedColor,
}: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: mutedColor }]}>{label}</Text>
      <TextInput
        editable={editable ?? onChangeText != null}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        keyboardType={keyboardType}
        multiline={multiline}
        placeholderTextColor={mutedColor}
        style={[
          styles.input,
          multiline ? styles.multiline : null,
          { borderColor, backgroundColor, color: textColor },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 16 },
  label: { marginBottom: 6, fontSize: 14 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 48,
  },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
});
