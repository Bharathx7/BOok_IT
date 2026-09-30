import type { MessageKey } from "../../en";
import { account } from "./account";
import { admin } from "./admin";
import { auth } from "./auth";
import { booking } from "./booking";
import { common } from "./common";
import { core } from "./core";
import { customer } from "./customer";
import { provider } from "./provider";
import { shell } from "./shell";
import { venues } from "./venues";
import { payments } from "./payments";

// Hindi, loaded on demand (see ../../translate.ts).
export const hi: Record<MessageKey, string> = {
  ...core,
  ...common,
  ...auth,
  ...shell,
  ...customer,
  ...booking,
  ...venues,
  ...account,
  ...provider,
  ...admin,
  ...payments,
};
