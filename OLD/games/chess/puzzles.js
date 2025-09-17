// Basic chess puzzles: each with a FEN board string and a list of moves in coordinate notation.
// Moves are expressed like "e2e4" meaning from e2 to e4. Solutions alternate between
// the player's move and any forced reply.
window.puzzles = [
  {
    // Mate in one: Qf7-f8#
    fen: "7k/5Q2/6K1/8/8/8/8/8",
    solution: ["f7f8"],
  },
  {
    // Mate in one: Qh5-h7#
    fen: "7k/8/6K1/7Q/8/8/8/8",
    solution: ["h5h7"],
  },
  {
    // Mate in one: Qf2-f8#
    fen: "7k/8/6K1/8/8/8/5Q2/8",
    solution: ["f2f8"],
  },
];
