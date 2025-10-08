/*
 * ChessEngine implements a full chess rule set using a 0x88 mailbox board.
 * It provides legal move generation, FEN/PGN helpers, repetition tracking and
 * utility methods used by the UI, AI and testing harnesses.
 */

const FILES = ['a','b','c','d','e','f','g','h'];
const RANKS = ['8','7','6','5','4','3','2','1'];

const FLAG_CAPTURE = 1 << 0;
const FLAG_DOUBLE_PAWN = 1 << 1;
const FLAG_KING_CASTLE = 1 << 2;
const FLAG_QUEEN_CASTLE = 1 << 3;
const FLAG_EN_PASSANT = 1 << 4;
const FLAG_PROMOTION = 1 << 5;

const PROMOTION_PIECES = ['q','r','b','n'];

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const PIECE_VALUES = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 0,
};

const PST = {
  P: [
      0,0,0,0,0,0,0,0,
      50,50,50,50,50,50,50,50,
      10,10,20,30,30,20,10,10,
      5,5,10,25,25,10,5,5,
      0,0,0,20,20,0,0,0,
      5,-5,-10,0,0,-10,-5,5,
      5,10,10,-20,-20,10,10,5,
      0,0,0,0,0,0,0,0
  ],
  N: [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,0,0,0,0,-20,-40,
    -30,0,10,15,15,10,0,-30,
    -30,5,15,20,20,15,5,-30,
    -30,0,15,20,20,15,0,-30,
    -30,5,10,15,15,10,5,-30,
    -40,-20,0,5,5,0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50
  ],
  B: [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,0,0,0,0,0,0,-10,
    -10,0,5,10,10,5,0,-10,
    -10,5,5,10,10,5,5,-10,
    -10,0,10,10,10,10,0,-10,
    -10,10,10,10,10,10,10,-10,
    -10,5,0,0,0,0,5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20
  ],
  R: [
     0,0,0,0,0,0,0,0,
     5,10,10,10,10,10,10,5,
    -5,0,0,0,0,0,0,-5,
    -5,0,0,0,0,0,0,-5,
    -5,0,0,0,0,0,0,-5,
    -5,0,0,0,0,0,0,-5,
    -5,0,0,0,0,0,0,-5,
     0,0,0,5,5,0,0,0
  ],
  Q: [
    -20,-10,-10,-5,-5,-10,-10,-20,
    -10,0,0,0,0,0,0,-10,
    -10,0,5,5,5,5,0,-10,
    -5,0,5,5,5,5,0,-5,
     0,0,5,5,5,5,0,-5,
    -10,5,5,5,5,5,0,-10,
    -10,0,5,0,0,0,0,-10,
    -20,-10,-10,-5,-5,-10,-10,-20
  ],
  K: [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20,20,0,0,0,0,20,20,
     20,30,10,0,0,10,30,20
  ],
};

const KNIGHT_OFFSETS = [33, 31, 18, 14, -33, -31, -18, -14];
const KING_OFFSETS = [16, -16, 1, -1, 15, 17, -15, -17];
const BISHOP_OFFSETS = [15, 17, -15, -17];
const ROOK_OFFSETS = [16, -16, 1, -1];

const CASTLING_BITS = {
  K: 1,
  Q: 2,
  k: 4,
  q: 8,
};

const WHITE = 'w';
const BLACK = 'b';

function coordsToSquare(x, y) {
  return (y << 4) | x;
}

function squareToCoords(square) {
  return { x: square & 7, y: square >> 4 };
}

function squareToAlgebraic(square) {
  const { x, y } = squareToCoords(square);
  return FILES[x] + RANKS[y];
}

function algebraicToSquare(coord) {
  if (coord.length !== 2) return null;
  const file = FILES.indexOf(coord[0]);
  const rank = RANKS.indexOf(coord[1]);
  if (file < 0 || rank < 0) return null;
  return coordsToSquare(file, rank);
}

function pieceIndex(piece) {
  switch (piece) {
    case 'P': return 0;
    case 'N': return 1;
    case 'B': return 2;
    case 'R': return 3;
    case 'Q': return 4;
    case 'K': return 5;
    case 'p': return 6;
    case 'n': return 7;
    case 'b': return 8;
    case 'r': return 9;
    case 'q': return 10;
    case 'k': return 11;
    default: return -1;
  }
}

function isWhitePiece(piece) {
  return piece === piece.toUpperCase();
}

