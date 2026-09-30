import { io } from "socket.io-client";

const socket = io("http://localhost:5000");

socket.on("connect", () => {
  console.log("Connected:", socket.id);
  console.log("Waiting for booking events...");
});

socket.on("bookingConfirmed", (data) => {
  console.log("bookingConfirmed received:", data);
});

socket.on("bookingCancelled", (data) => {
  console.log("bookingCancelled received:", data);
});

socket.on("bookingCompleted", (data) => {
  console.log("bookingCompleted received:", data);
});

socket.on("connect_error", (error) => {
  console.error("Connection error:", error.message);
});