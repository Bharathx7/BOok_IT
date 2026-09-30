import { Fragment, type ReactNode } from "react";
import type { MessageKey } from "./en";
import { useI18n } from "./useI18n";

type TransProps = {
  k: MessageKey;
  /** Placeholder values; elements (e.g. <strong>) are allowed. */
  values: Record<string, ReactNode>;
};

/** A message whose placeholders are filled with React nodes. */
function Trans({ k, values }: TransProps) {
  const { t } = useI18n();
  // Split on {name}; odd entries are placeholder names.
  const parts = t(k).split(/\{(\w+)\}/);

  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>{index % 2 === 1 ? (values[part] ?? `{${part}}`) : part}</Fragment>
      ))}
    </>
  );
}

export default Trans;