function opposite(color) {
  return color === WHITE ? BLACK : WHITE;
}

class Random64 {
  constructor(seed = 0x9e3779b97f4a7c15n) {
    this.state = BigInt.asUintN(64, BigInt(seed));
  }
  next() {
    this.state = BigInt.asUintN(64, this.state * 6364136223846793005n + 1442695040888963407n);
    return this.state;
  }
}

class ChessEngine {
  constructor(fen = START_FEN) {
    this._initZobrist();
    this.board = new Array(128).fill(null);
    this.kingSquare = { [WHITE]: null, [BLACK]: null };
    this.history = [];
    this.moveHistorySAN = [];
    this.positionCounts = new Map();
    this.loadFEN(fen);
  }

  reset() {
    this.loadFEN(START_FEN);
  }

  loadFEN(fen) {
    const parts = fen.trim().split(/\s+/);
    if (!parts[0]) throw new Error('Invalid FEN: missing board definition');
    const rows = parts[0].split('/');
    if (rows.length !== 8) throw new Error('Invalid FEN: expected 8 ranks');
    this.board.fill(null);
    this.kingSquare[WHITE] = null;
    this.kingSquare[BLACK] = null;
    for (let rank = 0; rank < 8; rank++) {
      const row = rows[rank];
      let file = 0;
      for (const ch of row) {
        if (/[1-8]/.test(ch)) {
          file += Number(ch);
        } else {
          const square = coordsToSquare(file, rank);
          this.board[square] = ch;
          if (ch === 'K') this.kingSquare[WHITE] = square;
          if (ch === 'k') this.kingSquare[BLACK] = square;
          file++;
        }
      }
      if (file !== 8) throw new Error('Invalid FEN: rank does not contain 8 files');
    }
    this.turn = parts[1] === BLACK ? BLACK : WHITE;
    const castlingPart = parts[2] || '-';
    this.castling = 0;
    for (const symbol of ['K','Q','k','q']) {
      if (castlingPart.includes(symbol)) {
        this.castling |= CASTLING_BITS[symbol];
      }
    }
    const epPart = parts[3] || '-';
    const epSquare = epPart === '-' ? null : algebraicToSquare(epPart);
    this.enPassant = epSquare;
    this.halfmoveClock = parts[4] ? Number(parts[4]) : 0;
    this.fullmoveNumber = parts[5] ? Number(parts[5]) : 1;
    this.history.length = 0;
    this.moveHistorySAN.length = 0;
    this.positionCounts.clear();
    this.zobrist = 0n;
    this._recalculateZobrist();
    this._recordCurrentPosition();
  }

  toFEN() {
    const rows = [];
    for (let rank = 0; rank < 8; rank++) {
      let empty = 0;
      let row = '';
      for (let file = 0; file < 8; file++) {
        const square = coordsToSquare(file, rank);
        const piece = this.board[square];
        if (!piece) {
          empty++;
        } else {
          if (empty) {
            row += String(empty);
            empty = 0;
          }
          row += piece;
        }
      }
      if (empty) row += String(empty);
      rows.push(row || '8');
    }
    const boardPart = rows.join('/');
    const turnPart = this.turn;
    let castlingPart = '';
    if (this.castling & CASTLING_BITS.K) castlingPart += 'K';
    if (this.castling & CASTLING_BITS.Q) castlingPart += 'Q';
    if (this.castling & CASTLING_BITS.k) castlingPart += 'k';
    if (this.castling & CASTLING_BITS.q) castlingPart += 'q';
    if (!castlingPart) castlingPart = '-';
    const epPart = this.enPassant == null ? '-' : squareToAlgebraic(this.enPassant);
    const halfmovePart = this.halfmoveClock;
    const fullmovePart = this.fullmoveNumber;
    return `${boardPart} ${turnPart} ${castlingPart} ${epPart} ${halfmovePart} ${fullmovePart}`;
  }

  getBoardMatrix() {
    const matrix = [];
    for (let rank = 0; rank < 8; rank++) {
      const row = [];
      for (let file = 0; file < 8; file++) {
        const square = coordsToSquare(file, rank);
        row.push(this.board[square] || '.');
      }
      matrix.push(row);
    }
    return matrix;
  }

  getPieceAt(x, y) {
    if (x < 0 || x > 7 || y < 0 || y > 7) return null;
    const square = coordsToSquare(x, y);
    return this.board[square] || '.';
  }

