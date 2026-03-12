/**
 * Persistent state: load/save state.json with atomic writes,
 * corruption recovery, debounced saves.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_STATE = {
  library: [],
  playlist: [],
  currentCueIndex: -1,
};

function load(statePath) {
  try {
    const data = fs.readFileSync(statePath, 'utf8');
    const parsed = JSON.parse(data);
    return {
      library: parsed.library ?? [],
      playlist: parsed.playlist ?? [],
      currentCueIndex: typeof parsed.currentCueIndex === 'number' ? parsed.currentCueIndex : -1,
    };
  } catch (err) {
    if (err.code === 'ENOENT') return { ...DEFAULT_STATE };
    // Corruption: rename for debugging, return empty
    const backup = `${statePath}.corrupt.${Date.now()}`;
    try {
      fs.renameSync(statePath, backup);
    } catch (_) {}
    return { ...DEFAULT_STATE };
  }
}

function saveSync(statePath, state) {
  const tmp = `${statePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, statePath);
}

function createStateManager(statePath) {
  let state = load(statePath);
  let saveTimer = null;
  const DEBOUNCE_MS = 100;

  function persist() {
    saveTimer = null;
    saveSync(statePath, state);
  }

  return {
    getState() {
      return { ...state };
    },

    updateState(updater) {
      if (typeof updater === 'function') {
        state = updater(state);
      } else {
        state = { ...state, ...updater };
      }
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(persist, DEBOUNCE_MS);
    },

    replaceState(newState) {
      state = {
        library: newState.library ?? [],
        playlist: newState.playlist ?? [],
        currentCueIndex: typeof newState.currentCueIndex === 'number' ? newState.currentCueIndex : -1,
      };
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(persist, DEBOUNCE_MS);
    },

    flush() {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
        persist();
      }
    },
  };
}

module.exports = { load, saveSync, createStateManager, DEFAULT_STATE };
