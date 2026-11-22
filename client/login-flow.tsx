import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { copyText, useToast } from "@getpaseo/plugin/client/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import {
  cancelLoginRpc,
  MAX_CODE_LENGTH,
  startLoginRpc,
  submitCodeRpc,
  type LoginSnapshot,
} from "../shared/contracts";
import type { ProviderId } from "../shared/providers";
import { isActivePhase, loginKey, STATUS_KEY, useLoginState } from "./data";
import { Button, Callout } from "./parts";

// The app wraps a handler error as "Request failed: <message> requestType=… code=…".
function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  const message = raw.replace(/^Request failed:\s*/, "").replace(/\s+requestType=\S+.*$/, "").trim();
  return message && !message.startsWith("[") ? message : "The request failed.";
}

export function LoginFlow(props: {
  theme: PluginTheme;
  compact: boolean;
  provider: ProviderId;
  label: string;
  signedIn: boolean;
}) {
  const { theme, compact, provider, label, signedIn } = props;
  const queryClient = useQueryClient();
  const toast = useToast();
  const login = useLoginState(provider);
  const [code, setCode] = useState("");

  const startLogin = useRpc(startLoginRpc);
  const submitCode = useRpc(submitCodeRpc);
  const cancelLogin = useRpc(cancelLoginRpc);

  const apply = (snapshot: LoginSnapshot) => {
    queryClient.setQueryData(loginKey(provider), snapshot);
    if (!isActivePhase(snapshot.phase)) {
      setCode("");
      void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    }
  };
  const start = useMutation({ mutationFn: () => startLogin({ provider }), onSuccess: apply });
  const submit = useMutation({
    mutationFn: () => submitCode({ provider, code: code.trim() }),
    onSuccess: apply,
  });
  const cancel = useMutation({ mutationFn: () => cancelLogin({ provider }), onSuccess: apply });

  const snapshot = login.data;
  const phase = start.isPending ? "starting" : submit.isPending ? "verifying" : (snapshot?.phase ?? "idle");
  const url = snapshot?.url ?? null;
  const requestError = start.error ?? submit.error ?? cancel.error;
  const muted = { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 18 } as const;
  const body = { color: theme.colors.foreground, fontSize: 14, lineHeight: 20 } as const;

  async function openLink() {
    if (!url) return;
    try {
      await openExternalUrl(url);
    } catch {
      toast.error("Could not open the link. Copy it and open it in a browser.");
    }
  }

  async function copyLink() {
    if (!url) return;
    try {
      await copyText(url);
      toast.show("Link copied", { variant: "success" });
    } catch {
      toast.error("Could not copy. Select the link and copy it.");
    }
  }

  const startButton = (
    <Button
      theme={theme}
      primary
      label={signedIn ? "Sign in again" : "Sign in"}
      disabled={start.isPending}
      onPress={() => {
        submit.reset();
        cancel.reset();
        start.mutate();
      }}
    />
  );

  return (
    <View style={{ gap: 12 }}>
      {phase === "succeeded" ? (
        <Callout theme={theme} tone="success">
          {`${label} is signed in. Start a new agent to use this sign-in. Agents that are already running keep the sign-in they started with.`}
        </Callout>
      ) : null}
      {phase === "failed" || phase === "timed_out" ? (
        <Callout theme={theme} tone="danger">
          {snapshot?.message ?? "The sign-in did not succeed."}
        </Callout>
      ) : null}
      {phase === "cancelled" && snapshot?.message ? <Text style={muted}>{snapshot.message}</Text> : null}
      {requestError ? (
        <Callout theme={theme} tone="danger">
          {errorText(requestError)}
        </Callout>
      ) : null}

      {phase === "starting" ? <Text style={muted}>Starting the sign-in on the host…</Text> : null}
      {phase === "verifying" ? <Text style={muted}>Checking the code…</Text> : null}

      {phase === "awaiting_code" && url ? (
        <View style={{ gap: 12 }}>
          <Text style={body}>1. Open the sign-in link and approve the request.</Text>
          <Text selectable numberOfLines={3} style={[muted, { fontFamily: "monospace" }]}>
            {url}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Button theme={theme} primary label="Open link" onPress={() => void openLink()} />
            <Button theme={theme} label="Copy link" onPress={() => void copyLink()} />
          </View>
          <Text style={body}>2. Paste the code that the page shows.</Text>
          <TextInput
            accessibilityLabel="Sign-in code"
            value={code}
            onChangeText={setCode}
            placeholder="Code"
            placeholderTextColor={theme.colors.foregroundMuted}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={MAX_CODE_LENGTH}
            onSubmitEditing={() => {
              if (code.trim()) submit.mutate();
            }}
            style={{
              color: theme.colors.foreground,
              backgroundColor: theme.colors.surface2,
              borderColor: theme.colors.border,
              borderWidth: 1,
              borderRadius: 8,
              paddingVertical: 10,
              paddingHorizontal: 12,
              fontSize: 14,
            }}
          />
          <View style={{ flexDirection: compact ? "column" : "row", gap: 8 }}>
            <Button
              theme={theme}
              primary
              label="Submit code"
              disabled={!code.trim() || submit.isPending}
              onPress={() => submit.mutate()}
            />
            <Button theme={theme} label="Cancel" disabled={cancel.isPending} onPress={() => cancel.mutate()} />
          </View>
          <Text style={muted}>The sign-in stops by itself after a few minutes if you do not finish it.</Text>
        </View>
      ) : null}

      {!isActivePhase(phase) ? <View style={{ flexDirection: "row" }}>{startButton}</View> : null}
    </View>
  );
}
