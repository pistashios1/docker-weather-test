// Accessible location search: an ARIA 1.2 combobox with a listbox popup.
//
// Keyboard: ArrowDown/ArrowUp move through suggestions, Enter picks the
// highlighted one or the first result, Escape closes.
// Focus stays in the text field; the highlighted option is exposed to
// assistive technology through aria-activedescendant.

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;
const SEARCH_CACHE_SIZE = 3;
const SEARCH_LIMIT = 10;
const SEARCH_WINDOW_MS = 5000;
const LOCKOUT_STEP_MS = 2000;
const MAX_LOCKOUT_MS = 60000;

export function createSearchBox({
  input,
  popup,
  message,
  list,
  search,
  onSelect,
  announce,
  cacheContext = () => "",
}) {
  let results = [];
  let activeIndex = -1;
  let debounceTimer = null;
  let controller = null;
  let cachedResults = [];
  let searchTimestamps = [];
  let lockoutCount = 0;
  let lockoutUntil = 0;
  let replaceOnNextInput = false;

  const isOpen = () => !popup.hidden;
  const normalizeQuery = (query) => query.trim().toLocaleLowerCase();
  const cachedResultsFor = (query) => {
    const normalizedQuery = normalizeQuery(query);
    const context = cacheContext();
    return cachedResults.find(
      (entry) => entry.query === normalizedQuery && entry.context === context
    )?.results;
  };

  const rememberResults = (query, items) => {
    const normalizedQuery = normalizeQuery(query);
    const context = cacheContext();
    cachedResults = [
      { query: normalizedQuery, context, results: items },
      ...cachedResults.filter(
        (entry) => entry.query !== normalizedQuery || entry.context !== context
      ),
    ].slice(0, SEARCH_CACHE_SIZE);
  };

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

  const close = () => {
    // Drop any queued or in-flight search so a late answer can't reopen the list.
    clearTimeout(debounceTimer);
    if (controller) controller.abort();
    popup.hidden = true;
    input.setAttribute("aria-expanded", "false");
    setActive(-1);
  };

  const open = () => {
    popup.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };

  const showMessage = (text) => {
    list.replaceChildren();
    list.hidden = true;
    message.textContent = text;
    message.hidden = false;
    open();
  };

  const choose = (index) => {
    const result = results[index];
    if (!result) return;
    close();
    onSelect(result);
  };

  const render = (items) => {
    results = items;
    if (!items.length) {
      showMessage("No matching places found.");
      announce("No matching places found.");
      return;
    }

    message.hidden = true;
    list.hidden = false;
    list.replaceChildren(
      ...items.map((item, index) => {
        const option = document.createElement("div");
        option.id = `search-option-${index}`;
        option.className = "search-option";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", "false");
        option.dataset.index = String(index);

        const name = document.createElement("span");
        name.textContent = item.name;
        const context = document.createElement("small");
        context.textContent = item.context || "Location";
        option.append(name, context);
        return option;
      })
    );
    open();
    setActive(-1);
    announce(`${items.length} places found. Use the up and down arrow keys to review them.`);
  };

  const run = async () => {
    clearTimeout(debounceTimer);
    const query = input.value.trim();
    if (!query) {
      if (controller) controller.abort();
      close();
      return;
    }
    if (query.length < MIN_QUERY_LENGTH) {
      if (controller) controller.abort();
      showMessage("Type at least 2 characters to search.");
      return;
    }

    const cached = cachedResultsFor(query);
    if (cached) {
      if (controller) controller.abort();
      render(cached);
      return;
    }

    const now = Date.now();
    if (now < lockoutUntil) return;
    searchTimestamps = searchTimestamps.filter(
      (timestamp) => now - timestamp < SEARCH_WINDOW_MS
    );
    if (searchTimestamps.length >= SEARCH_LIMIT) {
      lockoutCount += 1;
      const duration = Math.min(LOCKOUT_STEP_MS * lockoutCount, MAX_LOCKOUT_MS);
      lockoutUntil = now + duration;
      searchTimestamps = [];
      close();
      if (lockoutCount >= 5) {
        const seconds = Math.ceil(duration / 1000);
        showMessage(`Please wait ${seconds} seconds before searching again.`);
        announce(`Search paused for ${seconds} seconds.`);
      }
      return;
    }
    searchTimestamps.push(now);

    if (controller) controller.abort();
    controller = new AbortController();
    const mine = controller;
    showMessage("Searching places…");

    try {
      const items = await search(query, mine.signal);
      rememberResults(query, items);
      render(items);
    } catch (error) {
      if (error.name === "AbortError" || controller !== mine) return;
      showMessage("Search is unavailable right now. Try again in a moment.");
    }
  };

  input.addEventListener("input", () => {
    replaceOnNextInput = false;
    clearTimeout(debounceTimer);
    if (cachedResultsFor(input.value)) {
      run();
    } else {
      debounceTimer = setTimeout(run, DEBOUNCE_MS);
    }
  });

  const selectForReplacement = () => {
    input.select();
    replaceOnNextInput = true;
  };

  input.addEventListener("focus", selectForReplacement);
  input.addEventListener("pointerdown", (event) => {
    if (document.activeElement === input) {
      event.preventDefault();
      selectForReplacement();
    }
  });
  input.addEventListener("mousedown", (event) => {
    if (document.activeElement === input) {
      event.preventDefault();
      selectForReplacement();
    }
  });
  input.addEventListener("mouseup", (event) => {
    if (document.activeElement === input) {
      event.preventDefault();
      selectForReplacement();
    }
  });
  input.addEventListener("click", () => {
    selectForReplacement();
    setTimeout(() => {
      if (document.activeElement === input) selectForReplacement();
    }, 0);
  });

  input.addEventListener("keydown", (event) => {
    if (
      replaceOnNextInput &&
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      input.value = "";
      replaceOnNextInput = false;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!results.length) return;
      event.preventDefault();
      if (!isOpen()) open();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + results.length) % results.length);
    } else if (event.key === "Enter" && isOpen() && results.length) {
      event.preventDefault();
      choose(activeIndex >= 0 ? activeIndex : 0);
    } else if (event.key === "Escape" && isOpen()) {
      event.preventDefault();
      close();
    }
  });

  // Mouse and touch: pointerdown fires before the input loses focus.
  list.addEventListener("pointerdown", (event) => event.preventDefault());
  list.addEventListener("click", (event) => {
    const option = event.target.closest('[role="option"]');
    if (option) choose(Number(option.dataset.index));
  });

  document.addEventListener("pointerdown", (event) => {
    if (isOpen() && !popup.contains(event.target) && event.target !== input) close();
  });

  return { run, close };
}
