import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsRow, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { noticeSettings } from "../shared/settings";

const DAY_OPTIONS = [1, 2, 3, 5, 7, 10, 14, 21, 30];

export function NoticeSettings(_props: PluginSurfaceProps) {
  const settings = useSettings(noticeSettings);

  if (settings.status !== "ready") {
    const label = settings.status === "loading" ? "Loading…" : "The settings could not be read";
    const error = settings.status === "loading" ? null : settings.error;
    return (
      <SettingsSection title="Notice">
        <SettingsCard>
          <SettingsRow label={label} error={error} />
        </SettingsCard>
      </SettingsSection>
    );
  }

  const { values, revision } = settings;
  const days = DAY_OPTIONS.includes(values.warnDays)
    ? DAY_OPTIONS
    : [...DAY_OPTIONS, values.warnDays].sort((a, b) => a - b);

  return (
    <SettingsSection title="Notice">
      <SettingsCard>
        <SettingsSelect
          label="Warn before the sign-in ends"
          hint="The sidebar row turns into a warning this many days before a sign-in ends."
          error={settings.saveError ?? null}
          value={String(values.warnDays)}
          options={days.map((day) => ({ value: String(day), label: day === 1 ? "1 day" : `${day} days` }))}
          disabled={settings.saving}
          onValueChange={(value) => void settings.save({ ...values, warnDays: Number(value) }, revision)}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
