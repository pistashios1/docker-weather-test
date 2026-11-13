// Accessible location search: an ARIA 1.2 combobox with a listbox popup.
//
// Keyboard: ArrowDown/ArrowUp move through suggestions, Enter picks the
// highlighted one (or searches when none is highlighted), Escape closes.
// Focus stays in the text field; the highlighted option is exposed to
// assistive technology through aria-activedescendant.

const DEBOUNCE_MS = 250;

export function createSearchBox({ input, popup, message, list, search, onSelect, announce }) {
  let results = [];
  let activeIndex = -1;
  let debounceTimer = null;
  let controller = null;

  const isOpen = () => !popup.hidden;

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

    if (controller) controller.abort();
    controller = new AbortController();
    const mine = controller;
    showMessage("Searching places…");

    try {
      render(await search(query, mine.signal));
    } catch (error) {
      if (error.name === "AbortError" || controller !== mine) return;
      showMessage("Search is unavailable right now. Try again in a moment.");
    }
  };

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(run, DEBOUNCE_MS);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!results.length) return;
      event.preventDefault();
      if (!isOpen()) open();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + results.length) % results.length);
    } else if (event.key === "Enter" && isOpen() && activeIndex >= 0) {
      event.preventDefault();
      choose(activeIndex);
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
