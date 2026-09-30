import { io } from "socket.io-client";
import { getAccessToken } from "./services/api";

/**
 * The server only delivers booking events to the rooms a socket belongs to
 * (`user:<id>`, `admin`), which it derives from the JWT sent in `auth.token`.
 * The token is read at every (re)connect, so routine token refreshes need no
 * reconnect; AuthContext calls `reconnectSocket` when the user changes.
 */
export const socket = io(
  import.meta.env.VITE_SOCKET_URL || "http://localhost:5000",
  {
    autoConnect: false,
    withCredentials: true,
    auth: (callback) => {
      const token = getAccessToken();
      callback(token ? { token } : {});
    },
  }
);

export function reconnectSocket() {
  if (socket.connected) {
    socket.disconnect();
  }

  socket.connect();
}

socket.on("connect_error", (error) => {
  // An expired token is rejected by the server. The next API call refreshes
  // it; until then this socket just misses private events.
  console.warn("Socket connection failed:", error.message);
});

if (import.meta.env.DEV) {
  for (const event of [
    "bookingCreated",
    "bookingConfirmed",
    "bookingCancelled",
    "bookingCompleted",
  ]) {
    socket.on(event, (data) => {
      console.debug(`[socket] ${event}`, data);
    });
  }
}
