import { useState, type FormEvent } from "react";
import PageHeader from "../../components/ui/PageHeader";
import Switch from "../../components/ui/Switch";
import { useLoad } from "../../hooks/useLoad";
import { getSettings, updateSettings, type PlatformSetting } from "../../services/admin.api";
import { getErrorMessage } from "../../lib/errors";
import { alertError, alertSuccess, btnPrimary, card, inputWidth } from "../../lib/ui";
import { useI18n } from "../../i18n/useI18n";
import { translate, translateOr } from "../../i18n/translate";

function SettingsForm({ initial, onSaved }: { initial: PlatformSetting[]; onSaved: () => void }) {
  const { t } = useI18n();
  const [values, setValues] = useState<Record<string, boolean | string>>(() =>
    Object.fromEntries(initial.map((s) => [s.key, typeof s.value === "boolean" ? s.value : String(s.value)]))
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const changes = Object.fromEntries(
    initial.flatMap((setting) => {
      const value = values[setting.key];
      const parsed = typeof setting.value === "boolean" ? value : Number(value);
      return parsed === setting.value ? [] : [[setting.key, parsed as boolean | number]];
    })
  );
  const dirty = Object.keys(changes).length > 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await updateSettings(changes);
      setMessage({ tone: "success", text: t("asettings.saved") });
      onSaved();
    } catch (err) {
      setMessage({ tone: "error", text: getErrorMessage(err, t("asettings.saveFailed")) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {message ? <div className={message.tone === "success" ? alertSuccess : alertError}>{message.text}</div> : null}

      {initial.map((setting) => (
        <section key={setting.key} className={`${card} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}>
          <div>
            <label htmlFor={setting.key} className="font-semibold text-slate-900">{translateOr(`setting.${setting.key}.label`, setting.label)}</label>
            <p className="mt-0.5 text-sm text-slate-500">{translateOr(`setting.${setting.key}.description`, setting.description)}</p>
            <p className="mt-0.5 text-xs text-slate-400">{t("asettings.default", { value: String(setting.default) })}</p>
          </div>
          {typeof setting.value === "boolean" ? (
            <Switch
              id={setting.key}
              checked={values[setting.key] as boolean}
              onChange={(checked) => setValues((v) => ({ ...v, [setting.key]: checked }))}
            />
          ) : (
            <input
              id={setting.key}
              type="number"
              step="any"
              required
              value={values[setting.key] as string}
              onChange={(e) => setValues((v) => ({ ...v, [setting.key]: e.target.value }))}
              className={`${inputWidth("w-32")} shrink-0`}
            />
          )}
        </section>
      ))}

      <button type="submit" disabled={!dirty || saving} className={btnPrimary}>
        {saving ? t("common.saving") : t("common.saveChanges")}
      </button>
    </form>
  );
}

export default function AdminSettings() {
  const { t } = useI18n();
  const { data, error, reload } = useLoad("settings", getSettings, translate("asettings.loadFailed"));

  return (
    <div>
      <PageHeader title={t("nav.settings")} description={t("asettings.subtitle")} />
      {error ? <div className={`${alertError} mb-4`}>{error}</div> : null}
      {data ? <SettingsForm key={JSON.stringify(data)} initial={data} onSaved={reload} /> : <p className="text-sm text-slate-500">{t("common.loading")}</p>}
    </div>
  );
}
