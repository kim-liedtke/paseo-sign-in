import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import type { ProviderStatus } from "../shared/contracts";
import { noticeFor, timeLeftText, type Notice } from "../shared/expiry";
import { useStatuses, useWarnDays } from "./data";
import { LoginFlow } from "./login-flow";
import { Button, Callout, Field, toneColor } from "./parts";

function stateLine(status: ProviderStatus, notice: Notice): { text: string; tone: "success" | "warning" | "danger" | "neutral" } {
  if (status.state === "unavailable") return { text: "Status not available", tone: "neutral" };
  if (notice.level === "signed_out") return { text: "Not signed in", tone: "danger" };
  if (notice.level === "ended") return { text: "Sign-in ended", tone: "danger" };
  if (notice.level === "warning") return { text: "Signed in, ends soon", tone: "warning" };
  return { text: "Signed in", tone: "success" };
}

function endText(status: ProviderStatus, notice: Notice): string {
  if (!status.expiresAt) return "The provider reports no end date";
  const when = new Date(status.expiresAt).toLocaleString();
  if (notice.level === "ended") return `${when} (ended)`;
  return notice.daysLeft === null ? when : `${when} (${timeLeftText(notice.daysLeft)})`;
}

function ProviderCard(props: { theme: PluginTheme; compact: boolean; status: ProviderStatus; warnDays: number }) {
  const { theme, compact, status, warnDays } = props;
  const notice = noticeFor(status, Date.now(), warnDays);
  const line = stateLine(status, notice);
  const endTone = notice.level === "ended" ? "danger" : notice.level === "warning" ? "warning" : undefined;
  return (
    <View
      style={{
        gap: 16,
        padding: compact ? 14 : 20,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 17, fontWeight: "600" }}>{status.label}</Text>
        <Text style={{ color: toneColor(theme, line.tone), fontSize: 13, fontWeight: "600" }}>{line.text}</Text>
      </View>

      {status.state === "unavailable" ? (
        <Callout theme={theme} tone="warning">
          {status.detail ?? "The status could not be read."}
        </Callout>
      ) : null}

      {status.state === "signed_in" ? (
        <View style={{ gap: 12 }}>
          <Field theme={theme} label="Account" value={status.email ?? "Not reported"} />
          <Field
            theme={theme}
            label="Plan"
            value={[status.plan, status.organization].filter(Boolean).join(" · ") || "Not reported"}
          />
          {status.method ? <Field theme={theme} label="Signed in with" value={status.method} /> : null}
          <Field theme={theme} label="Sign-in ends" value={endText(status, notice)} tone={endTone} />
        </View>
      ) : null}

      {status.state !== "unavailable" ? (
        <LoginFlow
          theme={theme}
          compact={compact}
          provider={status.provider}
          label={status.label}
          signedIn={status.state === "signed_in"}
        />
      ) : null}
    </View>
  );
}

export function SignInScreen({ theme, layout, host }: PluginScreenProps) {
  const statuses = useStatuses();
  const warnDays = useWarnDays();
  const checkedAt = statuses.data?.[0]?.checkedAt;
  const muted = { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 18 } as const;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{
        padding: layout.compact ? 16 : 24,
        gap: 16,
        width: "100%",
        maxWidth: 720,
        alignSelf: "center",
      }}
    >
      <Text style={muted}>
        {`Sign-in of the coding agents on ${host.label}. The data comes from each provider's own status command.`}
      </Text>

      {statuses.isPending ? <Text style={muted}>Reading the status…</Text> : null}
      {statuses.isError ? (
        <Callout theme={theme} tone="danger">
          The status could not be read from the host.
        </Callout>
      ) : null}

      {(statuses.data ?? []).map((status) => (
        <ProviderCard
          key={status.provider}
          theme={theme}
          compact={layout.compact}
          status={status}
          warnDays={warnDays}
        />
      ))}

      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <Button
          theme={theme}
          label={statuses.isFetching ? "Refreshing…" : "Refresh"}
          disabled={statuses.isFetching}
          onPress={() => void statuses.refetch()}
        />
        {checkedAt ? <Text style={muted}>{`Checked ${new Date(checkedAt).toLocaleTimeString()}`}</Text> : null}
      </View>
    </ScrollView>
  );
}
