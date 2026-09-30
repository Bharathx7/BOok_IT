import type { Translation } from "../../define";
import type { shell as english } from "../shell";

// Hindi for ../shell.ts. Must cover every key there.
export const shell: Translation<typeof english> = {
  "bell.label": "सूचनाएँ",
  "bell.labelUnread": "सूचनाएँ, {count} अपठित",
  "bell.markAll": "सभी को पढ़ा हुआ मानें",
  "bell.empty": "कोई नई सूचना नहीं है।",
  "bell.all": "सभी सूचनाएँ और सेटिंग्स",
  "toast.dismiss": "हटाएँ",
  "invite.invalid": "यह निमंत्रण लिंक सही नहीं है।",
  "invite.eyebrow": "आपको न्योता मिला है",
  "invite.heading": "किसी ने आपके लिए जगह रखी है।",
  "invite.blurb": "उन्हें बताएँ कि आप आ पाएँगे या नहीं।",
  "invite.footnote": "BookIt — खेल के मैदान बुक करें।",
  "invite.title": "{name} ने आपको बुलाया है",
  "invite.titlePlain": "निमंत्रण",
  "invite.in": "आप शामिल हैं!",
  "invite.see": "बुकिंग देखें",
  "invite.declined": "आपने मना किया। मन बदल गया? आप नीचे अब भी हाँ कह सकते हैं।",
  "invite.accept": "मैं आऊँगा",
  "invite.decline": "नहीं आ पाऊँगा",
  "invite.signIn": "यह बुकिंग अपने खाते में रखने के लिए जवाब देने से पहले {link}।",
  "invite.signInLink": "साइन इन करें",
};
