import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { Pressable } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'flex-row items-center justify-center rounded-xl px-4 py-3 active:opacity-90',
  {
    variants: {
      variant: {
        default: '',
        outline: 'border',
        ghost: 'bg-transparent',
      },
      size: {
        default: 'min-h-12',
        sm: 'min-h-10 px-3 py-2',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

type ButtonProps = React.ComponentProps<typeof Pressable> &
  VariantProps<typeof buttonVariants> & {
    label: string;
    labelClassName?: string;
    backgroundColor?: string;
    borderColor?: string;
    textColor?: string;
  };

function Button({
  className,
  variant,
  size,
  label,
  labelClassName,
  backgroundColor,
  borderColor,
  textColor,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      className={cn(buttonVariants({ variant, size }), className)}
      style={[
        variant === 'default' && backgroundColor ? { backgroundColor } : undefined,
        variant === 'outline' && borderColor ? { borderColor, borderWidth: 1 } : undefined,
        disabled ? { opacity: 0.5 } : undefined,
      ]}
      {...props}
    >
      <Text
        className={cn('text-center font-semibold', labelClassName)}
        style={textColor ? { color: textColor } : undefined}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export { Button, buttonVariants };
