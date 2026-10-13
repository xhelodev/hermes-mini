import * as Slot from '@rn-primitives/slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { Text as RNText } from 'react-native';

import { cn } from '@/lib/utils';

const textVariants = cva('text-base', {
  variants: {
    variant: {
      default: '',
      muted: '',
      title: 'text-lg font-semibold',
      label: 'text-sm',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

type TextProps = React.ComponentProps<typeof RNText> &
  VariantProps<typeof textVariants> & {
    asChild?: boolean;
  };

function Text({ className, variant, asChild = false, style, ...props }: TextProps) {
  const Component = asChild ? Slot.Text : RNText;
  return (
    <Component
      className={cn(textVariants({ variant }), className)}
      style={style}
      {...props}
    />
  );
}

export { Text, textVariants };