  getTurn() {
    return this.turn;
  }

  getHalfmoveClock() {
    return this.halfmoveClock;
  }

  getFullmoveNumber() {
    return this.fullmoveNumber;
  }

  getCastlingRights() {
    return this.castling;
  }

  getEnPassantSquare() {
    return this.enPassant;
  }

  getKingCoords(color) {
    const square = this.kingSquare[color];
    if (square == null) return null;
    const { x, y } = squareToCoords(square);
    return { x, y };
  }

  getHistorySAN() {
    return this.moveHistorySAN.slice();
  }

  getZobristKey() {
    return this.zobrist;
  }

  isInCheck(color = this.turn) {
    const kingSq = this.kingSquare[color];
    if (kingSq == null) return false;
    return this._isSquareAttacked(kingSq, opposite(color));
  }

  isCheckmate(color = this.turn) {
    if (!this.isInCheck(color)) return false;
    return this.generateLegalMoves(color).length === 0;
  }

  isStalemate(color = this.turn) {
    if (this.isInCheck(color)) return false;
    return this.generateLegalMoves(color).length === 0;
  }

  isThreefoldRepetition() {
    for (const count of this.positionCounts.values()) {
      if (count >= 3) return true;
    }
    return false;
  }

  isFiftyMoveRule() {
    return this.halfmoveClock >= 100;
  }

  generateLegalMoves(color = this.turn) {
    if (color === this.turn) {
      return this._generateLegalMovesForCurrentTurn();
    }
    const originalTurn = this.turn;
    const originalZobrist = this.zobrist;
    this.turn = color;
    this.zobrist ^= this.zobristTurn;
    const moves = this._generateLegalMovesForCurrentTurn();
    this.turn = originalTurn;
    this.zobrist = originalZobrist;
    return moves;
  }

  _generateLegalMovesForCurrentTurn() {
    const color = this.turn;
    const pseudo = this._generatePseudoMoves(color);
    const legal = [];
    for (const move of pseudo) {
      const state = this._doMove(move);
      if (!this.isInCheck(color)) {
        legal.push(move);
      }
      this._undoMove(move, state);
    }
    return legal;
  }

  generateLegalMovesFrom(x, y) {
    const square = coordsToSquare(x, y);
    const piece = this.board[square];
    if (!piece) return [];
    const color = isWhitePiece(piece) ? WHITE : BLACK;
    if (color !== this.turn) return [];
    return this._generateLegalMovesForCurrentTurn().filter(m => m.from === square);
  }

  makeMove(descriptor) {
    const move = this._resolveMoveDescriptor(descriptor);
    if (!move) return null;
    const legalMoves = this.generateLegalMoves();
    const selected = this._matchMove(move, legalMoves);
    if (!selected) return null;
    const state = this._doMove(selected);
    selected.captured = state.captured;
    selected.resultingHalfmoveClock = this.halfmoveClock;
    selected.resultingFullmove = this.fullmoveNumber;
    const check = this.isInCheck(this.turn);
    const opponentMoves = this.generateLegalMoves();
    const mate = check && opponentMoves.length === 0;
    const stalemate = !check && opponentMoves.length === 0;
    selected.san = this._toSAN(selected, legalMoves, check, mate, stalemate);
    selected.check = check;
    selected.mate = mate;
    selected.stalemate = stalemate;
    const entry = {
      move: selected,
      state,
      positionKey: this._recordCurrentPosition(),
    };
    this.history.push(entry);
    this.moveHistorySAN.push(selected.san);
    return selected;
  }

  undo() {
    if (!this.history.length) return null;
    const entry = this.history.pop();
    this._decrementPosition(entry.positionKey);
    this.moveHistorySAN.pop();
    this._undoMove(entry.move, entry.state);
    return entry.move;
  }

  pushMove(move) {
    const state = this._doMove(move);
    return state;
  }

  popMove(move, state, skipHistory = false) {
    this._undoMove(move, state);
  }

  perft(depth) {
    if (depth === 0) return 1;
    const moves = this.generateLegalMoves();
    if (depth === 1) return moves.length;
    let nodes = 0;
    for (const move of moves) {
      const state = this._doMove(move);
      nodes += this.perft(depth - 1);
      this._undoMove(move, state);
    }
    return nodes;
  }

