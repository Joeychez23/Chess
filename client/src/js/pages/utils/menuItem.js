/*
 *  menuItem.js  --  chess frontend
 *	Menu Item States
 *	Every menu's items show what they can do the same way. Unavailable: aria-disabled, it can't act right now (.menuButton[aria-disabled] in nav.css).
 *	Busy: the .loading fill (nav.css), it's waiting on the server or a page load. Hidden: its <li> is hidden, the item isn't offered here
 *
 */

const BUSY_FILL = 0.6; // HOW FULL WHILE THE SERVER ANSWERS, THERE'S NO PROGRESS TO SHOW
const FILL_DELAY = 50; // FROM EMPTY (THE FILL IS DRAWN FIRST, ms)
const LEAVE_TIME = 250; // THE FILL REACHES THE END BEFORE THE PAGE CHANGES (200MS IN nav.css)

/**
 * @description Turns an item's unavailable look on or off, it stays focusable so the words can still be read
 * @param  {[object]} item [the button or link]
 * @param  {[boolean]} unavailable [true: it can't act right now]
 */
export function setUnavailable(item, unavailable) {
	if (unavailable) { item.setAttribute("aria-disabled", "true"); }
	else { item.removeAttribute("aria-disabled"); }
}

/**
 * @description Starts or raises the fill, it only fills up
 * @param  {[object]} item [the button or link]
 * @param  {[number]} load [how full, 0 - 1]
 */
export function setFill(item, load = BUSY_FILL) {
	if (isBusy(item)) { return fillTo(item, load); }
	item.classList.add("loading");
	setTimeout(function () { fillTo(item, load); }, FILL_DELAY);
}

function fillTo(item, load) {
	if (!isBusy(item)) { return; } // IT FINISHED FIRST
	if (load > (Number(item.style.getPropertyValue("--load")) || 0)) { item.style.setProperty("--load", load); }
}

/**
 * @description Takes the fill away, the server answered
 * @param  {[object]} item [the button or link]
 */
export function stopFill(item) {
	item.classList.remove("loading");
	item.style.removeProperty("--load");
}

/**
 * @description Is it waiting? .loading only stops clicks, a keyboard or remote-only mode can still press it
 * @param  {[object]} item [the button or link]
 * @return {[boolean]} busy
 */
export function isBusy(item) {
	return item.classList.contains("loading");
}

/**
 * @description Says Loading, fills up & goes to the page. Back can show this page as it was left (the browser keeps it), so the item is put back
 * @param  {[object]} item [the button or link]
 * @param  {[string]} href [where it goes]
 */
export function fillThenGo(item, href) {
	const text = item.innerText;
	item.innerText = "Loading";
	setFill(item, 1);
	window.addEventListener("pageshow", function () {
		item.innerText = text;
		stopFill(item);
	}, { once: true });
	setTimeout(function () { window.location.href = href; }, LEAVE_TIME);
}
