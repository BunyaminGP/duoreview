function createBoardSender(send) {
  let previous;
  return (board, language, force = false) => {
    const signature = JSON.stringify([language, board]);
    if (!force && signature === previous) return false;
    send(board);
    previous = signature;
    return true;
  };
}

module.exports = { createBoardSender };
