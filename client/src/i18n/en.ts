import { account } from "./messages/account";
import { admin } from "./messages/admin";
import { auth } from "./messages/auth";
import { booking } from "./messages/booking";
import { common } from "./messages/common";
import { core } from "./messages/core";
import { customer } from "./messages/customer";
import { provider } from "./messages/provider";
import { shell } from "./messages/shell";
import { venues } from "./messages/venues";
import { payments } from "./messages/payments";

// English, bundled with the app. Other languages live in ./messages/<code>/
// and are downloaded only when chosen.
export const en = {
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

export type MessageKey = keyof typeof en;
