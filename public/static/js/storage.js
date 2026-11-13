// localStorage can throw (private windows, blocked site data) or come back
// empty, so every caller treats it as optional.

export const readStorage = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const writeStorage = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage is optional */
  }
};
