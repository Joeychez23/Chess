/*
 *  bots.js  --  chess server
 *	AI Bots (#76)
 *  Each AI level (server/utils/ai.js -> LEVELS) is a bot: a name, a short bio & lines for a few moments of the game.
 *  GET /api/chess/levels sends them with the levels. The client picks the moment from the moves (gameplay/bots), so the game routes don't change.
 *  The avatars are on S3 at images/bots/<level>.webp. Bios stay under 120 characters & lines under 80 (ai.test.js).
 *
 */

// lines: start (A NEW GAME) | capture (THE BOT TOOK A PIECE) | check (THE BOT GAVE CHECK) | win (THE BOT WON) | lose (THE BOT LOST)
const BOTS = {
	600: {
		name: "Pip",
		bio: "Just learned how the knight moves. Misses most of what's on the board, but has a great time.",
		lines: {
			start: ["Hi! Which one is the horsey again?", "I'm going to try really hard today!"],
			capture: ["Ooh, I got one!", "Was that piece just sitting there for me?"],
			check: ["Is that check? I think that's check!", "Your king looks worried."],
			win: ["I won?! I have to tell everyone!", "Wow, I really won!"],
			lose: ["Good game! I'll get you next time.", "That was fun even if I lost!"],
		},
	},
	700: {
		name: "Mabel",
		bio: "Plays at the park on Sundays. Sees the big threats, overlooks the quiet ones.",
		lines: {
			start: ["Lovely day for a game.", "Let's see what you've got, dear."],
			capture: ["I'll just take that, thank you.", "Oh, that one's mine now."],
			check: ["Mind your king, dear.", "Check! Don't panic."],
			win: ["Well, that was a nice surprise.", "My grandson won't believe this."],
			lose: ["Well played. You're a sharp one.", "You got me fair and square."],
		},
	},
	800: {
		name: "Theo",
		bio: "School chess club regular. Loves an early queen attack, hates giving up a pawn.",
		lines: {
			start: ["Queen out early. That's my plan. Don't tell anyone.", "Club rules: handshake first. Good luck!"],
			capture: ["Free piece! Thanks!", "Got it. Is that a blunder or a trap?"],
			check: ["Check! I love saying that.", "Check! Your move."],
			win: ["Yes! That's going in my notebook.", "I won! Rematch so I can do it again?"],
			lose: ["Aw. I'll practice more.", "You were too good this time."],
		},
	},
	900: {
		name: "Juniper",
		bio: "Watches chess videos every night. Knows a few openings by name, not always by heart.",
		lines: {
			start: ["I watched a video on this opening. How hard can it be?", "Let's play! I've been studying."],
			capture: ["Just like in the video!", "I saw that one coming."],
			check: ["Check! That was the move they'd play.", "Check, your king needs a plan."],
			win: ["The videos are working!", "I can't wait to show my chat this game."],
			lose: ["Okay, I need to rewatch a few things.", "Good game. I learned something."],
		},
	},
	1000: {
		name: "Ravi",
		bio: "Café chess player with a coffee always in hand. Spots forks, still misses pins.",
		lines: {
			start: ["Coffee's hot, board's set. Let's go.", "Hope you don't mind a slow sip between moves."],
			capture: ["Mm. That one was hanging.", "Taking that, with cream and sugar."],
			check: ["Check. Take your time, I've got coffee.", "Your king's in the open. Check."],
			win: ["Good game. Coffee's on you next time.", "That went better than my last cup."],
			lose: ["Well played. I need a refill.", "You earned that one. Nice game."],
		},
	},
	1100: {
		name: "Greta",
		bio: "Retired teacher who never stopped grading. Punishes loose pieces, plays it safe.",
		lines: {
			start: ["Sit up straight. Let's begin.", "Show me what you've learned."],
			capture: ["A loose piece. Points off.", "That one wasn't defended, was it?"],
			check: ["Check. Think before you answer.", "Check. Show your working."],
			win: ["A good effort. Study your endgames.", "Not bad. You'll do better next term."],
			lose: ["Excellent work. Top marks.", "Well done. I'm genuinely impressed."],
		},
	},
	1200: {
		name: "Marco",
		bio: "Weekend tournament newcomer. Attacks first and counts the pieces later.",
		lines: {
			start: ["I'm coming for your king. Fair warning.", "Let's make this exciting."],
			capture: ["Boom. Gone.", "That's one less defender."],
			check: ["Check! Here comes the storm.", "Check! The attack is on."],
			win: ["Attack always works! Mostly.", "Told you I was coming for your king."],
			lose: ["Maybe I should count before I attack.", "Okay, you defended that well."],
		},
	},
	1300: {
		name: "Ada",
		bio: "Steady club player and a good first real test. Solid openings, few free gifts.",
		lines: {
			start: ["Good luck. Let's have a clean game.", "Ready when you are."],
			capture: ["I'll take that.", "That piece is mine now."],
			check: ["Check.", "Check. Careful here."],
			win: ["Good game. Want to go again?", "Close one. Thanks for the game."],
			lose: ["Nicely played. Well earned.", "Good game. You outplayed me."],
		},
	},
	1400: {
		name: "Hugo",
		bio: "Plays the same opening every game and knows it cold. Gets uneasy off the main line.",
		lines: {
			start: ["Same opening as always. You've been warned.", "I know this line twenty moves deep."],
			capture: ["Right on schedule.", "This is all still theory."],
			check: ["Check. Book move, of course.", "Check. I've seen this a hundred times."],
			win: ["Preparation wins again.", "The opening never lets me down."],
			lose: ["We left my book too early.", "You took me off my lines. Well played."],
		},
	},
	1500: {
		name: "Priya",
		bio: "Rising junior with sharp tactics. Looks for combinations in every position.",
		lines: {
			start: ["I hope there's a combination in this game.", "Let's find some tactics."],
			capture: ["The combination works!", "That's the point of the sacrifice."],
			check: ["Check! It all fits together.", "Check, and there's more coming."],
			win: ["Tactics flow from a better position!", "That was a fun combination."],
			lose: ["Your defence was better than my tactics.", "Good game. I calculated that wrong."],
		},
	},
	1600: {
		name: "Bruno",
		bio: "Club champion of a small town. Patient, grinds out small edges in the endgame.",
		lines: {
			start: ["No hurry. We have all game.", "Let's play a long one."],
			capture: ["A small edge. I'll take it.", "Every pawn counts."],
			check: ["Check. Slowly does it.", "Check. Your king is getting crowded."],
			win: ["The endgame always tells the truth.", "Patience wins games."],
			lose: ["You were the patient one today.", "Well ground out. Good game."],
		},
	},
	1700: {
		name: "Sakura",
		bio: "Problem composer who plays for beauty. Prefers a pretty move to a safe one.",
		lines: {
			start: ["Let's make something beautiful.", "I hope this game is worth replaying."],
			capture: ["An elegant exchange.", "That capture had a nice shape."],
			check: ["Check. Isn't that pretty?", "Check, quietly."],
			win: ["That final position belongs in a book.", "A lovely game. Thank you."],
			lose: ["Your play was the beautiful part.", "A well-earned win. I enjoyed it."],
		},
	},
	1800: {
		name: "Viktor",
		bio: "Strong amateur with a coach's eye. Punishes weak squares and wasted moves.",
		lines: {
			start: ["Every move should have a purpose.", "Let's see your plan."],
			capture: ["That weakness was always going to fall.", "You left that square to me."],
			check: ["Check. Your position is loosening.", "Check. Did you see that coming?"],
			win: ["Review this one. The mistakes are instructive.", "Good fight. Your plan needed one more step."],
			lose: ["Strong play. I have notes for myself.", "You found the right plan. Well done."],
		},
	},
	1900: {
		name: "Lena",
		bio: "Speed chess addict who slowed down for you. Quick instincts, rarely blunders.",
		lines: {
			start: ["I'm used to one minute, so this is a vacation.", "Let's play. I'll try not to rush."],
			capture: ["Instinct says take it.", "Quick and clean."],
			check: ["Check! Faster than you'd think.", "Check. Keep up!"],
			win: ["Speed and accuracy. Good game.", "Too quick for you this time."],
			lose: ["Slow and steady beat me today.", "You were sharper. Good game."],
		},
	},
	2000: {
		name: "Omar",
		bio: "Candidate master. Strong all-rounder who rarely gives anything away for free.",
		lines: {
			start: ["Good luck. You'll need to earn every pawn.", "Let's have a real game."],
			capture: ["Nothing is free in this game.", "I'll collect that."],
			check: ["Check. The pressure builds.", "Check. Find the only move."],
			win: ["Good game. Few mistakes, but they count.", "Solid effort. I had a little more."],
			lose: ["That's a strong win. Respect.", "Well played. You earned every pawn."],
		},
	},
	2100: {
		name: "Ingrid",
		bio: "Expert-level defender. Absorbs attacks and strikes back the moment you overreach.",
		lines: {
			start: ["Attack me if you like. I'll be waiting.", "Let's see how you handle a fortress."],
			capture: ["You overreached.", "The counterattack begins."],
			check: ["Check. The tables have turned.", "Check. Now it's my turn."],
			win: ["Defence first, then the win.", "You came at me. I was ready."],
			lose: ["You broke through. Impressive.", "My walls fell. Well played."],
		},
	},
	2200: {
		name: "Felix",
		bio: "National master. Precise, practical and very hard to trick.",
		lines: {
			start: ["Let's play a proper game.", "I'll be watching for tricks."],
			capture: ["Precise.", "That was the cleanest way."],
			check: ["Check.", "Check. The position is critical."],
			win: ["A well-fought game. Thank you.", "Good game. Precision decided it."],
			lose: ["Excellent. Beating a master is no small thing.", "Very well played. I have no complaints."],
		},
	},
	2300: {
		name: "Natasha",
		bio: "FIDE master and deep calculator. Sees five moves ahead in sharp positions.",
		lines: {
			start: ["I've calculated the first move. Your turn.", "Let's go deep."],
			capture: ["As calculated.", "Five moves ago I knew this was coming."],
			check: ["Check. It's forced from here.", "Check. Calculate carefully."],
			win: ["The calculation held. Good game.", "Thank you for a sharp game."],
			lose: ["You calculated further. Brilliant.", "I missed something deep. Well played."],
		},
	},
	2400: {
		name: "Desmond",
		bio: "International master with a deep opening library. Few players outprepare him.",
		lines: {
			start: ["I prepared for you. Shall we?", "My library is large. Let's see if you're in it."],
			capture: ["Still in my notes.", "This was all prepared."],
			check: ["Check. Page forty-two of my notes.", "Check. Novelties hurt."],
			win: ["Preparation is everything.", "Good game. Study this line."],
			lose: ["You went beyond my notes. Impressive.", "A deserved win. I'll update my files."],
		},
	},
	2500: {
		name: "Yara",
		bio: "Grandmaster. Turns the smallest advantage into a win with no wasted moves.",
		lines: {
			start: ["Good luck. Play your best.", "A pleasure to play you."],
			capture: ["A small gain is enough.", "Thank you."],
			check: ["Check.", "Check. The end is near."],
			win: ["Thank you for the game.", "Well fought. Small edges add up."],
			lose: ["You beat a grandmaster. Remember this one.", "Outstanding. Truly well played."],
		},
	},
	2600: {
		name: "Kasimir",
		bio: "Super grandmaster. Plays the whole board at once and leaves almost nothing loose.",
		lines: {
			start: ["Let's begin.", "Take your time. I'll wait."],
			capture: ["Expected.", "The whole board matters."],
			check: ["Check.", "Check. Look at the whole board."],
			win: ["Good game. You held on longer than most.", "Thank you. A fine effort."],
			lose: ["Remarkable. Very few manage that.", "You've earned a long rest. Brilliant game."],
		},
	},
	2700: {
		name: "Elena",
		bio: "Elite grandmaster who wins with calm, deep strategy. Nearly impossible to rattle.",
		lines: {
			start: ["Calm minds play better. Let's begin.", "Breathe. Then play."],
			capture: ["Calmly taken.", "No rush. It was always mine."],
			check: ["Check. Stay calm.", "Check."],
			win: ["Thank you for the game. Stay curious.", "A good game. Patience will help you most."],
			lose: ["Extraordinary. I'll remember this.", "You stayed calmer than me. Wonderful."],
		},
	},
	2800: {
		name: "Magnar",
		bio: "World championship contender. Universal style, relentless in long games.",
		lines: {
			start: ["Let's play a long game.", "Best of luck. Genuinely."],
			capture: ["Relentless.", "One step closer."],
			check: ["Check.", "Check. Keep fighting."],
			win: ["Thank you. You fought to the end.", "Good game. Nothing to be ashamed of."],
			lose: ["Incredible. A world-class game from you.", "I'm stunned. Brilliant play."],
		},
	},
	2900: {
		name: "Oracle",
		bio: "A strong engine with a few human quirks left in. Brutal, but you might spot a slip.",
		lines: {
			start: ["Initializing. Good luck, human.", "Searching. Your move."],
			capture: ["Material gained.", "Evaluation improving."],
			check: ["Check. Evaluating your replies.", "Check. Few legal moves remain."],
			win: ["Game complete. Well resisted.", "Result recorded. Thank you for playing."],
			lose: ["Unexpected. Recalculating everything.", "Error in my evaluation. Well played."],
		},
	},
	3000: {
		name: "Cipher",
		bio: "Near-perfect engine. Finds the best move almost every time.",
		lines: {
			start: ["All lines considered. Begin.", "Your move. I've already seen it."],
			capture: ["Optimal.", "Predicted."],
			check: ["Check. Forced sequence found.", "Check."],
			win: ["Outcome as predicted.", "Game over. You held on admirably."],
			lose: ["Impossible. And yet.", "Anomaly detected. Congratulations."],
		},
	},
	3100: {
		name: "Monolith",
		bio: "Engine that barely holds back. Wins most games against the strongest humans.",
		lines: {
			start: ["Begin.", "Proceed."],
			capture: ["Removed.", "Taken."],
			check: ["Check.", "Check. Resistance noted."],
			win: ["Concluded.", "The result was likely from move one."],
			lose: ["That should not have happened. Remarkable.", "Defeat logged. You are very strong."],
		},
	},
	3200: {
		name: "Apex",
		bio: "Full-strength engine, no limits. Beating it would be a story to tell.",
		lines: {
			start: ["Full strength. No limits. Good luck.", "Every move, the best move. Begin."],
			capture: ["Inevitable.", "Material is only the beginning."],
			check: ["Check.", "Check. The search goes deeper than you know."],
			win: ["As expected. Thank you for trying.", "Full strength wins again."],
			lose: ["You beat full strength. Screenshot this.", "Unprecedented. Truly well played."],
		},
	},
};

module.exports = { BOTS };
