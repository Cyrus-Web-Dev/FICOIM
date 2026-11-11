import { useMemo, type ComponentType, type ReactNode } from 'react';
import { toBase64 } from '@ficoim/client';
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { BoxProps, BtnProps, FieldProps, ImgProps, ScrollProps, SheetProps, SpinnerProps, TxtProps, UIImpl } from '@ficoim/screens';

/**
 * SATU-SATUNYA tempat yang menyentuh react-native + className (NativeWind). Komponen RN diberi tipe `className`
 * secara lokal supaya tidak bergantung pada augmentasi tipe NativeWind (yang berbeda antara v4 dan v5).
 */
type CN = { className?: string; children?: ReactNode; testID?: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const V = View as unknown as ComponentType<CN & Record<string, any>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const T = Text as unknown as ComponentType<CN & Record<string, any>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P = Pressable as unknown as ComponentType<CN & Record<string, any>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const I = TextInput as unknown as ComponentType<CN & Record<string, any>>;

const cx = (...a: (string | false | null | undefined)[]): string => a.filter(Boolean).join(' ');

function Box({ className, children, onPress, testID, disabled }: BoxProps) {
  if (!onPress) return <V testID={testID} className={className}>{children}</V>;
  return <P testID={testID} disabled={disabled} onPress={onPress} className={cx(disabled && 'opacity-50', className)}>{children}</P>;
}

function Txt({ className, children, numberOfLines, testID }: TxtProps) {
  return <T testID={testID} numberOfLines={numberOfLines} className={className}>{children}</T>;
}

const VARIANT = { primary: 'bg-indigo-600', secondary: 'bg-slate-200', danger: 'bg-rose-600', ghost: 'bg-transparent' } as const;
const LABEL = { primary: 'text-white', secondary: 'text-slate-900', danger: 'text-white', ghost: 'text-indigo-700' } as const;

function Btn({ label, onPress, variant = 'primary', disabled, loading, className, testID }: BtnProps) {
  const off = disabled || loading;
  return (
    <P testID={testID} disabled={off} onPress={onPress} className={cx('items-center justify-center rounded-xl px-4 py-3', VARIANT[variant], off && 'opacity-50', className)}>
      {loading ? <ActivityIndicator /> : <T className={cx('font-semibold', LABEL[variant])}>{label}</T>}
    </P>
  );
}

const KEYBOARD = { default: 'default', numeric: 'number-pad', decimal: 'decimal-pad', email: 'email-address', phone: 'phone-pad' } as const;

function Field(p: FieldProps) {
  return (
    <V className={cx('gap-1', p.className)}>
      {p.label ? <T className="text-sm text-slate-600">{p.label}</T> : null}
      <I
        testID={p.testID} value={p.value} onChangeText={p.onChangeText} placeholder={p.placeholder} secureTextEntry={p.secure} keyboardType={KEYBOARD[p.keyboard ?? 'default']}
        multiline={p.multiline} autoFocus={p.autoFocus} autoCapitalize={p.autoCapitalize ?? 'sentences'} autoCorrect={false} onSubmitEditing={p.onSubmit}
        returnKeyType={p.onSubmit ? 'done' : 'default'} placeholderTextColor="#94a3b8"
        className={cx('rounded-lg border bg-white px-3 py-2 text-base text-slate-900', p.error ? 'border-rose-500' : 'border-slate-300', p.multiline && 'min-h-[80px]')}
      />
      {p.error ? <T className="text-sm text-rose-600">{p.error}</T> : null}
    </V>
  );
}

function Scroll({ className, contentClassName, children, testID }: ScrollProps) {
  // Pembungkus View (bukan contentContainerClassName) agar tidak bergantung pada dukungan prop itu di versi NativeWind tertentu.
  return (
    <ScrollView testID={testID} className={className} keyboardShouldPersistTaps="handled">
      <V className={contentClassName}>{children}</V>
    </ScrollView>
  );
}

function Sheet({ visible, title, onClose, children }: SheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <V className="flex-1 justify-end bg-black/40">
        <P className="flex-1" onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <V className="max-h-[90%] rounded-t-2xl bg-white">
            <V className="flex-row items-center justify-between border-b border-slate-100 px-4 py-3">
              <T className="flex-1 text-lg font-bold text-slate-900">{title}</T>
              <P onPress={onClose} testID="sheet-close" className="px-2"><T className="text-xl text-slate-500">✕</T></P>
            </V>
            <ScrollView keyboardShouldPersistTaps="handled"><V className="gap-3 p-4 pb-8">{children}</V></ScrollView>
          </V>
        </KeyboardAvoidingView>
      </V>
    </Modal>
  );
}

function Spinner({ className }: SpinnerProps) {
  return <V className={className}><ActivityIndicator color="#4338ca" /></V>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const IM = Image as unknown as ComponentType<CN & Record<string, any>>;

/** Gambar dari byte lewat data URI (foto sudah dikecilkan ≤ ± 300 KB, jadi aman). */
function Img({ bytes, mime, className, testID }: ImgProps) {
  const uri = useMemo(() => `data:${mime};base64,${toBase64(bytes)}`, [bytes, mime]);
  return <IM testID={testID} className={className} source={{ uri }} resizeMode="cover" />;
}

// Reveal/AnimatedNumber/Backdrop sengaja tidak diimplementasikan di HP: layar memakai cadangan polos (lebih hemat baterai & lebih sedikit risiko).
export const nativeUI: UIImpl = { Box, Txt, Btn, Field, Scroll, Sheet, Spinner, Img };