  exportPGN(metadata = {}) {
    const tags = {
      Event: '?',
      Site: '?',
      Date: this._pgnDate(),
      Round: '1',
      White: 'White',
      Black: 'Black',
      Result: metadata.Result || '*',
      ...metadata,
    };
    const lines = Object.entries(tags)
      .filter(([k, v]) => v != null)
      .map(([k, v]) => `[${k} "${String(v)}"]`);
    const moves = [];
    for (let i = 0; i < this.moveHistorySAN.length; i += 2) {
      const moveNumber = 1 + (i >> 1);
      const whiteMove = this.moveHistorySAN[i];
      const blackMove = this.moveHistorySAN[i + 1];
      let segment = `${moveNumber}. ${whiteMove}`;
      if (blackMove) segment += ` ${blackMove}`;
      moves.push(segment);
    }
    const result = tags.Result || '*';
    const body = moves.join(' ');
    return `${lines.join('\n')}\n\n${body}${body ? ' ' : ''}${result}`;
  }

  moveFromAlgebraic(moveStr) {
    if (typeof moveStr !== 'string' || moveStr.length < 4) return null;
    const from = algebraicToSquare(moveStr.slice(0, 2));
    const to = algebraicToSquare(moveStr.slice(2, 4));
    if (from == null || to == null) return null;
    const promotionChar = moveStr.length > 4 ? moveStr[4] : undefined;
    return this.makeMove({ from, to, promotion: promotionChar });
  }

  _resolveMoveDescriptor(descriptor) {
    if (!descriptor) return null;
    if (typeof descriptor === 'string') {
      return this._resolveMoveDescriptor({ algebraic: descriptor });
    }
    if (typeof descriptor.algebraic === 'string') {
      const move = this._parseCoordinateMove(descriptor.algebraic);
      if (!move) return null;
      move.promotion = descriptor.promotion || move.promotion;
      return move;
    }
    if (descriptor.from != null && descriptor.to != null) {
      let fromSquare = descriptor.from;
      let toSquare = descriptor.to;
      if (typeof fromSquare === 'string') fromSquare = algebraicToSquare(fromSquare);
      if (typeof toSquare === 'string') toSquare = algebraicToSquare(toSquare);
      if (fromSquare == null || toSquare == null) return null;
      return {
        from: fromSquare,
        to: toSquare,
        promotion: descriptor.promotion,
      };
    }
    return null;
  }

  _parseCoordinateMove(moveStr) {
    const from = algebraicToSquare(moveStr.slice(0, 2));
    const to = algebraicToSquare(moveStr.slice(2, 4));
    if (from == null || to == null) return null;
    const promotion = moveStr.length > 4 ? moveStr[4] : undefined;
    return { from, to, promotion };
  }

  _matchMove(target, moves) {
    for (const move of moves) {
      if (move.from === target.from && move.to === target.to) {
        if (move.flags & FLAG_PROMOTION) {
          if (!target.promotion) continue;
          const desired = target.promotion.toLowerCase();
          if (move.promotion !== desired) continue;
        }
        return move;
      }
    }
    return null;
  }

  _generatePseudoMoves(color) {
    const moves = [];
    for (let square = 0; square < 128; square++) {
      if (square & 0x88) continue;
      const piece = this.board[square];
      if (!piece) continue;
      if (isWhitePiece(piece) !== (color === WHITE)) continue;
      const upper = piece.toUpperCase();
      if (upper === 'P') this._generatePawnMoves(square, color, moves);
      else if (upper === 'N') this._generateLeaperMoves(square, color, moves, KNIGHT_OFFSETS);
      else if (upper === 'B') this._generateSliderMoves(square, color, moves, BISHOP_OFFSETS);
      else if (upper === 'R') this._generateSliderMoves(square, color, moves, ROOK_OFFSETS);
      else if (upper === 'Q') {
        this._generateSliderMoves(square, color, moves, BISHOP_OFFSETS);
        this._generateSliderMoves(square, color, moves, ROOK_OFFSETS);
      } else if (upper === 'K') {
        this._generateLeaperMoves(square, color, moves, KING_OFFSETS);
        this._generateCastlingMoves(square, color, moves);
      }
    }
    return moves;
  }

