# Accessibility

Chess should be playable by as many people as possible, including people who use a screen reader, a keyboard, a switch or a magnifier. This page says what works today, what doesn't yet, and how to report a problem.

**Goal:** the site's pages meet [WCAG 2.2](https://www.w3.org/TR/WCAG22/) level AA. We're not there yet, mainly because of the game board (see [Known limitations](#known-limitations)).

**Last reviewed:** 7 November 2026

## What works today

**Pages and menus** (Home, the guest homepage and the game menu)

- The page language is set (`lang="en"`), so screen readers use the right voice.
- Every form field and dropdown has a label: the AI level, your color and your friend's username or email.
- The picture of the board on the homepage has a text description, and each board preview ("The board of your current AI game") is labelled.
- Messages about invites and errors are announced by screen readers as they appear. On the play page that includes a refused move, a lost connection and the server or AI not answering.
- The menu button is labelled "Menu", says whether the menu is open or closed, and its three lines turn into an X while the menu is open. The button, clicking or tapping away and Escape close every menu; a game's menu only stays open while a new board loads. In a game, Resume closes it too for keyboard players.
- Menu items are in named groups in the same order on every page: current context, page actions, navigation, account. When a game ends, Restart or Rematch moves to the top in the page itself, so the Tab key and screen readers follow the order on screen.
- With a keyboard, opening a menu moves to its first item and closing it goes back to the menu button. Escape, Delete and Backspace close it. While it's open, Tab, Up, Down, Left, Right, Home and End stay in its items. Left and Right move between columns on short screens, and otherwise up and down the list. In a game, a TV remote's list is the same as the keyboard's, without Download PGN and Type a Move.
- While a menu is closed, Tab goes around the page's elements and doesn't leave for the browser (use F6 or Ctrl/Cmd+L to reach the address bar). Left and Right move between the page's elements; in a game they move in that direction on screen between the Moves panel, the Type a Move box when it's open and the menu button. In a text box they leave once the cursor is at that end.
- With a keyboard, opening the Moves panel moves to the newest move. Up, Down, Home and End move between the moves, Up or Down past either end goes back to the panel's button, and Escape closes the panel and goes back to its button.
- With a keyboard, Escape closes the Type a Move box and goes back to where you were. Home and End jump through the list once a move in it is highlighted.
- When a game ends, the result is announced by screen readers and focus moves to Restart or Rematch. "Game not found" is read out when the page opens.
- Buttons and links show a gold outline when you move to them with the keyboard.
- You can zoom the page; zoom isn't blocked on phones.

**Playing**

- Move pieces by dragging, or by clicking a piece and then a square. Both work with a mouse or touch.
- Legal moves are highlighted when you pick up a piece, and a king in check is highlighted.
- The board fits phones in portrait and landscape, and tablets and desktops.
- Friend games are saved after every move, so there's no time limit on making one.
- The site follows your device's "reduce motion" setting: pieces appear on their new squares without sliding or hopping, Restart and Rematch set the pieces straight away, and pages change without fading.
- The move sound can be turned off with the Sound button in the game menu. The choice is saved in your browser, for guests too.

**The 3D board**

- View: 3D in the game menu switches to the 3D board and View: 2D switches back. It's a menu button like the others, so Tab and the arrow keys reach it, and the menu stays open after you press it. Your choice is saved in your browser.
- Everything outside the board works the same on 3D: Type a Move (press `/`), the Moves panel, the menu and the messages screen readers read out.
- Screen readers hear the 3D board as one image named "Chess board, 3D. To play with the keyboard, press / and type a move." The 2D layer over it, which only shows the taken pieces, is hidden from them so there's only one board.
- Flip Board and Reset View move the camera without a mouse. Turning, tilting and zooming the camera by hand need a mouse or touch.
- In TV remote mode the square the arrow keys are on has a gold ring around it on the 3D board.
- With "reduce motion" on, pieces jump to their squares on 3D too, and Flip Board turns the camera at once.
- A device that can't show 3D (no WebGL) stays on the 2D board and says why.

## Known limitations

- **The game board can't be read by a screen reader**, on 2D or 3D. It's drawn as a picture (an HTML canvas) with no text version, so a screen reader can't tell you where the pieces are, which moves are legal or what your opponent played.
- **Keyboard play is by typing only.** Press `/` (or choose Type a Move in the menu), type a move like `e4`, `Nf3` or `e8=Q` and press Enter, or choose from the legal moves it lists with the arrow keys and Enter. Screen readers hear how many there are. Picking up pieces still needs a mouse or touch. Arrow keys and Enter work only in a TV remote mode that's switched off on the live site.
- **Moves are shown only by animation and sound.** Nothing announces your opponent's move in words, and there's no move list to look back at.
- **There are no board coordinates** (a–h, 1–8).
- **A rematch request lasts 5 minutes** and that can't be extended. Press Rematch again to restart it.
- **Color contrast** of the move, capture and check highlights hasn't been measured yet.

## Planned improvements

These are tracked as issues:

- [Move list panel](https://github.com/Joeychez23/Chess/issues/66): a readable list of every move in the game
- [Board coordinates (a–h, 1–8)](https://github.com/Joeychez23/Chess/issues/62)
- [Last-move highlight](https://github.com/Joeychez23/Chess/issues/59): marks the squares of the last move

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
