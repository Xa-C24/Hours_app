const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createDraftStorageKey,
  normalizeDraftPayload,
  isMeaningfulDraft,
  shouldRestoreDraft,
  createEntryDraftStore,
} = require("../public/entry-draft-store");

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

test("createDraftStorageKey isolates client and date", () => {
  assert.equal(createDraftStorageKey("42", "2026-08-19"), "hours:draft:42:2026-08-19");
  assert.notEqual(createDraftStorageKey("42", "2026-08-19"), createDraftStorageKey("42", "2026-08-20"));
  assert.notEqual(createDraftStorageKey("42", "2026-08-19"), createDraftStorageKey("84", "2026-08-19"));
});

test("store creates and restores a draft payload", () => {
  const storage = createMemoryStorage();
  const store = createEntryDraftStore(storage);
  const payload = {
    clientId: "42",
    workDate: "2026-08-19",
    dayType: "office",
    arrivalTime: "08:30",
    departureTime: "17:15",
    lunchBreakMinutes: "45",
    commentText: "Point client",
  };

  store.set(payload);

  assert.deepEqual(store.get("42", "2026-08-19"), normalizeDraftPayload(payload));
});

test("store never mixes two client/date pairs", () => {
  const storage = createMemoryStorage();
  const store = createEntryDraftStore(storage);

  store.set({
    clientId: "42",
    workDate: "2026-08-19",
    dayType: "office",
  });
  store.set({
    clientId: "42",
    workDate: "2026-08-20",
    dayType: "remote",
  });
  store.set({
    clientId: "99",
    workDate: "2026-08-19",
    dayType: "leave",
  });

  assert.equal(store.get("42", "2026-08-19").dayType, "office");
  assert.equal(store.get("42", "2026-08-20").dayType, "remote");
  assert.equal(store.get("99", "2026-08-19").dayType, "leave");
});

test("server entry always wins over a local draft", () => {
  assert.equal(
    shouldRestoreDraft({
      serverEntry: { workDate: "2026-08-19", isExisting: true },
      draftEntry: { workDate: "2026-08-19" },
    }),
    false
  );
  assert.equal(
    shouldRestoreDraft({
      serverEntry: null,
      draftEntry: { workDate: "2026-08-19" },
    }),
    true
  );
});

test("store removes a draft after server save or manual clear", () => {
  const storage = createMemoryStorage();
  const store = createEntryDraftStore(storage);

  store.set({
    clientId: "42",
    workDate: "2026-08-19",
    dayType: "office",
    commentText: "Brouillon",
  });
  store.remove("42", "2026-08-19");

  assert.equal(store.get("42", "2026-08-19"), null);
});

test("empty draft is not meaningful compared to defaults", () => {
  const baseline = {
    clientId: "42",
    workDate: "2026-08-19",
    dayType: "office",
    arrivalTime: "09:00",
    departureTime: "17:00",
    lunchBreakMinutes: "60",
    commentText: "",
  };

  assert.equal(isMeaningfulDraft(baseline, baseline), false);
  assert.equal(
    isMeaningfulDraft(
      {
        ...baseline,
        commentText: "Ajout",
      },
      baseline
    ),
    true
  );
});
