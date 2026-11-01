# Accessibility

Chess should be playable by as many people as possible, including people who use a screen reader, a keyboard, a switch or a magnifier. This page says what works today, what doesn't yet, and how to report a problem.

**Goal:** the site's pages meet [WCAG 2.2](https://www.w3.org/TR/WCAG22/) level AA. We're not there yet, mainly because of the game board (see [Known limitations](#known-limitations)).

**Last reviewed:** 25 October 2026

## What works today

**Pages and menus** (Home, the guest homepage and the game menu)

- The page language is set (`lang="en"`), so screen readers use the right voice.
- Every form field and dropdown has a label: the AI level, your color and your friend's email.
- The picture of the board on the homepage has a text description, and each board preview ("The board of your current AI game") is labelled.
- Messages about invites and errors are announced by screen readers as they appear.
- The menu button is labelled "Menu", says whether the menu is open or closed, and Escape closes the menu.
- Buttons and links show a gold outline when you move to them with the keyboard.
- You can zoom the page; zoom isn't blocked on phones.

**Playing**

- Move pieces by dragging, or by clicking a piece and then a square. Both work with a mouse or touch.
- Legal moves are highlighted when you pick up a piece, and a king in check is highlighted.
- The board fits phones in portrait and landscape, and tablets and desktops.
- Friend games are saved after every move, so there's no time limit on making one.
- The site follows your device's "reduce motion" setting: pieces appear on their new squares without sliding or hopping, Restart and Rematch set the pieces straight away, and pages change without fading.

## Known limitations

- **The game board can't be read by a screen reader.** It's drawn as a picture (an HTML canvas) with no text version, so a screen reader can't tell you where the pieces are, which moves are legal or what your opponent played.
- **You can't play with only a keyboard.** The menus work with a keyboard, but moving pieces needs a mouse or touch. Arrow keys and Enter work only in a TV remote mode that's switched off on the live site.
- **Moves are shown only by animation and sound.** Nothing announces your opponent's move in words, and there's no move list to look back at.
- **The move sound can't be turned off** without muting your device.
- **There are no board coordinates** (a–h, 1–8).
- **The result doesn't always say why the game ended.** The menu shows "White Wins!", "Black Wins!" or "Draw", but only forfeits are named, not checkmate, stalemate and so on.
- **Rematch has a 1-minute limit** that can't be extended.
- **Color contrast** of the move, capture and check highlights hasn't been measured yet.

## Planned improvements

These are tracked as issues:

- [Typing moves ("e4")](https://github.com/Joeychez23/Chess/issues/65): play by typing a move, which also gives keyboard and screen reader users a way to move
- [Move list panel](https://github.com/Joeychez23/Chess/issues/66): a readable list of every move in the game
- [Board coordinates (a–h, 1–8)](https://github.com/Joeychez23/Chess/issues/62)
- [Last-move highlight](https://github.com/Joeychez23/Chess/issues/59): marks the squares of the last move
- [Sound on/off](https://github.com/Joeychez23/Chess/issues/58)

Not tracked yet, but needed:

- Announcing each move to screen readers ("Black: knight to f6")
- Moving pieces with the keyboard on the live site

## Report a problem

If something on the site is hard or impossible for you to use, please tell us.

1. Open a [new issue](https://github.com/Joeychez23/Chess/issues/new/choose) with the **Bug report** template.
2. Add the `accessibility` label if you can.
3. Include:
   - what you were trying to do, and what got in the way
   - the page (Home, the guest page or a game)
   - your device and browser
   - any assistive technology you use (screen reader, switch control, magnifier, voice control) and its version

Feedback is welcome on anything that works badly for you, not only the items listed here.
