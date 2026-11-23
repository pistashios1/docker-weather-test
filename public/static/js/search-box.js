// Accessible location search: an ARIA 1.2 combobox with a listbox popup.
//
// Typing searches after a short pause. A place is picked only by a deliberate
// action: clicking or tapping an option, Enter, or the Search button. Pressing
// or tapping anywhere else closes the list without picking anything.
//
// Keyboard: ArrowDown/ArrowUp move through options, Enter picks the highlighted
// option (or the best match), Escape closes the list (and clears the field if
// it is already closed). Focus stays in the field; the highlighted option is
// exposed through aria-activedescendant.

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;
const CACHE_SIZE = 5;

// Lower-case, accent-free form of one character, so "sao" highlights "São".
const foldChar = (char) => char.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();

// The part of `name` that matches `query`, ignoring case and accents.
export const findMatch = (name, query) => {
  const wanted = [...query.trim()].map(foldChar).join("");
  if (!wanted) return null;
  let folded = "";
  const starts = []; // folded index -> original index
  [...name].forEach((char, index) => {
    for (const part of foldChar(char)) {
      starts.push(index);
      folded += part;
    }
  });
  const at = folded.indexOf(wanted);
  if (at < 0) return null;
  const chars = [...name];
  const start = starts[at];
  const end = starts[at + wanted.length - 1] + 1;
  return [chars.slice(0, start).join(""), chars.slice(start, end).join(""), chars.slice(end).join("")];
};

