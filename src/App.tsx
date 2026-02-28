/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, RotateCcw, User, Users, Cpu, Hash } from 'lucide-react';

type Player = 'X' | 'O' | null;
type GameMode = 'single' | 'multi' | 'offline' | null;

const WINNING_COMBINATIONS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // Columns
  [0, 4, 8], [2, 4, 6]             // Diagonals
];

export default function App() {
  const [mode, setMode] = useState<GameMode>(null);
  const [board, setBoard] = useState<Player[]>(Array(9).fill(null));
  const [isXNext, setIsXNext] = useState(true);
  const [winner, setWinner] = useState<Player | 'Draw'>(null);
  const [winningLine, setWinningLine] = useState<number[] | null>(null);
  const [scores, setScores] = useState({
    single: { X: 0, O: 0, Draws: 0 },
    multi: { X: 0, O: 0, Draws: 0 },
    offline: { X: 0, O: 0, Draws: 0 }
  });
  
  // Single player state
  const [userSymbol, setUserSymbol] = useState<Player>(null);
  const [showSymbolSelection, setShowSymbolSelection] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomCode, setRoomCode] = useState('');
  const [mySymbol, setMySymbol] = useState<Player>(null);
  const [isMultiReady, setIsMultiReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);

  const checkWinner = (squares: Player[]) => {
    for (const combo of WINNING_COMBINATIONS) {
      const [a, b, c] = combo;
      if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c]) {
        return { winner: squares[a], line: combo };
      }
    }
    if (squares.every(s => s !== null)) {
      return { winner: 'Draw' as const, line: null };
    }
    return null;
  };

  // Minimax AI
  const minimax = (squares: Player[], depth: number, isMaximizing: boolean, aiSymbol: Player): number => {
    const result = checkWinner(squares);
    const opponentSymbol = aiSymbol === 'X' ? 'O' : 'X';
    
    if (result?.winner === aiSymbol) return 10 - depth;
    if (result?.winner === opponentSymbol) return depth - 10;
    if (result?.winner === 'Draw') return 0;

    if (isMaximizing) {
      let bestScore = -Infinity;
      for (let i = 0; i < 9; i++) {
        if (!squares[i]) {
          squares[i] = aiSymbol;
          const score = minimax(squares, depth + 1, false, aiSymbol);
          squares[i] = null;
          bestScore = Math.max(score, bestScore);
        }
      }
      return bestScore;
    } else {
      let bestScore = Infinity;
      for (let i = 0; i < 9; i++) {
        if (!squares[i]) {
          squares[i] = opponentSymbol;
          const score = minimax(squares, depth + 1, true, aiSymbol);
          squares[i] = null;
          bestScore = Math.min(score, bestScore);
        }
      }
      return bestScore;
    }
  };

  const getBestMove = (squares: Player[], aiSymbol: Player) => {
    let bestScore = -Infinity;
    let move = -1;
    for (let i = 0; i < 9; i++) {
      if (!squares[i]) {
        squares[i] = aiSymbol;
        const score = minimax(squares, 0, false, aiSymbol);
        squares[i] = null;
        if (score > bestScore) {
          bestScore = score;
          move = i;
        }
      }
    }
    return move;
  };

  const handleSquareClick = (index: number) => {
    if (board[index] || winner) return;

    if (mode === 'single' && (isXNext ? 'X' : 'O') !== userSymbol) return;

    if (mode === 'multi') {
      if (!isMultiReady || (isXNext && mySymbol !== 'X') || (!isXNext && mySymbol !== 'O')) return;
      socket?.emit('make_move', { roomCode, index, symbol: mySymbol });
      return;
    }

    const newBoard = [...board];
    newBoard[index] = isXNext ? 'X' : 'O';
    setBoard(newBoard);
    setIsXNext(!isXNext);

    const result = checkWinner(newBoard);
    if (result) {
      setWinner(result.winner);
      setWinningLine(result.line);
      updateScores(result.winner);
    }
  };

  const updateScores = (res: Player | 'Draw') => {
    if (!mode) return;
    setScores(prev => ({
      ...prev,
      [mode]: {
        ...prev[mode],
        X: res === 'X' ? prev[mode].X + 1 : prev[mode].X,
        O: res === 'O' ? prev[mode].O + 1 : prev[mode].O,
        Draws: res === 'Draw' ? prev[mode].Draws + 1 : prev[mode].Draws
      }
    }));
  };

  useEffect(() => {
    if (mode === 'single' && userSymbol && (isXNext ? 'X' : 'O') !== userSymbol && !winner) {
      const aiSymbol = userSymbol === 'X' ? 'O' : 'X';
      const timer = setTimeout(() => {
        const bestMove = getBestMove(board, aiSymbol);
        if (bestMove !== -1) {
          const newBoard = [...board];
          newBoard[bestMove] = aiSymbol;
          setBoard(newBoard);
          setIsXNext(aiSymbol === 'X' ? false : true);

          const result = checkWinner(newBoard);
          if (result) {
            setWinner(result.winner);
            setWinningLine(result.line);
            updateScores(result.winner);
          }
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isXNext, mode, winner, board, userSymbol]);

  const joinMultiplayer = (code?: string) => {
    const targetCode = code || roomCode;
    if (!targetCode.trim()) return;
    
    const newSocket = io();
    setSocket(newSocket);

    newSocket.emit('join_room', targetCode);

    newSocket.on('player_assignment', (symbol: Player) => {
      setMySymbol(symbol);
      setError(null);
    });

    newSocket.on('game_ready', ({ board, turn }) => {
      setBoard(board);
      setIsXNext(turn === 'X');
      setIsMultiReady(true);
    });

    newSocket.on('move_made', ({ board, turn }) => {
      setBoard(board);
      setIsXNext(turn === 'X');
      const result = checkWinner(board);
      if (result) {
        setWinner(result.winner);
        setWinningLine(result.line);
        updateScores(result.winner);
      }
    });

    newSocket.on('game_reset', ({ board, turn }) => {
      setBoard(board);
      setIsXNext(turn === 'X');
      setWinner(null);
      setWinningLine(null);
    });

    newSocket.on('error', (msg: string) => {
      setError(msg);
      newSocket.disconnect();
      setSocket(null);
    });
  };

  useEffect(() => {
    return () => {
      if (socket) socket.disconnect();
    };
  }, [socket]);

  const createRoom = () => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomCode(code);
    joinMultiplayer(code);
  };

  const resetGame = () => {
    if (mode === 'multi') {
      socket?.emit('reset_game', roomCode);
    } else {
      setBoard(Array(9).fill(null));
      setIsXNext(true);
      setWinner(null);
      setWinningLine(null);
    }
  };

  const quitGame = () => {
    if (socket) socket.disconnect();
    if (mode) {
      setScores(prev => ({
        ...prev,
        [mode]: { X: 0, O: 0, Draws: 0 }
      }));
    }
    setMode(null);
    setBoard(Array(9).fill(null));
    setIsXNext(true);
    setWinner(null);
    setWinningLine(null);
    setSocket(null);
    setIsMultiReady(false);
    setMySymbol(null);
    setUserSymbol(null);
    setShowSymbolSelection(false);
  };

  if (!mode) {
    return (
      <div className="min-h-screen bg-[#0f172a] text-white flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full text-center space-y-8"
        >
          <div className="space-y-2">
            <h1 className="text-5xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-600">
              TIC-TAC-TOE
            </h1>
            <p className="text-slate-400 font-medium">Choose your battle mode</p>
          </div>

          <div className="grid gap-4">
            <button
              onClick={() => {
                setMode('single');
                setShowSymbolSelection(true);
              }}
              className="group relative flex items-center justify-between p-6 bg-slate-800/50 border border-slate-700 rounded-2xl hover:bg-slate-800 hover:border-cyan-500/50 transition-all duration-300"
            >
              <div className="flex items-center gap-4">
                <div className="p-3 bg-cyan-500/10 rounded-xl text-cyan-400 group-hover:scale-110 transition-transform">
                  <Cpu size={24} />
                </div>
                <div className="text-left">
                  <div className="font-bold text-lg">Single Player</div>
                  <div className="text-sm text-slate-400">Vs Unbeatable AI</div>
                </div>
              </div>
              <User className="text-slate-600 group-hover:text-cyan-400" />
            </button>

            <button
              onClick={() => setMode('multi')}
              className="group relative flex items-center justify-between p-6 bg-slate-800/50 border border-slate-700 rounded-2xl hover:bg-slate-800 hover:border-blue-500/50 transition-all duration-300"
            >
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-500/10 rounded-xl text-blue-400 group-hover:scale-110 transition-transform">
                  <Users size={24} />
                </div>
                <div className="text-left">
                  <div className="font-bold text-lg">Online Multiplayer</div>
                  <div className="text-sm text-slate-400">Real-time Online</div>
                </div>
              </div>
              <Users className="text-slate-600 group-hover:text-blue-400" />
            </button>

            <button
              onClick={() => setMode('offline')}
              className="group relative flex items-center justify-between p-6 bg-slate-800/50 border border-slate-700 rounded-2xl hover:bg-slate-800 hover:border-emerald-500/50 transition-all duration-300"
            >
              <div className="flex items-center gap-4">
                <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-400 group-hover:scale-110 transition-transform">
                  <Users size={24} />
                </div>
                <div className="text-left">
                  <div className="font-bold text-lg">Local Multiplayer</div>
                  <div className="text-sm text-slate-400">Play on same device</div>
                </div>
              </div>
              <Users className="text-slate-600 group-hover:text-emerald-400" />
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f172a] text-white flex flex-col items-center p-4 sm:p-8">
      <div className="max-w-4xl w-full flex flex-col items-center gap-8">
        {/* Header */}
        <div className="w-full flex justify-between items-center">
          <button 
            onClick={quitGame}
            className="text-slate-400 hover:text-white transition-colors flex items-center gap-2 font-medium"
          >
            <RotateCcw size={18} /> Quit
          </button>
          <div className="flex gap-4">
            <div className="bg-slate-800/80 px-4 py-2 rounded-xl border border-slate-700">
              <span className="text-cyan-400 font-bold">X:</span> {mode ? scores[mode].X : 0}
            </div>
            <div className="bg-slate-800/80 px-4 py-2 rounded-xl border border-slate-700">
              <span className="text-pink-400 font-bold">O:</span> {mode ? scores[mode].O : 0}
            </div>
            <div className="bg-slate-800/80 px-4 py-2 rounded-xl border border-slate-700">
              <span className="text-slate-400 font-bold">Draws:</span> {mode ? scores[mode].Draws : 0}
            </div>
          </div>
        </div>

        {mode === 'single' && showSymbolSelection ? (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-slate-800/50 p-8 rounded-3xl border border-slate-700 w-full max-w-md space-y-8"
          >
            <div className="text-center space-y-2">
              <User className="mx-auto text-cyan-400" size={48} />
              <h2 className="text-2xl font-bold">Choose Your Symbol</h2>
              <p className="text-slate-400">X goes first, O goes second</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => {
                  setUserSymbol('X');
                  setShowSymbolSelection(false);
                }}
                className="p-8 bg-slate-900 border border-slate-700 rounded-2xl hover:border-cyan-500 transition-all group"
              >
                <span className="text-6xl font-black text-cyan-400 group-hover:scale-110 block transition-transform">X</span>
                <span className="text-xs text-slate-500 mt-2 block font-bold">START AS X</span>
              </button>
              <button
                onClick={() => {
                  setUserSymbol('O');
                  setShowSymbolSelection(false);
                }}
                className="p-8 bg-slate-900 border border-slate-700 rounded-2xl hover:border-pink-500 transition-all group"
              >
                <span className="text-6xl font-black text-pink-400 group-hover:scale-110 block transition-transform">O</span>
                <span className="text-xs text-slate-500 mt-2 block font-bold">START AS O</span>
              </button>
            </div>
          </motion.div>
        ) : mode === 'multi' && !isMultiReady ? (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-slate-800/50 p-8 rounded-3xl border border-slate-700 w-full max-w-md space-y-6"
          >
            <div className="text-center space-y-2">
              <Hash className="mx-auto text-blue-400" size={48} />
              <h2 className="text-2xl font-bold">Join a Room</h2>
              <p className="text-slate-400">Enter a code to play with a friend</p>
            </div>
            <div className="space-y-4">
              <div className="flex flex-col gap-2">
                <button
                  onClick={createRoom}
                  className="w-full bg-slate-700 hover:bg-slate-600 py-3 rounded-xl font-bold transition-colors border border-slate-600"
                >
                  Create New Room
                </button>
                <div className="flex items-center gap-2 py-2">
                  <div className="h-px bg-slate-700 flex-1" />
                  <span className="text-xs text-slate-500 font-bold uppercase tracking-widest">OR JOIN</span>
                  <div className="h-px bg-slate-700 flex-1" />
                </div>
              </div>
              <input
                type="text"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder="ENTER ROOM CODE"
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-center text-xl font-mono tracking-widest focus:outline-none focus:border-blue-500 transition-colors"
              />
              <button
                onClick={() => joinMultiplayer()}
                className="w-full bg-blue-600 hover:bg-blue-500 py-3 rounded-xl font-bold transition-colors shadow-lg shadow-blue-900/20"
              >
                Join Arena
              </button>
              {error && <p className="text-red-400 text-center text-sm">{error}</p>}
              {mySymbol && !isMultiReady && (
                <div className="space-y-4 pt-4 border-t border-slate-700">
                  <div className="text-center">
                    <p className="text-sm text-slate-500 uppercase tracking-widest font-bold mb-2">Share this code</p>
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-3xl font-mono font-black text-blue-400 tracking-widest">{roomCode}</span>
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(roomCode);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                        className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors relative"
                        title="Copy to clipboard"
                      >
                        {copied ? <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-[10px] px-2 py-1 rounded font-bold whitespace-nowrap">COPIED!</span> : null}
                        <Hash size={20} />
                      </button>
                    </div>
                  </div>
                  <p className="text-blue-400 text-center animate-pulse font-medium">Waiting for opponent to join...</p>
                </div>
              )}
            </div>
          </motion.div>
        ) : (
          <div className="flex flex-col items-center gap-8 w-full">
            {/* Status */}
            <div className="text-center space-y-2">
              <AnimatePresence mode="wait">
                {winner ? (
                  <motion.div
                    key="winner"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col items-center gap-2"
                  >
                    <Trophy className="text-yellow-400" size={48} />
                    <h2 className="text-4xl font-black italic">
                      {winner === 'Draw' ? "IT'S A DRAW!" : `${winner} WINS!`}
                    </h2>
                  </motion.div>
                ) : (
                  <motion.div
                    key="turn"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center gap-3"
                  >
                    <div className={`w-3 h-3 rounded-full animate-pulse ${isXNext ? 'bg-cyan-400' : 'bg-pink-400'}`} />
                    <h2 className="text-2xl font-bold tracking-tight">
                      {mode === 'multi' ? (
                        mySymbol === (isXNext ? 'X' : 'O') ? "YOUR TURN" : "OPPONENT'S TURN"
                      ) : mode === 'offline' ? (
                        isXNext ? "PLAYER X'S TURN" : "PLAYER O'S TURN"
                      ) : (
                        isXNext ? "YOUR TURN (X)" : "AI IS THINKING..."
                      )}
                    </h2>
                  </motion.div>
                )}
              </AnimatePresence>
              {mode === 'multi' && (
                <p className="text-slate-500 text-sm font-mono">ROOM: {roomCode} | YOU ARE {mySymbol}</p>
              )}
            </div>

            {/* Board */}
            <div className="grid grid-cols-3 gap-3 p-3 bg-slate-800/30 rounded-3xl border border-slate-700/50 shadow-2xl">
              {board.map((square, i) => {
                const isWinningSquare = winningLine?.includes(i);
                return (
                  <motion.button
                    key={i}
                    whileHover={!square && !winner ? { scale: 1.02, backgroundColor: 'rgba(30, 41, 59, 0.8)' } : {}}
                    whileTap={!square && !winner ? { scale: 0.95 } : {}}
                    onClick={() => handleSquareClick(i)}
                    className={`
                      w-20 h-20 sm:w-28 sm:h-28 rounded-2xl flex items-center justify-center text-4xl sm:text-5xl font-black transition-all duration-300
                      ${square ? 'cursor-default' : 'cursor-pointer'}
                      ${isWinningSquare ? 'bg-gradient-to-br from-yellow-400/20 to-yellow-600/20 border-2 border-yellow-500/50' : 'bg-slate-900/80 border border-slate-800'}
                    `}
                  >
                    <AnimatePresence>
                      {square && (
                        <motion.span
                          initial={{ scale: 0, rotate: -45 }}
                          animate={{ scale: 1, rotate: 0 }}
                          className={square === 'X' ? 'text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.4)]' : 'text-pink-400 drop-shadow-[0_0_8px_rgba(244,114,182,0.4)]'}
                        >
                          {square}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </motion.button>
                );
              })}
            </div>

            {/* Actions */}
            <div className="flex gap-4">
              <button
                onClick={resetGame}
                className="flex items-center gap-2 px-8 py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl font-bold transition-all active:scale-95"
              >
                <RotateCcw size={20} /> Reset Game
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
