/*
 *  tremor.js  --  chess cards engine
 *	Curse: becomes your next move-card draw; when drawn, a random pawn of yours is Frozen. Fires once, then discarded.
 *
 */

const other = (c) => (c === "w" ? "b" : "w");

module.exports = {
	key: "tremor", kind: "curse", name: "Tremor", rarity: "common",
	text: "Becomes your next move-card draw, face down; when drawn, a random pawn of yours is Frozen. Fires once, then discarded.",
	on: {
		/**
		 * @description Its holder's next move-card draw (any: a refill, a Marked capture's draw): a random pawn of theirs (state.rng) is Frozen for the default 3 turns (given by the opponent), none when they have no pawn; a newly Frozen pawn's status, or one given over a veiled Frozen, is veiled (hidden from the opponent, with its events, while the pawn is under its owner's Fog of War); the drawn card stays; the curse leaves through ctx.clearCurse. Fires.
		 */
		draw(ctx, owner, ev, src) {
			if (ev.player !== owner || !ev.card || ev.card.key !== "move") return false;
			const pawns = ctx.state.board.sq.filter((q) => q && q.c === owner && q.t === "p").map((q) => q.id);
			const id = pawns.length && ctx.rng.pick(pawns), old = id && (ctx.state.statuses[id] || []).find((e) => e.s === "frozen"), n = ctx.events.length;
			if (id && ctx.giveStatus(id, "frozen", 3, other(owner)) && (old ? old.veiled : ctx.events.length > n)) { // A NEW FROZEN, OR ONE OVER A VEILED FROZEN (T25-M1): ONE ALREADY SHOWN STAYS SHOWN
				for (const x of [(ctx.state.statuses[id] || []).find((e) => e.s === "frozen"), ctx.events.find((e, i) => i >= n && e.type === "status" && e.piece === id)]) if (x) x.veiled = true; // HIDDEN FROM THE OPPONENT WHILE THE PAWN IS FOGGED (view.js): IT WOULD NAME A PAWN (if: A TRIGGER MAY HAVE ENDED IT ALREADY)
			}
			ctx.clearCurse(owner, src.card);
			return true;
		},
	},
};