  _generatePawnMoves(square, color, moves) {
    const forward = color === WHITE ? -16 : 16;
    const startRank = color === WHITE ? 6 : 1;
    const promotionRank = color === WHITE ? 0 : 7;
    const { y, x } = squareToCoords(square);
    const oneForward = square + forward;
    if (!(oneForward & 0x88) && !this.board[oneForward]) {
      if (squareToCoords(oneForward).y === promotionRank) {
        for (const promo of PROMOTION_PIECES) {
          moves.push({ from: square, to: oneForward, piece: this.board[square], promotion: promo, flags: FLAG_PROMOTION });
        }
      } else {
        moves.push({ from: square, to: oneForward, piece: this.board[square], promotion: null, flags: 0 });
        if (y === startRank) {
      const twoForward = oneForward + forward;
          if (!(twoForward & 0x88) && !this.board[twoForward]) {
          moves.push({ from: square, to: twoForward, piece: this.board[square], promotion: null, flags: FLAG_DOUBLE_PAWN });
          }
        }
      }
    }
    const captureOffsets = color === WHITE ? [-17, -15] : [17, 15];
    for (const offset of captureOffsets) {
      const target = square + offset;
      if (target & 0x88) continue;
      const targetPiece = this.board[target];
      const targetRank = squareToCoords(target).y;
      if (targetPiece && isWhitePiece(targetPiece) !== (color === WHITE)) {
        const baseFlags = FLAG_CAPTURE;
        if (targetRank === promotionRank) {
          for (const promo of PROMOTION_PIECES) {
            moves.push({ from: square, to: target, piece: this.board[square], promotion: promo, flags: baseFlags | FLAG_PROMOTION });
          }
        } else {
          moves.push({ from: square, to: target, piece: this.board[square], promotion: null, flags: baseFlags });
        }
      } else if (this.enPassant != null && target === this.enPassant) {
        moves.push({ from: square, to: target, piece: this.board[square], promotion: null, flags: FLAG_EN_PASSANT | FLAG_CAPTURE });
      }
    }
  }

  _generateLeaperMoves(square, color, moves, offsets) {
    for (const offset of offsets) {
      const target = square + offset;
      if (target & 0x88) continue;
      const targetPiece = this.board[target];
      if (targetPiece && isWhitePiece(targetPiece) === (color === WHITE)) continue;
      const flags = targetPiece ? FLAG_CAPTURE : 0;
      moves.push({ from: square, to: target, piece: this.board[square], promotion: null, flags });
    }
  }

  _generateSliderMoves(square, color, moves, directions) {
    for (const dir of directions) {
      let target = square + dir;
      while (!(target & 0x88)) {
        const targetPiece = this.board[target];
        if (!targetPiece) {
          moves.push({ from: square, to: target, piece: this.board[square], promotion: null, flags: 0 });
        } else {
          if (isWhitePiece(targetPiece) !== (color === WHITE)) {
            moves.push({ from: square, to: target, piece: this.board[square], promotion: null, flags: FLAG_CAPTURE });
          }
          break;
        }
        target += dir;
      }
    }
  }

  _generateCastlingMoves(square, color, moves) {
    const rights = this.castling;
    const enemy = opposite(color);
    if (color === WHITE) {
      if ((rights & CASTLING_BITS.K)) {
        if (!this.board[square + 1] && !this.board[square + 2]) {
          if (!this._isSquareAttacked(square, enemy) && !this._isSquareAttacked(square + 1, enemy) && !this._isSquareAttacked(square + 2, enemy)) {
            moves.push({ from: square, to: square + 2, piece: this.board[square], promotion: null, flags: FLAG_KING_CASTLE });
          }
        }
      }
      if ((rights & CASTLING_BITS.Q)) {
        if (!this.board[square - 1] && !this.board[square - 2] && !this.board[square - 3]) {
          if (!this._isSquareAttacked(square, enemy) && !this._isSquareAttacked(square - 1, enemy) && !this._isSquareAttacked(square - 2, enemy)) {
            moves.push({ from: square, to: square - 2, piece: this.board[square], promotion: null, flags: FLAG_QUEEN_CASTLE });
          }
        }
      }
    } else {
      if ((rights & CASTLING_BITS.k)) {
        if (!this.board[square + 1] && !this.board[square + 2]) {
          if (!this._isSquareAttacked(square, enemy) && !this._isSquareAttacked(square + 1, enemy) && !this._isSquareAttacked(square + 2, enemy)) {
            moves.push({ from: square, to: square + 2, piece: this.board[square], promotion: null, flags: FLAG_KING_CASTLE });
          }
        }
      }
      if ((rights & CASTLING_BITS.q)) {
        if (!this.board[square - 1] && !this.board[square - 2] && !this.board[square - 3]) {
          if (!this._isSquareAttacked(square, enemy) && !this._isSquareAttacked(square - 1, enemy) && !this._isSquareAttacked(square - 2, enemy)) {
            moves.push({ from: square, to: square - 2, piece: this.board[square], promotion: null, flags: FLAG_QUEEN_CASTLE });
          }
        }
      }
    }
  }

