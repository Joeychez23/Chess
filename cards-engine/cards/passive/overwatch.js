/*
 *  overwatch.js  --  chess cards engine
 *	Passive: an enemy piece lands on a square your bishop attacks; the bishop captures it at once, out of turn. Debuff: the bishop is Frozen for 2 turns.
 *
 */

const { sqIndex, sqName } = require("../../board.js");
const { attacksSquare } = require("../../movegen.js");
const { hooksFor } = require("../../rules.js");

module.exports = {
	key: "overwatch", kind: "passive", name: "Overwatch", skulls: 2, rarity: "legendary",
	text: "An enemy piece lands on a square your bishop attacks → the bishop captures it immediately, out of turn. Debuff: the bishop is Frozen for 2 turns.",
	on: {
		/**
		 * @description An opponent's move ends with its (non-king) piece on a square one of owner's bishops attacks with the card rules applied (attacksSquare: not Frozen or Shaken, the target not Warded or shielded by a capture rule): ctx.capture takes it, the bishop stays on its square (a ranged shot) and is Frozen for 2 of owner's turns. The first such bishop in board order shoots. A castle lands two pieces: the rook is watched too (the king never is). A shot that opens the mover's own king is allowed (taking that king wins); the turn announces that check (startTurn), and inside the mover's two-move turn the next move must answer it.
		 */
		move(ctx, owner, ev) {
			if (ev.player === owner) return false;
			const s = ctx.state, b = s.board, hooks = hooksFor(s);
			const lands = ev.castle ? [ev.to, (ev.to[0] === "g" ? "f" : "d") + ev.to[1]] : [ev.to]; // THE CASTLING ROOK LANDS BESIDE THE KING
			for (const name of lands) {
				const to = sqIndex(name), q = b.sq[to];
				if (!q || q.c !== ev.player || q.t === "k") continue; // CARDS NEVER TAKE A KING
				const i = b.sq.findIndex((p, j) => p && p.c === owner && p.t === "b" && attacksSquare(s, j, p, to, hooks));
				if (i < 0) continue;
				const bishop = b.sq[i].id;
				ctx.capture(owner, q.id, sqName(i)); // THE CAPTURE EVENT'S from: WHERE THE SHOT CAME FROM, SO THE CLIENT PLAYS IT (ALSO UNDER THE OWNER'S FOG, USER RULING 2026-11-23)
				ctx.giveStatus(bishop, "frozen", 2, owner);
				return true;
			}
			return false;
		},
	},
};