export function createSearchBox({
  input,
  popup,
  message,
  list,
  search,
  onSelect,
  announce,
  recentPlaces = () => [],
  describeDistance = () => "",
  cacheContext = () => "",
}) {
  let items = [];        // places currently listed
  let itemsQuery = null; // the query they answer; null for recent places
  let activeIndex = -1;
  let debounceTimer = null;
  let controller = null;
  let pickWhenReady = false; // Enter or Search was pressed before results arrived
  let lastPointer = "mouse";
  let cache = [];

  const isOpen = () => !popup.hidden;
  const currentQuery = () => input.value.trim();
  const cacheKey = (query) => `${query.toLocaleLowerCase()}|${cacheContext()}`;

  const setActive = (index) => {
    activeIndex = index;
    list.querySelectorAll('[role="option"]').forEach((option, position) => {
      option.setAttribute("aria-selected", String(position === index));
    });
    if (index >= 0) {
      input.setAttribute("aria-activedescendant", `search-option-${index}`);
      document.getElementById(`search-option-${index}`)?.scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  };

  const open = () => {
    popup.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };

  const cancelPending = () => {
    clearTimeout(debounceTimer);
    if (controller) controller.abort();
    controller = null;
    pickWhenReady = false;
  };

  const close = () => {
    cancelPending();
    popup.hidden = true;
    input.setAttribute("aria-expanded", "false");
    setActive(-1);
  };

  const showMessage = (text, { keepList = false } = {}) => {
    if (!keepList) {
      items = [];
      itemsQuery = null;
      list.replaceChildren();
      list.hidden = true;
    }
    message.textContent = text;
    message.hidden = !text;
    open();
  };

  const optionFor = (place, index, query) => {
    const option = document.createElement("div");
    option.id = `search-option-${index}`;
    option.className = "search-option";
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    option.dataset.index = String(index);

    const name = document.createElement("span");
    name.className = "search-option-name";
    const match = query ? findMatch(place.name, query) : null;
    if (match) {
      const mark = document.createElement("mark");
      mark.textContent = match[1];
      name.append(match[0], mark, match[2]);
    } else {
      name.textContent = place.name;
    }

    const context = document.createElement("span");
    context.className = "search-option-context";
    context.textContent = place.context || "Location";

    option.append(name, context);
    const distance = describeDistance(place.distance_km);
    if (distance) {
      const away = document.createElement("span");
      away.className = "search-option-distance";
      away.textContent = distance;
      option.append(away);
    }
    return option;
  };

  const renderList = (places, query, heading) => {
    items = places;
    itemsQuery = query;
    list.replaceChildren(...places.map((place, index) => optionFor(place, index, query)));
    list.hidden = false;
    message.textContent = heading;
    message.hidden = !heading;
    open();
    setActive(-1);
  };

  const choose = (index) => {
    const place = items[index];
    if (!place) return;
    close();
    // Forget the list, so arrow keys in the now-empty field don't reopen it.
    items = [];
    itemsQuery = null;
    input.value = "";
    // After a tap, drop focus so the on-screen keyboard closes and the weather shows.
    if (lastPointer === "touch") input.blur();
    onSelect(place);
  };

  const showResults = (results, query) => {
    if (!results.length) {
      showMessage(`No places match "${query}". Check the spelling, or add a region or country, like "Paris, France".`);
      announce("No matching places found.");
      return;
    }
    renderList(results, query, "");
    announce(`${results.length} places found. Use the up and down arrow keys to review them.`);
    if (pickWhenReady) {
      pickWhenReady = false;
      choose(0);
    }
  };

  const showRecent = () => {
    const places = recentPlaces();
    if (!places.length) {
      close();
      return;
    }
    renderList(places, null, "Recent places");
  };

  const run = async () => {
    clearTimeout(debounceTimer);
    const query = currentQuery();
    if (query.length < MIN_QUERY_LENGTH) return;

    const cached = cache.find((entry) => entry.key === cacheKey(query));
    if (cached) {
      showResults(cached.results, query);
      return;
    }

    if (controller) controller.abort();
    controller = new AbortController();
    const mine = controller;
    // Keep the previous results on screen while the next ones load (no flicker).
    if (itemsQuery) showMessage("Searching places…", { keepList: true });
    else showMessage("Searching places…");

    try {
      const results = await search(query, mine.signal);
      if (controller !== mine || currentQuery() !== query) return; // superseded
      controller = null;
      cache = [{ key: cacheKey(query), results }, ...cache.filter((e) => e.key !== cacheKey(query))]
        .slice(0, CACHE_SIZE);
      showResults(results, query);
    } catch (error) {
      if (error.name === "AbortError" || controller !== mine) return;
      controller = null;
      pickWhenReady = false;
      showMessage("Search is unavailable right now. Try again in a moment.");
    }
  };

  // Enter or the Search button: pick the highlighted option, or the best match.
  const submit = () => {
    const query = currentQuery();
    if (activeIndex >= 0 && isOpen()) {
      choose(activeIndex);
      return;
    }
    if (query.length < MIN_QUERY_LENGTH) {
      if (query) showMessage("Type at least 2 characters to search.");
      else showRecent();
      return;
    }
    if (isOpen() && itemsQuery === query && items.length) {
      choose(0);
      return;
    }
    pickWhenReady = true;
    run();
  };

  input.addEventListener("input", () => {
    pickWhenReady = false;
    clearTimeout(debounceTimer);
    const query = currentQuery();
    if (!query) {
      cancelPending();
      showRecent();
    } else if (query.length < MIN_QUERY_LENGTH) {
      cancelPending();
      close();
    } else {
      debounceTimer = setTimeout(run, DEBOUNCE_MS);
    }
  });

  // Focusing or clicking the empty field offers the recent places. The click
  // covers a field that kept focus after a mouse pick.
  const offerRecent = () => {
    if (!currentQuery() && !isOpen()) showRecent();
  };
  input.addEventListener("focus", offerRecent);
  input.addEventListener("click", offerRecent);

  // Tabbing to another control closes the list. Losing focus to nothing (for
  // example closing a phone keyboard) keeps it open so the results can be read.
  input.addEventListener("blur", (event) => {
    if (event.relatedTarget && !popup.contains(event.relatedTarget)) close();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!items.length) return;
      event.preventDefault();
      if (!isOpen()) open();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + items.length) % items.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (isOpen()) close();
      else input.value = "";
    }
  });

  document.addEventListener("pointerdown", (event) => {
    lastPointer = event.pointerType || "mouse";
    if (isOpen() && !popup.contains(event.target) && event.target !== input) close();
  });

  // A mouse press keeps focus in the field. Touch is left alone, so a swipe
  // that scrolls the list never turns into a pick (browsers send no click then).
  list.addEventListener("mousedown", (event) => event.preventDefault());
  list.addEventListener("click", (event) => {
    const option = event.target.closest('[role="option"]');
    if (option) choose(Number(option.dataset.index));
  });

  return { submit, close };
}
