import { setBoardTheme } from "../board.js";
import { setPieceStyle, getPieceStyle } from "../pieces.js";

const BOARD_KEY = 'chess3d.boardTheme';
const PIECE_KEY = 'chess3d.pieceStyle';

export function mountThemePicker(container){
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '8px';

  const boardLabel = document.createElement('label');
  boardLabel.textContent = 'Board';
  const boardSelect = document.createElement('select');
  ['wood','marble','neon'].forEach((t)=>{
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t[0].toUpperCase() + t.slice(1);
    boardSelect.appendChild(opt);
  });
  boardSelect.onchange = ()=>{
    localStorage.setItem(BOARD_KEY, boardSelect.value);
    setBoardTheme(boardSelect.value);
  };
  boardLabel.appendChild(boardSelect);
  wrap.appendChild(boardLabel);

  const pieceLabel = document.createElement('label');
  pieceLabel.textContent = 'Pieces';
  const pieceSelect = document.createElement('select');
  ['classic','metal','glass'].forEach((t)=>{
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t[0].toUpperCase() + t.slice(1);
    pieceSelect.appendChild(opt);
  });
  pieceSelect.onchange = ()=>{
    localStorage.setItem(PIECE_KEY, pieceSelect.value);
    setPieceStyle(pieceSelect.value);
  };
  pieceLabel.appendChild(pieceSelect);
  wrap.appendChild(pieceLabel);

  container.appendChild(wrap);

  const savedBoard = localStorage.getItem(BOARD_KEY) || 'wood';
  const savedPieces = localStorage.getItem(PIECE_KEY) || getPieceStyle();
  boardSelect.value = savedBoard;
  pieceSelect.value = savedPieces;
  setBoardTheme(savedBoard);
  setPieceStyle(savedPieces);
}
