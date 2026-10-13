import { Text as RNText, type TextProps } from 'react-native';

function Text({ style, ...props }: TextProps) {
  return <RNText style={[{ fontSize: 16 }, style]} {...props} />;
}

export { Text };
