import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // Game state management
  const rooms = new Map();

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join_room", (roomCode) => {
      socket.join(roomCode);
      
      if (!rooms.has(roomCode)) {
        rooms.set(roomCode, { players: [socket.id], board: Array(9).fill(null), turn: 'X' });
        socket.emit("player_assignment", "X");
      } else {
        const room = rooms.get(roomCode);
        if (room.players.length < 2) {
          room.players.push(socket.id);
          socket.emit("player_assignment", "O");
          io.to(roomCode).emit("game_ready", { board: room.board, turn: room.turn });
        } else {
          socket.emit("error", "Room is full");
        }
      }
    });

    socket.on("make_move", ({ roomCode, index, symbol }) => {
      const room = rooms.get(roomCode);
      if (room && room.board[index] === null && room.turn === symbol) {
        room.board[index] = symbol;
        room.turn = symbol === 'X' ? 'O' : 'X';
        io.to(roomCode).emit("move_made", { board: room.board, turn: room.turn });
      }
    });

    socket.on("reset_game", (roomCode) => {
      const room = rooms.get(roomCode);
      if (room) {
        room.board = Array(9).fill(null);
        room.turn = 'X';
        io.to(roomCode).emit("game_reset", { board: room.board, turn: room.turn });
      }
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      // Optional: Handle cleanup of rooms
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve("dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve("dist/index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
