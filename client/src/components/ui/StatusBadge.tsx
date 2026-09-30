import { useI18n } from "../../i18n/useI18n";
import { translateOr } from "../../i18n/translate";
import { statusClass } from "../../lib/ui";

/** A booking's status as a coloured, translated badge. */
function StatusBadge({ status }: { status: string }) {
  const { language } = useI18n();
  return <span className={statusClass(status)}>{translateOr(`status.${status}`, status, language)}</span>;
}

export default StatusBadge;
