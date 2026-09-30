import axios from "axios";
import { translate } from "../i18n/translate";

interface ApiErrorBody {
  message?: string;
  errors?: { field: string; message: string }[];
  requestId?: string;
}

/**
 * Turns an API error into a message a user can act on. The server's own
 * message is preferred for 4xx responses; 5xx responses never leak details
 * but include the request ID so support can find the log line.
 */
export function getErrorMessage(err: unknown, fallback = translate("error.generic")) {
  if (!axios.isAxiosError<ApiErrorBody>(err)) {
    return fallback;
  }

  if (!err.response) {
    return translate("error.network");
  }

  const { status, data } = err.response;
  const serverMessage =
    typeof data?.message === "string" && data.message.trim() ? data.message : "";

  switch (status) {
    case 400: {
      const fieldErrors = data?.errors ?? [];

      if (fieldErrors.length > 0) {
        return fieldErrors
          .map(({ field, message }) => (field ? `${field}: ${message}` : message))
          .join(". ");
      }

      return serverMessage || translate("error.invalid");
    }
    case 401:
      return serverMessage || translate("error.session");
    case 403:
      return serverMessage || translate("error.forbidden");
    case 404:
      return serverMessage || translate("error.notFound");
    case 409:
      return serverMessage || translate("error.conflict");
    case 429:
      return translate("error.tooMany");
    default:
      if (status >= 500) {
        return data?.requestId
          ? translate("error.serverRef", { ref: data.requestId })
          : translate("error.server");
      }

      return serverMessage || fallback;
  }
}