  _isSquareAttacked(square, byColor) {
    const pawnOffsets = byColor === WHITE ? [17, 15] : [-17, -15];
    for (const offset of pawnOffsets) {
      const target = square + offset;
      if (target & 0x88) continue;
      const piece = this.board[target];
      if (!piece) continue;
      if (piece.toLowerCase() === 'p' && isWhitePiece(piece) === (byColor === WHITE)) return true;
    }
    for (const offset of KNIGHT_OFFSETS) {
      const target = square + offset;
      if (target & 0x88) continue;
      const piece = this.board[target];
      if (!piece) continue;
      if (piece.toLowerCase() === 'n' && isWhitePiece(piece) === (byColor === WHITE)) return true;
    }
    for (const dir of BISHOP_OFFSETS) {
      let target = square + dir;
      while (!(target & 0x88)) {
        const piece = this.board[target];
        if (piece) {
          const lower = piece.toLowerCase();
          if ((lower === 'b' || lower === 'q') && isWhitePiece(piece) === (byColor === WHITE)) return true;
          break;
        }
        target += dir;
      }
    }
    for (const dir of ROOK_OFFSETS) {
      let target = square + dir;
      while (!(target & 0x88)) {
        const piece = this.board[target];
        if (piece) {
          const lower = piece.toLowerCase();
          if ((lower === 'r' || lower === 'q') && isWhitePiece(piece) === (byColor === WHITE)) return true;
          break;
        }
        target += dir;
      }
    }
    for (const offset of KING_OFFSETS) {
      const target = square + offset;
      if (target & 0x88) continue;
      const piece = this.board[target];
      if (!piece) continue;
      if (piece.toLowerCase() === 'k' && isWhitePiece(piece) === (byColor === WHITE)) return true;
    }
    return false;
  }

  _doMove(move) {
    const moverColor = isWhitePiece(move.piece) ? WHITE : BLACK;
    const enemyColor = opposite(moverColor);
    const state = {
      turnBefore: this.turn,
      castlingBefore: this.castling,
      enPassantBefore: this.enPassant,
      halfmoveBefore: this.halfmoveClock,
      fullmoveBefore: this.fullmoveNumber,
      zobristBefore: this.zobrist,
      prevKingSquare: this.kingSquare[moverColor],
      captured: null,
      capturedSquare: null,
    };
    if (this.turn !== moverColor) {
      throw new Error('Attempted to make move out of turn');
    }
    if (this.enPassant != null) {
      this.zobrist ^= this.zobristEnPassant[this.enPassant & 7];
    }
    this.enPassant = null;
    const from = move.from;
    const to = move.to;
    const piece = move.piece;
    this._xorPiece(from, piece);
    this.board[from] = null;
    if (move.flags & FLAG_EN_PASSANT) {
      const dir = moverColor === WHITE ? 16 : -16;
      const captureSquare = to + dir;
      const capturedPiece = this.board[captureSquare];
      if (!capturedPiece) throw new Error('Invalid en passant capture');
      this._xorPiece(captureSquare, capturedPiece);
      this.board[captureSquare] = null;
      state.captured = capturedPiece;
      state.capturedSquare = captureSquare;
    } else if (move.flags & FLAG_CAPTURE) {
      const capturedPiece = this.board[to];
      if (!capturedPiece) throw new Error('Expected capture piece');
      this._xorPiece(to, capturedPiece);
      state.captured = capturedPiece;
    }
    let placedPiece = piece;
    if (move.flags & FLAG_PROMOTION) {
      const promo = move.promotion ? move.promotion.toLowerCase() : 'q';
      placedPiece = moverColor === WHITE ? promo.toUpperCase() : promo;
    }
    this.board[to] = placedPiece;
    this._xorPiece(to, placedPiece);
    if (piece.toUpperCase() === 'K') {
      this.kingSquare[moverColor] = to;
      if (moverColor === WHITE) {
        this._removeCastlingRight(CASTLING_BITS.K);
        this._removeCastlingRight(CASTLING_BITS.Q);
      } else {
        this._removeCastlingRight(CASTLING_BITS.k);
        this._removeCastlingRight(CASTLING_BITS.q);
      }
      if (move.flags & FLAG_KING_CASTLE) {
        const rookFrom = to + 1;
        const rookTo = to - 1;
        const rookPiece = this.board[rookFrom];
        this._xorPiece(rookFrom, rookPiece);
        this.board[rookFrom] = null;
        this.board[rookTo] = rookPiece;
        this._xorPiece(rookTo, rookPiece);
      } else if (move.flags & FLAG_QUEEN_CASTLE) {
        const rookFrom = to - 2;
        const rookTo = to + 1;
        const rookPiece = this.board[rookFrom];
        this._xorPiece(rookFrom, rookPiece);
        this.board[rookFrom] = null;
        this.board[rookTo] = rookPiece;
        this._xorPiece(rookTo, rookPiece);
      }
    }
    if (piece.toUpperCase() === 'R') {
      this._updateRookCastlingRights(from, moverColor);
    }
    if (state.captured) {
      this._updateRookCastlingRights(to, enemyColor, true);
    }
    if (piece.toUpperCase() === 'P' || state.captured) {
      this.halfmoveClock = 0;
    } else {
      this.halfmoveClock += 1;
    }
    if (move.flags & FLAG_DOUBLE_PAWN) {
      const dir = moverColor === WHITE ? -16 : 16;
      this.enPassant = from + dir;
      this.zobrist ^= this.zobristEnPassant[this.enPassant & 7];
    }
    this.turn = enemyColor;
    this.zobrist ^= this.zobristTurn;
    if (moverColor === BLACK) {
      this.fullmoveNumber += 1;
    }
    return state;
  }

