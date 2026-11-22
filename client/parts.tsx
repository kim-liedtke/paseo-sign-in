import type { PluginTheme } from "@getpaseo/plugin";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

type Tone = "neutral" | "success" | "warning" | "danger";

export function toneColor(theme: PluginTheme, tone: Tone): string {
  if (tone === "success") return theme.colors.statusSuccess;
  if (tone === "warning") return theme.colors.statusWarning;
  if (tone === "danger") return theme.colors.statusDanger;
  return theme.colors.foregroundMuted;
}

export function Button(props: {
  theme: PluginTheme;
  label: string;
  onPress(): void;
  primary?: boolean;
  disabled?: boolean;
}) {
  const { theme, label, onPress, primary, disabled } = props;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: primary ? theme.colors.accent : theme.colors.border,
        backgroundColor: primary ? theme.colors.accent : theme.colors.surface2,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text
        style={{
          color: primary ? theme.colors.accentForeground : theme.colors.foreground,
          fontSize: 14,
          fontWeight: "600",
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Field(props: { theme: PluginTheme; label: string; value: string; tone?: Tone }) {
  const { theme, label, value, tone } = props;
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{label}</Text>
      <Text
        selectable
        style={{ color: tone ? toneColor(theme, tone) : theme.colors.foreground, fontSize: 14 }}
      >
        {value}
      </Text>
    </View>
  );
}

export function Callout(props: { theme: PluginTheme; tone: Tone; children: ReactNode }) {
  const { theme, tone, children } = props;
  return (
    <View
      style={{
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderLeftWidth: 4,
        borderColor: toneColor(theme, tone),
        backgroundColor: theme.colors.surface0,
      }}
    >
      <Text style={{ color: theme.colors.foreground, fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}
