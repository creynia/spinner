// The kit (architecture.md §3): game-agnostic building blocks. Owner: app-shell.
export { Button, type ButtonProps } from './Button';
export { Card, type CardProps } from './Card';
export { Chip, type ChipProps } from './Chip';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { Field, TextInput, Select, Toggle, Segmented, useId } from './Field';
export type { FieldProps, TextInputProps, SelectProps, ToggleProps, SegmentedProps } from './Field';
export { MoneyInput, parseMoney, moneyText, type MoneyInputProps } from './MoneyInput';
export { Sheet, type SheetProps } from './Sheet';
export { Stat, type StatProps } from './Stat';
export { Tabs, type TabDef, type TabsProps } from './Tabs';
export { ToastHost, showToast, dismissToast, clearToasts, type ToastItem } from './Toast';