  _undoMove(move, state) {
    this.turn = state.turnBefore;
    this.castling = state.castlingBefore;
    this.enPassant = state.enPassantBefore;
    this.halfmoveClock = state.halfmoveBefore;
    this.fullmoveNumber = state.fullmoveBefore;
    this.zobrist = state.zobristBefore;
    const moverColor = isWhitePiece(move.piece) ? WHITE : BLACK;
    this.kingSquare[moverColor] = state.prevKingSquare;
    const from = move.from;
    const to = move.to;
    const piece = move.piece;
    if (move.flags & FLAG_KING_CASTLE) {
      const rookFrom = to + 1;
      const rookTo = to - 1;
      const rookPiece = this.board[rookTo];
      this.board[rookTo] = null;
      this.board[rookFrom] = rookPiece;
    } else if (move.flags & FLAG_QUEEN_CASTLE) {
      const rookFrom = to - 2;
      const rookTo = to + 1;
      const rookPiece = this.board[rookTo];
      this.board[rookTo] = null;
      this.board[rookFrom] = rookPiece;
    }
    if (move.flags & FLAG_PROMOTION) {
      this.board[from] = moverColor === WHITE ? 'P' : 'p';
    } else {
      this.board[from] = piece;
    }
    if (move.flags & FLAG_EN_PASSANT) {
      this.board[to] = null;
      this.board[state.capturedSquare] = state.captured;
    } else {
      this.board[to] = state.captured;
    }
  }

  _removeCastlingRight(bit) {
    if (this.castling & bit) {
      this.castling &= ~bit;
      this.zobrist ^= this.zobristCastling[bit];
    }
  }

  _updateRookCastlingRights(square, color, captured = false) {
    if (color === WHITE) {
      if (square === coordsToSquare(0, 7)) this._removeCastlingRight(CASTLING_BITS.Q);
      if (square === coordsToSquare(7, 7)) this._removeCastlingRight(CASTLING_BITS.K);
    } else {
      if (square === coordsToSquare(0, 0)) this._removeCastlingRight(CASTLING_BITS.q);
      if (square === coordsToSquare(7, 0)) this._removeCastlingRight(CASTLING_BITS.k);
    }
  }

  _xorPiece(square, piece) {
    if (!piece) return;
    const idx = pieceIndex(piece);
    if (idx < 0) return;
    this.zobrist ^= this.zobristPieces[idx][square];
  }

  _recalculateZobrist() {
    this.zobrist = 0n;
    for (let square = 0; square < 128; square++) {
      if (square & 0x88) continue;
      const piece = this.board[square];
      if (piece) {
        this._xorPiece(square, piece);
      }
    }
    for (const bit of Object.values(CASTLING_BITS)) {
      if (this.castling & bit) {
        this.zobrist ^= this.zobristCastling[bit];
      }
    }
    if (this.enPassant != null) {
      this.zobrist ^= this.zobristEnPassant[this.enPassant & 7];
    }
    if (this.turn === BLACK) this.zobrist ^= this.zobristTurn;
  }

  _recordCurrentPosition() {
    const key = this.zobrist.toString();
    this.positionCounts.set(key, (this.positionCounts.get(key) || 0) + 1);
    return key;
  }

  _decrementPosition(key) {
    if (!key) return;
    const value = this.positionCounts.get(key) || 0;
    if (value <= 1) this.positionCounts.delete(key);
    else this.positionCounts.set(key, value - 1);
  }

  _pgnDate() {
    const now = new Date();
    const year = String(now.getUTCFullYear()).padStart(4, '0');
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    return `${year}.${month}.${day}`;
  }

  _toSAN(move, legalMoves, check, mate, stalemate) {
    if (move.flags & FLAG_KING_CASTLE) return mate ? 'O-O#' : check ? 'O-O+' : 'O-O';
    if (move.flags & FLAG_QUEEN_CASTLE) return mate ? 'O-O-O#' : check ? 'O-O-O+' : 'O-O-O';
    const piece = move.piece.toUpperCase();
    const destination = squareToAlgebraic(move.to);
    const capture = !!(move.flags & FLAG_CAPTURE);
    let san = '';
    if (piece === 'P') {
      if (capture) {
        const { x } = squareToCoords(move.from);
        san += FILES[x];
        san += 'x';
      }
      san += destination;
      if (move.flags & FLAG_PROMOTION) {
        san += '=' + move.promotion.toUpperCase();
      }
    } else {
      san += piece;
      const disambiguation = this._sanDisambiguation(move, legalMoves);
      san += disambiguation;
      if (capture) san += 'x';
      san += destination;
    }
    if (mate) san += '#';
    else if (check) san += '+';
    // stalemate is conveyed via the result string; SAN omits explicit marker.
    return san;
  }

  _sanDisambiguation(move, legalMoves) {
    const candidates = legalMoves.filter(other => other !== move && other.to === move.to && other.piece === move.piece);
    if (!candidates.length) return '';
    const fromCoords = squareToCoords(move.from);
    const needFile = candidates.some(other => (squareToCoords(other.from).x === fromCoords.x));
    const needRank = candidates.some(other => (squareToCoords(other.from).y === fromCoords.y));
    if (needFile && needRank) {
      return FILES[fromCoords.x] + RANKS[fromCoords.y];
    }
    if (needFile) return RANKS[fromCoords.y];
    return FILES[fromCoords.x];
  }

  _initZobrist() {
    if (this.zobristPieces) return;
    const rng = new Random64();
    this.zobristPieces = Array.from({ length: 12 }, () => {
      const arr = new Array(128).fill(0n);
      for (let i = 0; i < 128; i++) {
        arr[i] = rng.next();
      }
      return arr;
    });
    this.zobristCastling = {};
    for (const bit of Object.values(CASTLING_BITS)) {
      this.zobristCastling[bit] = rng.next();
    }
    this.zobristEnPassant = new Array(8).fill(0n).map(() => rng.next());
    this.zobristTurn = rng.next();
  }

  evaluateMaterial() {
    let score = 0;
    for (let square = 0; square < 128; square++) {
      if (square & 0x88) continue;
      const piece = this.board[square];
      if (!piece) continue;
      const lower = piece.toLowerCase();
      const value = PIECE_VALUES[lower];
      if (value == null) continue;
      const { x, y } = squareToCoords(square);
      const index = y * 8 + x;
      const pst = PST[piece.toUpperCase()] || null;
      if (isWhitePiece(piece)) {
        score += value;
        if (pst) score += pst[index];
      } else {
        score -= value;
        if (pst) {
          const mirrorIndex = (7 - y) * 8 + x;
          score -= pst[mirrorIndex];
        }
      }
    }
    return score;
  }
}

export {
  ChessEngine,
  START_FEN,
  FLAG_CAPTURE,
  FLAG_DOUBLE_PAWN,
  FLAG_KING_CASTLE,
  FLAG_QUEEN_CASTLE,
  FLAG_EN_PASSANT,
  FLAG_PROMOTION,
  FILES,
  RANKS,
  squareToAlgebraic,
  algebraicToSquare,
  coordsToSquare,
  squareToCoords,
  opposite,
};
